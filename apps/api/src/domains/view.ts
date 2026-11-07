import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { FamilyGroupDoc } from '../routes/family-group.js'
import { isMinorMember, memberMatchesUser } from '../family/family-permissions.js'
import { ADAPTERS, type DomainRow, type RosterRef } from './adapters.js'
import type { DomainPack } from './types.js'

export type DomainRecordDoc = {
  id: string
  tenant_id: string
  domain_id: string
  record: string
  holder_member_id: string | null
  covers_member_id: string | null
  values: Record<string, string>
  created_by: string
  created_at: Date
  updated_at: Date
}

export type DomainConfirmationDoc = {
  tenant_id: string
  domain_id: string
  user_id: string
  result_version: string
  confirmed_at: Date
}

export type Cell = 'holds' | 'covers' | 'holds_and_covers' | null

export interface DomainView {
  domain_id: string
  rows: DomainRow[]
  matrix: {
    label: string
    columns: RosterRef[]
    rows: Array<{ id: string; label: string; cells: Record<string, Cell> }>
  } | null
  /** Facts about the record itself, never a judgement about adequacy. */
  gaps: Array<{ row_id: string; note: string }>
  result_version: string
  confirmation: {
    required: RosterRef[]
    confirmed: Array<RosterRef & { confirmed_at: Date }>
    both_confirmed: boolean
    /** Has the asking adult already confirmed this exact version? */
    viewer_confirmed: boolean
  }
}

const sortKeys = (o: unknown): unknown =>
  Array.isArray(o)
    ? o.map(sortKeys)
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.keys(o as object)
            .sort()
            .map((k) => [k, sortKeys((o as Record<string, unknown>)[k])]),
        )
      : o

export async function buildDomainView(
  db: Db,
  tenantId: string,
  pack: DomainPack,
  viewerUserId?: string,
): Promise<DomainView> {
  const group = await db
    .collection<FamilyGroupDoc>('family_groups')
    .findOne({ tenant_id: tenantId })
  const active = (group?.members ?? []).filter((m) => m.status === 'active')
  const roster: RosterRef[] = active.map((m) => ({ id: m.id, name: m.name }))

  const rows: DomainRow[] = []
  for (const rec of pack.records) {
    if (rec.source.kind === 'adapter') {
      const adapter = ADAPTERS[rec.source.adapter]
      if (!adapter) throw new Error(`Unknown adapter ${rec.source.adapter}`)
      rows.push(...(await adapter(db, tenantId, rec, roster)))
    } else {
      const docs = (await getTenantCollection<DomainRecordDoc>(db, 'domain_records', tenantId)
        .find({ domain_id: pack.id, record: rec.key })
        .sort({ created_at: 1 })
        .toArray()) as DomainRecordDoc[]
      rows.push(
        ...docs.map((d) => ({
          id: d.id,
          record: d.record,
          holder_member_id: d.holder_member_id,
          covers_member_id: d.covers_member_id,
          values: d.values,
        })),
      )
    }
  }

  const rosterIds = new Set(roster.map((r) => r.id))
  const nameOf = (id: string | null) => roster.find((r) => r.id === id)?.name ?? ''
  const label = (r: DomainRow) => {
    const rec = pack.records.find((x) => x.key === r.record)!
    const detail = r.values['provider'] || r.values['name_as_printed'] || r.values['type']
    return [rec.label, detail?.replace(/_/g, ' ')].filter(Boolean).join(' · ')
  }

  const gaps: DomainView['gaps'] = []
  for (const r of rows) {
    const rec = pack.records.find((x) => x.key === r.record)!
    if (rec.person_attribution === 'holder' && !r.holder_member_id)
      gaps.push({ row_id: r.id, note: 'Not yet matched to a family member' })
    else if (r.holder_member_id && !rosterIds.has(r.holder_member_id))
      gaps.push({ row_id: r.id, note: 'Held by someone no longer on the family list' })
    if (r.covers_member_id && !rosterIds.has(r.covers_member_id))
      gaps.push({ row_id: r.id, note: 'Covers someone no longer on the family list' })
  }

  const matrix = pack.matrix
    ? {
        label: pack.matrix.label,
        columns: roster,
        rows: rows
          .filter((r) => r.record === pack.matrix!.record)
          .map((r) => ({
            id: r.id,
            label: label(r),
            cells: Object.fromEntries(
              roster.map((m): [string, Cell] => {
                const h = r.holder_member_id === m.id
                const c = r.covers_member_id === m.id
                return [m.id, h && c ? 'holds_and_covers' : h ? 'holds' : c ? 'covers' : null]
              }),
            ),
          })),
      }
    : null

  // Member names are part of the version so a rename is a visible change too.
  const result_version = createHash('sha256')
    .update(
      JSON.stringify(
        sortKeys({
          d: pack.id,
          rows: rows.map((r) => ({ ...r, holder: nameOf(r.holder_member_id) })),
        }),
      ),
    )
    .digest('hex')

  const required = active.filter((m) => !isMinorMember(m)).map((m) => ({ id: m.id, name: m.name }))
  const acks = (await getTenantCollection<DomainConfirmationDoc>(
    db,
    'domain_confirmations',
    tenantId,
  )
    .find({ domain_id: pack.id, result_version })
    .toArray()) as DomainConfirmationDoc[]
  const confirmed = active
    .filter((m) => !isMinorMember(m))
    .flatMap((m) => {
      const a = acks.find((x) => memberMatchesUser(m, x.user_id))
      return a ? [{ id: m.id, name: m.name, confirmed_at: a.confirmed_at }] : []
    })
  return {
    domain_id: pack.id,
    rows,
    matrix,
    gaps,
    result_version,
    confirmation: {
      required,
      confirmed,
      both_confirmed: required.length > 0 && confirmed.length === required.length,
      viewer_confirmed: !!viewerUserId && acks.some((a) => a.user_id === viewerUserId),
    },
  }
}
