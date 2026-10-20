/**
 * Insight and feed text arrives with the detector rule's internal snake_case id as its
 * title (e.g. "estate_no_will"). Show a sentence-style label instead of the raw id.
 * Text that is already a sentence (spaces, punctuation) is returned unchanged.
 */
export function readableHypothesis(hypothesis: string): string {
  if (!/^[a-z0-9]+(_[a-z0-9]+)+$/i.test(hypothesis.trim())) return hypothesis
  // "estate_no_will" reads as "No will": a domain prefix before "no_" is dropped.
  const id = hypothesis
    .trim()
    .toLowerCase()
    .replace(/^(estate|legacy|protection|retirement)_(?=no_)/, '')
  const words = id.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
