/**
 * Legacy graph read model (PRD-137 §5) — the register as nodes and edges:
 * members, named contacts, legacy documents, property assets, policies,
 * and vault documents that evidence them. Two consumers: the /legacy
 * "Family map" tab and Ask Oak's context builder.
 *
 * Everything is a family declaration — `verification` rides every node
 * and edge so neither surface can present belief as legal fact. No
 * amounts (`value_minor`/`mortgage_outstanding_minor`) ever enter the
 * payload: the graph answers "what exists and who it names", never
 * "what it's worth" — that keeps the whole read Tier 0 and youth-safe.
 *
 * Youth mode returns existence only: member + document nodes, no roles,
 * no assets/policies/contacts, no sublabels or edge labels.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import type { LegacyDocumentDoc, LegacyRole, Verification } from '../routes/family-legacy.js'

export interface LegacyGraphViewer {
  user_id: string
  is_organizer: boolean
  /** Roster member id this user maps to, or null. */
  member_id: string | null
  youth: boolean
}

export interface LegacyGraphNode {
  id: string
  kind: 'member' | 'contact' | 'document' | 'asset' | 'policy'
  label: string
  sublabel?: string
  verification?: Verification
  meta?: Record<string, unknown>
}

export interface LegacyGraphEdge {
  from: string
  to: string
  kind: 'subject_of' | 'names_as' | 'covers' | 'evidence_for' | 'owns' | 'occupies' | 'advises'
  label?: string
  verification?: Verification
}

export interface LegacyGraph {
  nodes: LegacyGraphNode[]
  edges: LegacyGraphEdge[]
}

type AnyDoc = Record<string, unknown>

async function safeFind(db: Db, tenantId: string, name: string, filter: AnyDoc = {}): Promise<AnyDoc[]> {
  try {
    const col = getTenantCollection<AnyDoc>(db, name, tenantId)
    if (typeof col.find !== 'function') return []
    return (await col.find(filter).toArray()) as AnyDoc[]
  } catch {
    return []
  }
}

const roleLabel = (r: string) => r.replace(/_/g, ' ')

