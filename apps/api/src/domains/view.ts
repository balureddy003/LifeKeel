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

export type Cell = 'holds' | 'covers' | 'holds_and_covers' | 'employer' | null

export interface DomainView {
  domain_id: string
  rows: DomainRow[]
  matrix: {
    label: string
    columns: RosterRef[]
    /** Members no row names as holder or covered person. A fact about the list, not a judgement. */
    no_policy_on_file: RosterRef[]
    rows: Array<{ id: string; label: string; cells: Record<string, Cell> }>
  } | null
  /** Facts about the record itself, never a judgement about adequacy. */
  gaps: Array<{ row_id: string; note: string }>
  /** Dates that prompt a re-check: due within the trigger's lead time, or already past. */
  upcoming: Array<{
    trigger: string
    label: string
    row_id: string
    row_label: string
    date: string
    days: number
  }>
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

export async function loadDomainRows(db: Db, tenantId: string, pack: DomainPack) {
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

  return { active, roster, rows, members: group?.members ?? [] }
}

export async function buildDomainView(
  db: Db,
  tenantId: string,
  pack: DomainPack,
  viewerUserId?: string,
  now: Date = new Date(),
): Promise<DomainView> {
  const { active, roster, rows, members } = await loadDomainRows(db, tenantId, pack)

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
      gaps.push({ row_id: r.id, note: 'Held by someone no longer in the family' })
    if (r.covers_member_id && !rosterIds.has(r.covers_member_id))
      gaps.push({ row_id: r.id, note: 'Covers someone no longer in the family' })
  }

  const matrix = pack.matrix
    ? {
        label: pack.matrix.label,
        columns: roster,
        no_policy_on_file: roster.filter(
          (m) =>
            !rows.some(
              (r) =>
                (r.record === pack.matrix!.record || pack.matrix!.also?.includes(r.record)) &&
                (r.holder_member_id === m.id || r.covers_member_id === m.id),
            ),
        ),
        rows: rows
          .filter((r) => r.record === pack.matrix!.record || pack.matrix!.also?.includes(r.record))
          .map((r) => ({
            id: r.id,
            label: label(r),
            cells: Object.fromEntries(
              roster.map((m): [string, Cell] => {
                const h = r.holder_member_id === m.id
                const c = r.covers_member_id === m.id
                if (h && r.record !== pack.matrix!.record) return [m.id, 'employer']
                return [m.id, h && c ? 'holds_and_covers' : h ? 'holds' : c ? 'covers' : null]
              }),
            ),
          })),
      }
    : null

  const upcoming: DomainView['upcoming'] = []
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (const t of pack.planning) {
    if (t.on.kind !== 'date_field') continue
    const { record, field } = t.on
    for (const r of rows.filter((x) => x.record === record)) {
      const raw = r.values[field]
      const at = raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? Date.parse(raw.slice(0, 10)) : NaN
      if (Number.isNaN(at)) continue
      const days = Math.round((at - today) / 86_400_000)
      if (days <= t.lead_days)
        upcoming.push({
          trigger: t.key,
          label: t.label,
          row_id: r.id,
          row_label: label(r),
          date: raw!.slice(0, 10),
          days,
        })
    }
  }
  upcoming.sort((a, b) => a.days - b.days)

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

  // Everyone who has to see the list: each adult on the roster, joined or not,
  // unless the organizer said they do not need to. A person who has not joined
  // cannot confirm yet, so the list is not called "seen by every adult" until
  // they have, or the organizer excuses or removes them. Children and anyone
  // under 18 are never asked.
  const mustConfirm = members.filter(
    (m) =>
      (m.status === 'active' || m.status === 'pending') && !isMinorMember(m) && !m.confirm_exempt,
  )
  const required = mustConfirm.map((m) => ({ id: m.id, name: m.name }))
  const acks = (await getTenantCollection<DomainConfirmationDoc>(
    db,
    'domain_confirmations',
    tenantId,
  )
    .find({ domain_id: pack.id, result_version })
    .toArray()) as DomainConfirmationDoc[]
  const confirmed = mustConfirm.flatMap((m) => {
    const a = acks.find((x) => memberMatchesUser(m, x.user_id))
    return a ? [{ id: m.id, name: m.name, confirmed_at: a.confirmed_at }] : []
  })
  return {
    domain_id: pack.id,
    rows,
    matrix,
    gaps,
    upcoming,
    result_version,
    confirmation: {
      required,
      confirmed,
      both_confirmed: required.length > 0 && confirmed.length === required.length,
      viewer_confirmed: !!viewerUserId && acks.some((a) => a.user_id === viewerUserId),
    },
  }
}
