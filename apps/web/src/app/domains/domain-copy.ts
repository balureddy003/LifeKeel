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
  if (c.required.length === 0) return 'No adults on the family list yet.'
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