export async function buildLegacyGraph(db: Db, tenantId: string, viewer: LegacyGraphViewer): Promise<LegacyGraph> {
  const nodes: LegacyGraphNode[] = []
  const edges: LegacyGraphEdge[] = []
  const nodeIds = new Set<string>()
  const pushNode = (n: LegacyGraphNode) => {
    if (nodeIds.has(n.id)) return
    nodeIds.add(n.id)
    nodes.push(n)
  }

  const family = await db
    .collection<FamilyGroupDoc>('family_groups')
    .findOne({ tenant_id: tenantId })
    .catch(() => null)
  const members = (family?.members ?? []).filter((m) => m.status === 'active')
  for (const m of members) {
    pushNode({ id: `member:${m.id}`, kind: 'member', label: m.name, sublabel: viewer.youth ? undefined : m.role })
  }

  const docs = await safeFind(db, tenantId, 'legacy_documents') as LegacyDocumentDoc[]
  // The §7 visibility predicate, evaluated for this viewer — hidden
  // documents are omitted entirely, not redacted.
  const visible = (d: LegacyDocumentDoc) =>
    viewer.youth
      ? true // existence only — the node carries no detail
      : d.visibility === 'adults' ||
        viewer.is_organizer ||
        (d.visibility === 'named_roles' &&
          (d.subject_member_id === viewer.member_id || d.roles.some((r) => r.member_id === viewer.member_id)))

  const memberName = (id?: string | null) => members.find((m) => m.id === id)?.name ?? 'Someone'

  for (const d of docs.filter(visible)) {
    pushNode(
      viewer.youth
        ? { id: `document:${d.id}`, kind: 'document', label: d.type.replace(/_/g, ' ') }
        : {
            id: `document:${d.id}`,
            kind: 'document',
            label: `${d.type.replace(/_/g, ' ')} for ${memberName(d.subject_member_id)}`,
            sublabel: d.jurisdiction,
            verification: d.verification,
            meta: {
              signed_on: d.signed_on ?? null,
              last_reviewed_on: d.last_reviewed_on ?? null,
              review_due_on: d.review_due_on ?? null,
              original_location: d.original_location ?? null,
              visibility: d.visibility,
            },
          },
    )
    if (viewer.youth) continue
    if (nodeIds.has(`member:${d.subject_member_id}`)) {
      edges.push({ from: `document:${d.id}`, to: `member:${d.subject_member_id}`, kind: 'subject_of' })
    }
    for (const r of d.roles) {
      const target = r.member_id ? `member:${r.member_id}` : r.contact_id ? `contact:${r.contact_id}` : null
      if (!target) continue
      edges.push({
        from: `document:${d.id}`,
        to: target,
        kind: 'names_as',
        label: `${roleLabel(r.role)}${r.share_pct !== undefined ? ` · ${r.share_pct}%` : ''}`,
        verification: r.verification,
      })
    }
    for (const assetId of d.covers_asset_ids) {
      edges.push({ from: `document:${d.id}`, to: `asset:${assetId}`, kind: 'covers' })
    }
    if (d.vault_document_id) {
      pushNode({ id: `document:vault-${d.vault_document_id}`, kind: 'document', label: 'Vault document', sublabel: 'sealed copy on file' })
      edges.push({ from: `document:vault-${d.vault_document_id}`, to: `document:${d.id}`, kind: 'evidence_for' })
    }
  }

  if (viewer.youth) return { nodes, edges }

  const [contacts, assets, profile] = await Promise.all([
    safeFind(db, tenantId, 'legacy_contacts'),
    safeFind(db, tenantId, 'family_assets'),
    getTenantCollection<AnyDoc>(db, 'family_financial_profile', tenantId).findOne({}).catch(() => null),
  ])

  for (const c of contacts) {
    pushNode({ id: `contact:${String(c['id'])}`, kind: 'contact', label: String(c['name']), sublabel: String(c['relationship'] ?? c['kind'] ?? '') })
  }

  for (const a of assets) {
    const legacy = a['legacy'] as (AnyDoc & { recorded_owners?: LegacyRole[]; claimed_owners?: LegacyRole[] }) | undefined
    if (a['kind'] !== 'property' || !legacy) continue
    pushNode({
      id: `asset:${String(a['id'])}`,
      kind: 'asset',
      label: String(a['name'] ?? 'Property'),
      sublabel: [legacy['jurisdiction'], legacy['occupants'] ? `occupants: ${legacy['occupants']}` : null].filter(Boolean).join(' · ') || undefined,
      verification: legacy['verification'] as Verification,
      meta: {
        ownership_basis: legacy['ownership_basis'] ?? 'unknown',
        dispute: legacy['dispute'] ?? 'unknown',
        insured: legacy['insured'] ?? 'unknown',
      },
    })
    for (const r of legacy.recorded_owners ?? []) {
      const target = r.member_id ? `member:${r.member_id}` : r.contact_id ? `contact:${r.contact_id}` : null
      if (target) {
        edges.push({
          from: target,
          to: `asset:${String(a['id'])}`,
          kind: 'owns',
          label: `recorded${r.share_pct !== undefined ? ` · ${r.share_pct}%` : ''}`,
          verification: r.verification,
        })
      }
    }
    for (const r of legacy.claimed_owners ?? []) {
      const target = r.member_id ? `member:${r.member_id}` : r.contact_id ? `contact:${r.contact_id}` : null
      if (target) {
        edges.push({ from: target, to: `asset:${String(a['id'])}`, kind: 'owns', label: 'claimed', verification: r.verification })
      }
    }
    if (legacy['professional_contact_id']) {
      edges.push({ from: `contact:${String(legacy['professional_contact_id'])}`, to: `asset:${String(a['id'])}`, kind: 'advises' })
    }
    if (legacy['title_document_id']) {
      pushNode({ id: `document:vault-${String(legacy['title_document_id'])}`, kind: 'document', label: 'Title document', sublabel: 'in the vault' })
      edges.push({ from: `document:vault-${String(legacy['title_document_id'])}`, to: `asset:${String(a['id'])}`, kind: 'evidence_for' })
    }
  }

  const policies = (profile?.['policies'] as AnyDoc[] | undefined) ?? []
  for (const p of policies) {
    const holder = String(p['member_id'] ?? 'household')
    const pid = `policy:${String(p['id'] ?? p['type'] ?? Math.random())}-${holder}`
    pushNode({ id: pid, kind: 'policy', label: `${String(p['type'] ?? 'Insurance').replace(/_/g, ' ')} policy`, sublabel: p['provider'] ? String(p['provider']) : undefined })
    if (nodeIds.has(`member:${holder}`)) edges.push({ from: pid, to: `member:${holder}`, kind: 'subject_of' })
    const beneficiary = p['beneficiary_member_id']
    if (typeof beneficiary === 'string' && nodeIds.has(`member:${beneficiary}`)) {
      edges.push({ from: pid, to: `member:${beneficiary}`, kind: 'names_as', label: 'beneficiary' })
    }
  }

  // Drop edges pointing at nodes that never materialised (e.g. a role
  // naming a contact that was deleted, or a removed member).
  const clean = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
  return { nodes, edges: clean }
}

