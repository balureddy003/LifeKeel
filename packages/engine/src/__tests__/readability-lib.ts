/** Rough readability scoring shared by the copy tests. */
export const MAX_GRADE = 9

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 0
  if (w.length <= 3) return 1
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '')
  const groups = stripped.match(/[aeiouy]{1,2}/g)
  return Math.max(1, groups ? groups.length : 1)
}

export function grade(sentence: string): number {
  const words = sentence.split(/\s+/).filter((w) => /[a-z]/i.test(w))
  if (words.length === 0) return 0
  const syl = words.reduce((n, w) => n + syllables(w), 0)
  return 0.39 * words.length + 11.8 * (syl / words.length) - 15.59
}

/** Quoted strings that read as sentences (5+ words), template placeholders removed. */
export function sentencesIn(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) {
    const text = m[2]!.replace(/\$\{[^}]*\}/g, 'x').replace(/\\'/g, "'")
    if (text.split(/\s+/).length < 6) continue
    if (/[{}=<>/\\]|\.(ts|js|tsx|yaml)\b|^[a-z_]+$/.test(text)) continue
    out.push(text)
  }
  return out
}

/** Visible text written directly in JSX (between tags), whitespace collapsed. */
export function jsxTextIn(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/>([^<>{}]+)</g)) {
    const text = m[1]!
      .replace(/\s+/g, ' ')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .trim()
    if (text.split(' ').length < 6) continue
    if (/[=;(]/.test(text)) continue
    out.push(text)
  }
  return out
}

/** Every sentence a family could read in a source file: string literals and JSX text, minus class lists. */
export function copyIn(src: string, tsx: boolean): string[] {
  const all = [...sentencesIn(src), ...(tsx ? jsxTextIn(src) : [])]
    // Score one sentence at a time: a paragraph of short sentences is not hard to read.
    .flatMap((t) => t.split(/(?<=[.!?])\s+/))
    .filter((t) => t.split(/\s+/).length >= 6)
  // Tailwind class lists look like sentences; they are not copy.
  return all.filter((s) => (s.match(/\b[a-z]+-[a-z0-9[]/g) ?? []).length < 2)
}
