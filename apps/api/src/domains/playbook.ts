/**
 * Binds a domain pack to its first-steps playbook: for one named person, which
 * of the pack's records matter, and which do not. Facts only. It never says
 * whether the cover is enough and it starts no claim; the household contacts
 * each provider themselves.
 */
import type { DomainRow, RosterRef } from './adapters.js'
import type { DomainPack } from './types.js'

export interface PlaybookRow {
  id: string
  label: string
  claims_contact: string | null
  renewal_date: string | null
}

export interface DomainPlaybook {
  playbook: string
  member: RosterRef
  groups: Array<{
    key: 'theirs' | 'covers' | 'to_check' | 'others'
    label: string
    rows: PlaybookRow[]
  }>
}

const asRow = (pack: DomainPack, r: DomainRow): PlaybookRow => {
  const rec = pack.records.find((x) => x.key === r.record)!
  const detail = r.values['provider'] || r.values['name_as_printed'] || r.values['type']
  return {
    id: r.id,
    label: [rec.label, detail?.replace(/_/g, ' ')].filter(Boolean).join(' · '),
    claims_contact: r.values['claims_contact'] || null,
    renewal_date: r.values['renewal_date'] || null,
  }
}

export function buildDomainPlaybook(
  pack: DomainPack,
  rows: DomainRow[],
  member: RosterRef,
): DomainPlaybook | null {
  if (!pack.playbook) return null
  const shown = rows.filter((r) => pack.playbook!.show_records.includes(r.record))
  const theirs = shown.filter((r) => r.holder_member_id === member.id)
  const covers = shown.filter(
    (r) => r.covers_member_id === member.id && r.holder_member_id !== member.id,
  )
  const toCheck = shown.filter((r) => !r.holder_member_id)
  const others = shown.filter(
    (r) =>
      r.holder_member_id && r.holder_member_id !== member.id && r.covers_member_id !== member.id,
  )
  return {
    playbook: pack.playbook.playbook,
    member,
    groups: [
      {
        key: 'theirs',
        label: `On file for ${member.name}`,
        rows: theirs.map((r) => asRow(pack, r)),
      },
      {
        key: 'covers',
        label: `Held by someone else, covering ${member.name}`,
        rows: covers.map((r) => asRow(pack, r)),
      },
      {
        key: 'to_check',
        label: 'Not yet linked to a person. Check whether these were theirs',
        rows: toCheck.map((r) => asRow(pack, r)),
      },
      {
        key: 'others',
        label: 'Held by other family members, not part of this',
        rows: others.map((r) => asRow(pack, r)),
      },
    ].filter((g) => g.rows.length > 0) as DomainPlaybook['groups'],
  }
}
