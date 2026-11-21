/**
 * Plain words for what an edit to a policy changed and what stayed the same. Old and new figures only;
 * it never says whether a change is good or what to do about it.
 */
export interface ChangedFigure {
  label: string
  before: number
  after: number
}
export interface SameFigure {
  label: string
  value: number
}

const gbp = (minor: number) =>
  `£${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function describeChange(changes: { changed: ChangedFigure[]; unchanged: SameFigure[] }): {
  headline: string
  stays: string | null
} {
  if (changes.changed.length === 0) return { headline: 'Nothing changed.', stays: null }
  const headline = changes.changed
    .map((c) =>
      c.before === 0
        ? `${c.label} added: ${gbp(c.after)}.`
        : `${c.label} was ${gbp(c.before)}, now ${gbp(c.after)}.`,
    )
    .join(' ')
  const names = changes.unchanged.map((u) => u.label)
  const stays =
    names.length === 0
      ? null
      : `${[names[0], ...names.slice(1).map(lowerFirst)].join(' and ')} ${names.length === 1 ? 'stays' : 'stay'} the same.`
  return { headline, stays }
}