const VERIFICATION_TEXT: Record<string, string> = {
  document_linked: 'document-linked',
  user_declared: 'user-declared',
  family_understanding: 'family understanding',
  unverified: 'unverified',
}
const vlabel = (v?: string) => VERIFICATION_TEXT[v ?? ''] ?? 'unverified'

/**
 * ≤1,200-char plain-text rendering for Ask Oak's context — one line per
 * document and per property, every claim carrying its verification label
 * in brackets. Names/roles/dates yes; amounts never (policies and values
 * are deliberately absent here — the profile block already covers them).
 */
export function renderLegacyGraphForAssistant(graph: LegacyGraph): string {
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? 'someone'
  const lines: string[] = []

  for (const n of graph.nodes.filter((x) => x.kind === 'document' && !x.id.startsWith('document:vault-'))) {
    const docEdges = graph.edges.filter((e) => e.from === n.id)
    const roles = docEdges
      .filter((e) => e.kind === 'names_as')
      .map((e) => `${e.label}: ${nameOf(e.to)} [${vlabel(e.verification)}]`)
    const covers = docEdges.filter((e) => e.kind === 'covers').map((e) => nameOf(e.to))
    const meta = (n.meta ?? {}) as Record<string, unknown>
    const dates = [
      meta['signed_on'] ? `signed ${meta['signed_on']}` : null,
      meta['last_reviewed_on'] ? `last reviewed ${meta['last_reviewed_on']}` : null,
      meta['original_location'] ? `original: ${meta['original_location']}` : 'original location not recorded',
    ].filter(Boolean)
    lines.push(
      `${n.label} (${n.sublabel ?? 'no jurisdiction'}${dates.length ? `, ${dates.join(', ')}` : ''}) [${vlabel(n.verification)}]` +
        `${roles.length ? ` — ${roles.join('; ')}` : ''}${covers.length ? `; covers: ${covers.join(', ')}` : ''}`,
    )
  }

  for (const n of graph.nodes.filter((x) => x.kind === 'asset')) {
    const owners = graph.edges
      .filter((e) => e.to === n.id && e.kind === 'owns')
      .map((e) => `${nameOf(e.from)} ${e.label ?? ''} [${vlabel(e.verification)}]`.trim())
    const meta = (n.meta ?? {}) as Record<string, unknown>
    const flags = [
      meta['ownership_basis'] && meta['ownership_basis'] !== 'unknown' ? String(meta['ownership_basis']) : null,
      meta['dispute'] && meta['dispute'] !== 'none' && meta['dispute'] !== 'unknown' ? `dispute ${meta['dispute']}` : null,
    ].filter(Boolean)
    lines.push(
      `${n.label}${n.sublabel ? `, ${n.sublabel}` : ''} [${vlabel(n.verification)}]` +
        `${flags.length ? ` — ${flags.join('; ')}` : ''}${owners.length ? `; owners: ${owners.join('; ')}` : '; no owners recorded'}`,
    )
  }

  let text = lines.join('\n')
  if (text.length > 1200) text = text.slice(0, 1190).replace(/\n[^\n]*$/, '') + '\n…'
  return text
}
