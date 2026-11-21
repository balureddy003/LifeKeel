/**
 * Who has looked at each shared list, in one glanceable line per list.
 *
 * Pure and registry-driven: it takes whatever lists the API reports (every
 * domain pack, today and later) and says who confirmed which version and when.
 * A new service that reports the same confirmation shape shows up on Home with
 * no edit here. States, not judgements: it never says the cover is enough.
 */
export interface SeenInput {
  id: string
  title: string
  records: number
  result_version: string
  confirmation: {
    required: Array<{ id: string; name: string }>
    confirmed: Array<{ id: string; name: string; confirmed_at: string }>
    both_confirmed: boolean
    viewer_confirmed: boolean
  }
}

export interface SeenRow {
  id: string
  title: string
  /** 'you' = the viewer still has to confirm; 'waiting' = someone else; 'all' = everyone has. */
  state: 'you' | 'waiting' | 'all'
  line: string
  canConfirm: boolean
  resultVersion: string
  href: string
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'an earlier date'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export function seenStatus(lists: readonly SeenInput[]): SeenRow[] {
  return lists
    .filter((l) => l.records > 0)
    .map((l): SeenRow => {
      const { required, confirmed, both_confirmed, viewer_confirmed } = l.confirmation
      const solo = required.length === 1
      const done = confirmed.map(
        (p) => `${solo ? 'You' : p.name} confirmed on ${shortDate(p.confirmed_at)}.`,
      )
      const seen = new Set(confirmed.map((p) => p.id))
      const waiting = required.filter((p) => !seen.has(p.id)).map((p) => p.name)
      let line: string
      if (required.length === 0) line = 'No adults are on this list yet.'
      else if (both_confirmed) line = done.join(' ')
      else if (done.length === 0) line = `Not confirmed yet. Waiting for ${joinNames(waiting)}.`
      else line = `${done.join(' ')} Waiting for ${joinNames(waiting)}.`
      return {
        id: l.id,
        title: l.title,
        state: both_confirmed ? 'all' : viewer_confirmed ? 'waiting' : 'you',
        line,
        canConfirm: !viewer_confirmed && required.length > 0,
        resultVersion: l.result_version,
        href: `/domains?d=${encodeURIComponent(l.id)}`,
      }
    })
}
