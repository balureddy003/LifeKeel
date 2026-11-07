import type { DomainCell, DomainView } from '@/lib/api'

/** Plain-language text for a matrix cell. States a fact; never a judgement. */
export function cellText(cell: DomainCell): string {
  switch (cell) {
    case 'holds':
      return 'Holds it'
    case 'covers':
      return 'Covered'
    case 'holds_and_covers':
      return 'Holds it and is covered'
    default:
      return 'Not recorded'
  }
}

/** One sentence on who has seen the current version. */
export function confirmSummary(c: DomainView['confirmation']): string {
  if (c.required.length === 0) return 'No adults in the family yet.'
  if (c.both_confirmed)
    return c.required.length === 1
      ? 'You have seen this.'
      : `All ${c.required.length} adults have seen this version.`
  const seen = new Set(c.confirmed.map((p) => p.id))
  const waiting = c.required.filter((p) => !seen.has(p.id)).map((p) => p.name)
  return `Waiting for ${waiting.join(' and ')} to confirm they have seen this version.`
}

/** When a date falls, in words. */
export function daysText(days: number): string {
  if (days === 0) return 'today'
  if (days > 0) return days === 1 ? 'tomorrow' : `in ${days} days`
  return days === -1 ? 'yesterday' : `${-days} days ago`
}

type Pack = DomainView['pack']
type Row = DomainView['rows'][number]

/** "Vehicle · AB12 CDE": the record's name and its first descriptive value. */
export function rowLabel(pack: Pack, row: Row): string {
  const rec = pack.records.find((r) => r.key === row.record)
  const first = rec?.fields.find((f) => f.kind !== 'member' && row.values[f.key])
  const detail = first ? (row.values[first.key] ?? '') : ''
  return [rec?.label ?? row.record, detail.replace(/_/g, ' ')].filter(Boolean).join(' · ')
}
