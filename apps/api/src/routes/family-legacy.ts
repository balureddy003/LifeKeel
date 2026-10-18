/**
 * Family legacy register (PRD-137 §1/§7) — the record-keeping half of the
 * legacy map: wills and authority documents per person, named non-member
 * contacts (executor who isn't in the family), and free-text knowledge
 * notes attached to any node.
 *
 * Everything here is a family *declaration*, not a legal fact: every
 * record carries a `verification` label (document_linked / user_declared /
 * family_understanding / unverified) so the UI can never present belief
 * as validity. Tier 0 — nothing here determines ownership, succession,
 * or legal effect; the regulatory line in CLAUDE.md applies.
 *
 *   GET/POST           /family/legacy/documents
 *   PATCH/DELETE       /family/legacy/documents/:id
 *   GET/POST           /family/legacy/contacts
 *   PATCH/DELETE       /family/legacy/contacts/:id
 *   GET/POST           /family/legacy/notes
 *   DELETE             /family/legacy/notes/:id
 *
 * Access: adult-only for every route. On reads, `visibility` is enforced
 * per document — 'organizer' records appear only to the organizer;
 * 'named_roles' only to the organizer, the subject's user, or a user
 * matching a named role's roster member. Any read of a non-'adults'
 * document by someone other than the subject or organizer is audited
 * ('legacy.document.read').
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createLogger, getTenantCollection } from '@lifekeel/platform'
import {
  isFamilyAdult,
  isFamilyOrganizer,
  memberMatchesUser,
} from '../family/family-permissions.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { ESTATE_VAULT_CATEGORY } from './documents.js'
import type { FamilyGroupDoc } from './family-group.js'
import type { Engine, Insight } from '@lifekeel/engine'
import { evaluateEstate } from '../legacy/evaluate-estate.js'
import { buildLegacyGraph } from '../legacy/graph.js'

const log = createLogger({ service: 'family-legacy', version: '0.0.0' })

// ── Schemas (PRD-137 §1, verbatim) ─────────────────────────────────────────

export const Verification = z.enum([
  'document_linked',
  'user_declared',
  'family_understanding',
  'unverified',
])
export type Verification = z.infer<typeof Verification>

export const LegacyRole = z.object({
  role: z.enum([
    'executor',
    'trustee',
    'attorney',
    'guardian',
    'beneficiary',
    'witness',
    'caretaker',
    'successor_intended',
  ]),
  member_id: z.string().optional(),
  contact_id: z.string().optional(),
  share_pct: z.number().min(0).max(100).optional(),
  verification: Verification,
})
export type LegacyRole = z.infer<typeof LegacyRole>

export const LegacyDocument = z.object({
  id: z.string(),
  type: z.enum([
    'will',
    'codicil',
    'power_of_attorney',
    'advance_directive',
    'trust_deed',
    'letter_of_wishes',
    'guardianship_nomination',
    'funeral_wishes',
    'probate_record',
    'civil_certificate',
  ]),
  subject_member_id: z.string(),
  jurisdiction: z.string().max(80),
  signed_on: z.string().date().optional(),
  last_reviewed_on: z.string().date().optional(),
  review_due_on: z.string().date().optional(),
  original_location: z.string().max(200).optional(),
  vault_document_id: z.string().optional(),
  roles: z.array(LegacyRole).max(20),
  covers_asset_ids: z.array(z.string()).max(50),
  verification: Verification,
  notes: z.string().max(1000).optional(),
  visibility: z.enum(['adults', 'organizer', 'named_roles']).default('adults'),
})
export type LegacyDocument = z.infer<typeof LegacyDocument>

export const PropertyLegacy = z.object({
  ownership_basis: z.enum([
    'purchase',
    'inherited',
    'gift',
    'trust',
    'customary_succession',
    'unknown',
  ]),
  jurisdiction: z.string().max(80),
  recorded_owners: z.array(LegacyRole),
  claimed_owners: z.array(LegacyRole),
  title_reference: z.string().max(120).optional(),
  title_document_id: z.string().optional(),
  acquired_on: z.string().date().optional(),
  occupants: z.string().max(200).optional(),
  insured: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  mortgage_outstanding_minor: z.number().int().min(0).optional(),
  dispute: z.enum(['none', 'possible', 'active', 'unknown']).default('unknown'),
  professional_contact_id: z.string().optional(),
  verification: Verification,
})
export type PropertyLegacy = z.infer<typeof PropertyLegacy>

export const LegacyContact = z.object({
  id: z.string(),
  name: z.string().max(120),
  relationship: z.string().max(80),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  firm: z.string().max(120).optional(),
  kind: z.enum(['family', 'solicitor', 'notary', 'accountant', 'land_agent', 'other']),
})
export type LegacyContact = z.infer<typeof LegacyContact>

export const KnowledgeNote = z.object({
  id: z.string(),
  node: z.object({ kind: z.enum(['member', 'document', 'asset', 'contact']), id: z.string() }),
  text: z.string().max(2000),
  author_user_id: z.string(),
  created_at: z.date(),
  verification: z.literal('family_understanding'),
})
export type KnowledgeNote = z.infer<typeof KnowledgeNote>

// ── Stored shapes ──────────────────────────────────────────────────────────

export interface LegacyDocumentDoc extends Omit<LegacyDocument, 'id'> {
  id: string
  tenant_id: string
  created_by: string
  created_at: Date
  updated_at: Date
  [key: string]: unknown
}

interface LegacyContactDoc extends Omit<LegacyContact, 'id'> {
  id: string
  tenant_id: string
  created_by: string
  created_at: Date
  [key: string]: unknown
}

interface KnowledgeNoteDoc extends Omit<KnowledgeNote, 'created_at'> {
  tenant_id: string
  created_at: Date
  [key: string]: unknown
}

const DocumentBody = LegacyDocument.omit({ id: true })
const DocumentPatch = DocumentBody.partial()
const ContactBody = LegacyContact.omit({ id: true })
const ContactPatch = ContactBody.partial()
const NoteBody = KnowledgeNote.omit({
  id: true,
  author_user_id: true,
  created_at: true,
  verification: true,
})

// ── Reference validation ───────────────────────────────────────────────────
// A role names either a roster member or a legacy_contacts entry; a vault
// link must point at a real vault document. All failures are 400s — a bad
// reference is a client error, not a silent drop.

export async function validateLegacyRefs(
  db: Db,
  tenantId: string,
  refs: { memberIds?: string[]; contactIds?: string[]; vaultDocIds?: string[] },
): Promise<string | null> {
  const family = await db
    .collection<FamilyGroupDoc>('family_groups')
    .findOne({ tenant_id: tenantId })
    .catch(() => null)
  const rosterIds = new Set((family?.members ?? []).map((m) => m.id))
  for (const id of refs.memberIds ?? []) {
    if (!rosterIds.has(id)) return `Unknown family member: ${id}`
  }
  const contacts = getTenantCollection<LegacyContactDoc>(db, 'legacy_contacts', tenantId)
  for (const id of refs.contactIds ?? []) {
    if (typeof contacts.findOne !== 'function') break
    const found = await contacts.findOne({ id }).catch(() => null)
    if (!found) return `Unknown legacy contact: ${id}`
  }
  const documents = getTenantCollection<Record<string, unknown>>(db, 'documents', tenantId)
  for (const id of refs.vaultDocIds ?? []) {
    if (typeof documents.findOne !== 'function') break
    const found = await documents.findOne({ id, category: ESTATE_VAULT_CATEGORY }).catch(() => null)
    if (!found) return `Unknown vault document: ${id}`
  }
  return null
}

export function registerFamilyLegacyRoutes(
  app: FastifyInstance,
  db: Db,
  engine?: Engine,
  onInsightsGenerated?: (insights: Insight[], tenantId: string) => Promise<void>,
): void {
  const docsFor = (tenantId: string) =>
    getTenantCollection<LegacyDocumentDoc>(db, 'legacy_documents', tenantId)
  const contactsFor = (tenantId: string) =>
    getTenantCollection<LegacyContactDoc>(db, 'legacy_contacts', tenantId)
  const notesFor = (tenantId: string) =>
    getTenantCollection<KnowledgeNoteDoc>(db, 'legacy_notes', tenantId)

  const requireAdult = async (
    req: { authContext: { tenant_id: string; user_id: string } },
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  ): Promise<boolean> => {
    const { tenant_id, user_id } = req.authContext
    if (await isFamilyAdult(db, tenant_id, user_id)) return true
    reply
      .status(403)
      .send({ error: 'The legacy register is visible to adult family members only.' })
    return false
  }

  const toDocView = (d: LegacyDocumentDoc) => {
    const { tenant_id: _t, _id, created_by: _c, ...rest } = d as Record<string, unknown>
    void _t
    void _id
    void _c
    return rest
  }
  const toContactView = (c: LegacyContactDoc) => {
    const { tenant_id: _t, _id, created_by: _cb, ...rest } = c as Record<string, unknown>
    void _t
    void _id
    void _cb
    return rest
  }
  const toNoteView = (n: KnowledgeNoteDoc) => {
    const { tenant_id: _t, _id, ...rest } = n as Record<string, unknown>
    void _t
    void _id
    return rest
  }

  // Every successful write shifts the estate signal — re-evaluate
  // fire-and-forget so the write path never waits on (or fails on) the
  // detector.
  const reevaluate = (tenantId: string) => {
    void evaluateEstate(db, engine, tenantId, onInsightsGenerated)
  }

  /** Collect every referenced member/contact/vault id a document body carries. */
  const docRefs = (b: z.infer<typeof DocumentPatch>) => ({
    memberIds: [b.subject_member_id, ...(b.roles ?? []).map((r) => r.member_id)].filter(
      (x): x is string => typeof x === 'string',
    ),
    contactIds: (b.roles ?? [])
      .map((r) => r.contact_id)
      .filter((x): x is string => typeof x === 'string'),
    vaultDocIds: b.vault_document_id ? [b.vault_document_id] : [],
  })

  // ── Documents ────────────────────────────────────────────────────────────

  app.get('/family/legacy/documents', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id, user_id } = req.authContext
    const [family, isOrganizer] = await Promise.all([
      db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id }),
      isFamilyOrganizer(db, tenant_id, user_id),
    ])
    const memberFor = (id?: string) => (id ? family?.members.find((m) => m.id === id) : undefined)
    const matchesUser = (id?: string) => {
      const m = memberFor(id)
      return m ? memberMatchesUser(m, user_id) : id === user_id
    }
    const isSubject = (d: LegacyDocumentDoc) => matchesUser(d.subject_member_id)
    const isNamed = (d: LegacyDocumentDoc) => d.roles.some((r) => matchesUser(r.member_id))
    const canView = (d: LegacyDocumentDoc) =>
      d.visibility === 'adults' ||
      isOrganizer ||
      (d.visibility === 'named_roles' && (isSubject(d) || isNamed(d)))

    const docs = (await docsFor(tenant_id).find({}).toArray()) as LegacyDocumentDoc[]
    const visible = docs.filter(canView)
    // §7: every read of a restricted document by a third party is audited.
    for (const d of visible) {
      if (d.visibility !== 'adults' && !isOrganizer && !isSubject(d)) {
        getAuditLogger()?.log({
          tenant_id,
          user_id,
          action: 'legacy.document.read',
          resource_type: 'legacy_document',
          resource_id: d.id,
          metadata: { visibility: d.visibility },
          ip: req.ip,
          user_agent: req.headers['user-agent'] ?? '',
          timestamp: new Date(),
        })
      }
    }
    return { documents: visible.map(toDocView) }
  })

  app.post('/family/legacy/documents', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id, user_id } = req.authContext
    const parsed = DocumentBody.safeParse(req.body)
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'Invalid legacy document', issues: parsed.error.issues })
    if (parsed.data.roles.some((r) => !r.member_id && !r.contact_id)) {
      return reply
        .status(400)
        .send({ error: 'Each role must name a family member or a legacy contact' })
    }
    const refError = await validateLegacyRefs(db, tenant_id, docRefs(parsed.data))
    if (refError) return reply.status(400).send({ error: refError })
    const now = new Date()
    const doc: LegacyDocumentDoc = {
      id: randomUUID(),
      tenant_id,
      ...parsed.data,
      // A linked vault document is the strongest evidence the register
      // has — the link itself upgrades the record's verification.
      verification: parsed.data.vault_document_id ? 'document_linked' : parsed.data.verification,
      created_by: user_id,
      created_at: now,
      updated_at: now,
    }
    await docsFor(tenant_id).insertOne(doc)
    reevaluate(tenant_id)
    return reply.status(201).send({ document: toDocView(doc) })
  })

  app.patch<{ Params: { id: string } }>('/family/legacy/documents/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const parsed = DocumentPatch.safeParse(req.body)
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'Invalid legacy document update', issues: parsed.error.issues })
    const existing = await docsFor(tenant_id).findOne({ id: req.params.id })
    if (!existing) return reply.status(404).send({ error: 'Legacy document not found' })
    if ((parsed.data.roles ?? []).some((r) => !r.member_id && !r.contact_id)) {
      return reply
        .status(400)
        .send({ error: 'Each role must name a family member or a legacy contact' })
    }
    const merged = { ...existing, ...parsed.data }
    const refError = await validateLegacyRefs(db, tenant_id, docRefs(merged))
    if (refError) return reply.status(400).send({ error: refError })
    const update = {
      ...parsed.data,
      verification: merged.vault_document_id ? 'document_linked' : merged.verification,
      updated_at: new Date(),
    }
    await docsFor(tenant_id).updateOne({ id: req.params.id }, { $set: update })
    const doc = await docsFor(tenant_id).findOne({ id: req.params.id })
    reevaluate(tenant_id)
    return reply.send({ document: toDocView(doc as LegacyDocumentDoc) })
  })

  app.delete<{ Params: { id: string } }>('/family/legacy/documents/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const res = await docsFor(tenant_id).deleteOne({ id: req.params.id })
    if ((res as { deletedCount?: number }).deletedCount === 0) {
      return reply.status(404).send({ error: 'Legacy document not found' })
    }
    reevaluate(tenant_id)
    return reply.status(204).send()
  })

  // ── Contacts ─────────────────────────────────────────────────────────────

  app.get('/family/legacy/contacts', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const docs = (await contactsFor(tenant_id).find({}).toArray()) as LegacyContactDoc[]
    return { contacts: docs.map(toContactView) }
  })

  app.post('/family/legacy/contacts', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id, user_id } = req.authContext
    const parsed = ContactBody.safeParse(req.body)
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'Invalid legacy contact', issues: parsed.error.issues })
    const doc: LegacyContactDoc = {
      id: randomUUID(),
      tenant_id,
      ...parsed.data,
      created_by: user_id,
      created_at: new Date(),
    }
    await contactsFor(tenant_id).insertOne(doc)
    reevaluate(tenant_id)
    return reply.status(201).send({ contact: toContactView(doc) })
  })

  app.patch<{ Params: { id: string } }>('/family/legacy/contacts/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const parsed = ContactPatch.safeParse(req.body)
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'Invalid legacy contact update', issues: parsed.error.issues })
    const existing = await contactsFor(tenant_id).findOne({ id: req.params.id })
    if (!existing) return reply.status(404).send({ error: 'Legacy contact not found' })
    await contactsFor(tenant_id).updateOne({ id: req.params.id }, { $set: parsed.data })
    const doc = await contactsFor(tenant_id).findOne({ id: req.params.id })
    reevaluate(tenant_id)
    return reply.send({ contact: toContactView(doc as LegacyContactDoc) })
  })

  app.delete<{ Params: { id: string } }>('/family/legacy/contacts/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const res = await contactsFor(tenant_id).deleteOne({ id: req.params.id })
    if ((res as { deletedCount?: number }).deletedCount === 0) {
      return reply.status(404).send({ error: 'Legacy contact not found' })
    }
    reevaluate(tenant_id)
    return reply.status(204).send()
  })

  // ── Knowledge notes ──────────────────────────────────────────────────────
  // Always family_understanding, always attributed to the caller — a note
  // is a family belief by construction, never a verified fact.

  app.get('/family/legacy/notes', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const docs = (await notesFor(tenant_id).find({}).toArray()) as KnowledgeNoteDoc[]
    return { notes: docs.map(toNoteView) }
  })

  app.post('/family/legacy/notes', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id, user_id } = req.authContext
    const parsed = NoteBody.safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid legacy note', issues: parsed.error.issues })
    const doc: KnowledgeNoteDoc = {
      id: randomUUID(),
      tenant_id,
      ...parsed.data,
      author_user_id: user_id,
      created_at: new Date(),
      verification: 'family_understanding',
    }
    await notesFor(tenant_id).insertOne(doc)
    reevaluate(tenant_id)
    return reply.status(201).send({ note: toNoteView(doc) })
  })

  app.delete<{ Params: { id: string } }>('/family/legacy/notes/:id', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const res = await notesFor(tenant_id).deleteOne({ id: req.params.id })
    if ((res as { deletedCount?: number }).deletedCount === 0) {
      return reply.status(404).send({ error: 'Legacy note not found' })
    }
    reevaluate(tenant_id)
    return reply.status(204).send()
  })

  // ── Legacy graph (PRD-137 §5) ──────────────────────────────────────────
  // The register as nodes+edges for the /legacy "Family map" tab and Ask
  // Keel. ?mode=youth resolves the caller's roster member like family-feed
  // and returns the existence-only slice — no roles, assets, or policies.
  app.get<{ Querystring: { mode?: string } }>('/family/legacy/graph', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id })
    const member = family?.members.find((m) => memberMatchesUser(m, user_id)) ?? null

    if (req.query.mode === 'youth') {
      return buildLegacyGraph(db, tenant_id, {
        user_id,
        is_organizer: false,
        member_id: member?.id ?? null,
        youth: true,
      })
    }
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply
        .status(403)
        .send({ error: 'The legacy register is visible to adult family members only.' })
    }
    return buildLegacyGraph(db, tenant_id, {
      user_id,
      is_organizer: await isFamilyOrganizer(db, tenant_id, user_id).catch(() => false),
      member_id: member?.id ?? null,
      youth: false,
    })
  })

  // ── Continuity rehearsal (PRD-137 §6) ──────────────────────────────────
  // "If <as> couldn't act tomorrow, could they find what matters?" — a
  // pure read model over the register: what the chosen adult can see,
  // what's locatable, who they're named on, and the records only one
  // person knows about. Nothing is notified and nothing is released —
  // rehearsal answers the question, it doesn't act on the answer.
  app.get<{ Querystring: { as?: string } }>('/family/legacy/rehearsal', async (req, reply) => {
    if (!(await requireAdult(req, reply))) return
    const { tenant_id } = req.authContext
    const asId = req.query.as
    if (!asId) return reply.status(400).send({ error: 'as=<member_id> is required' })

    const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id })
    const members = family?.members ?? []
    const subject = members.find((m) => m.id === asId)
    if (
      !subject ||
      subject.status !== 'active' ||
      !['organizer', 'parent', 'adult'].includes(subject.role)
    ) {
      return reply.status(400).send({ error: 'as must be an active adult member of the family' })
    }
    const asOrganizer = subject.role === 'organizer'

    const [docs, contacts, notes, assets] = await Promise.all([
      docsFor(tenant_id).find({}).toArray() as Promise<LegacyDocumentDoc[]>,
      contactsFor(tenant_id)
        .find({})
        .toArray()
        .catch(() => []) as Promise<LegacyContactDoc[]>,
      notesFor(tenant_id)
        .find({})
        .toArray()
        .catch(() => []) as Promise<KnowledgeNoteDoc[]>,
      getTenantCollection<Record<string, unknown>>(db, 'family_assets', tenant_id)
        .find({})
        .toArray()
        .catch(() => [] as Record<string, unknown>[]),
    ])

    const memberName = (id?: string) => members.find((m) => m.id === id)?.name ?? 'Someone'
    // The §7 visibility predicate evaluated for the `as` member — this is
    // the question the rehearsal answers, not what the caller can see.
    const visibleTo = (d: LegacyDocumentDoc) =>
      d.visibility === 'adults' ||
      asOrganizer ||
      (d.visibility === 'named_roles' &&
        (d.subject_member_id === subject.id || d.roles.some((r) => r.member_id === subject.id)))

    const visible = docs.filter(visibleTo)
    const hidden = docs.filter((d) => !visibleTo(d))
    const withLocation = visible.filter((d) => Boolean(d.original_location))

    const noteTargets = new Set(notes.map((n) => `${n.node.kind}:${n.node.id}`))
    const propertyAssets = assets.filter(
      (a: Record<string, unknown>) => a['kind'] === 'property' && a['legacy'],
    )
    const onlyOnePersonKnows = [
      ...docs
        .filter((d) => d.visibility === 'organizer' && !noteTargets.has(`document:${d.id}`))
        .map((d) => ({
          kind: 'document' as const,
          id: d.id,
          label: `${d.type.replace(/_/g, ' ')} — ${memberName(d.subject_member_id)}`,
        })),
      ...propertyAssets
        .filter((a: Record<string, unknown>) => {
          const legacy = a['legacy'] as { recorded_owners?: unknown[] }
          return (legacy.recorded_owners ?? []).length === 0 && !noteTargets.has(`asset:${a['id']}`)
        })
        .map((a: Record<string, unknown>) => ({
          kind: 'asset' as const,
          id: String(a['id']),
          label: String(a['name'] ?? 'Property'),
        })),
    ]

    // Roles the `as` member is named in across every visible document, and
    // the professional/family contacts those documents can still reach.
    const namedRoles = visible.flatMap((d) =>
      d.roles
        .filter((r) => r.member_id === subject.id)
        .map((r) => ({ document_id: d.id, type: d.type, role: r.role })),
    )
    const contactIds = new Set(
      visible.flatMap((d) =>
        d.roles.map((r) => r.contact_id).filter((x): x is string => typeof x === 'string'),
      ),
    )
    const reachable = contacts
      .filter((c) => contactIds.has(c.id) && (c.email || c.phone || c.firm))
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind }))

    return {
      as: { id: subject.id, name: subject.name },
      findability_pct:
        docs.length === 0 ? 100 : Math.round((withLocation.length / docs.length) * 100),
      visible_documents: visible.map((d) => ({
        id: d.id,
        type: d.type,
        subject_name: memberName(d.subject_member_id),
        original_location: d.original_location ?? null,
      })),
      hidden_documents: hidden.map((d) => ({
        id: d.id,
        type: d.type,
        subject_name: memberName(d.subject_member_id),
        reason: d.visibility === 'organizer' ? 'organizer only' : 'named roles only',
      })),
      documents_without_location: visible
        .filter(
          (d) =>
            ['will', 'power_of_attorney', 'trust_deed'].includes(d.type) && !d.original_location,
        )
        .map((d) => ({ id: d.id, type: d.type, subject_name: memberName(d.subject_member_id) })),
      properties_without_title: propertyAssets
        .filter((a: Record<string, unknown>) => {
          const legacy = a['legacy'] as { title_document_id?: string; title_reference?: string }
          return !legacy.title_document_id && !legacy.title_reference
        })
        .map((a: Record<string, unknown>) => ({
          id: String(a['id']),
          name: String(a['name'] ?? 'Property'),
        })),
      named_roles: namedRoles,
      reachable_contacts: reachable,
      only_one_person_knows: onlyOnePersonKnows,
    }
  })
}

/**
 * Member-deletion cascade (PRD-137 §7): a roster member leaving the family
 * doesn't erase their named roles — each flips to 'unverified' so the gap
 * stays visible. Best-effort: a broken/absent collection must never break
 * member deletion.
 */
export async function cascadeLegacyMemberRemoval(
  db: Db,
  tenantId: string,
  memberId: string,
): Promise<void> {
  try {
    const docs = getTenantCollection<LegacyDocumentDoc>(db, 'legacy_documents', tenantId)
    if (typeof docs.find !== 'function') return
    const affected = (await docs
      .find({ 'roles.member_id': memberId })
      .toArray()) as LegacyDocumentDoc[]
    for (const d of affected) {
      const roles = (d.roles ?? []).map((r) =>
        r.member_id === memberId ? { ...r, verification: 'unverified' as const } : r,
      )
      await docs.updateOne({ id: d.id }, { $set: { roles } })
    }
  } catch (err) {
    log.warn(
      { err, tenant_id: tenantId, member_id: memberId },
      'Legacy cascade after member removal failed — member already removed',
    )
  }
}
