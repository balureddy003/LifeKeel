/**
 * Draft provenance — which concrete figures in a generated draft actually
 * came from the family's real data.
 *
 * Product-review finding: prepared drafts mix retrieved facts, template
 * boilerplate, and model-inferred wording with no visual distinction, so a
 * reviewer can't tell "£55,000 — your policy on file" from "£55,000 — the
 * model invented it". Inline sentence-level tagging isn't honest (the LLM
 * can't reliably attribute its own output), so this takes the verifiable
 * version: extract concrete figures from the source text the model was
 * grounded on, check which survive verbatim into the draft, and hand the
 * UI that list. Everything else in the draft is, by definition, generated
 * wording — the UI labels it as such rather than us guessing.
 */

export interface DraftProvenance {
  /** Figures present in BOTH the source text and the draft — the
   *  grounded facts the UI can show as "from your data". */
  facts: string[]
}

// Currency amounts: £55,000 / $1,234.50 / €800 / £2k. Kept deliberately
// narrow — a bare "5" is never a fact worth attributing.
const MONEY_RE = /[£$€]\s?\d[\d,]*(?:\.\d{1,2})?[kKmM]?/g

// Number+unit phrases: "14 months", "3 years", "25%", "4 weeks".
const NUM_UNIT_RE = /\b\d[\d,]*(?:\.\d+)?\s?(?:months?|years?|weeks?|days?|percent|%)\b/gi

/** Comparison key — commas, spacing, and plural-vs-singular units are
 *  dressing ("£55,000" ≡ "£55000", "14 months" ≡ "14 month"), but the
 *  currency symbol is load-bearing: a draft claiming "$55,000" when the
 *  data says "£55,000" is a fabrication, not a match, and must not earn a
 *  "from your data" chip. A bare "55000" with no symbol doesn't match
 *  either — under-claiming is the honest failure mode here. */
function factKey(s: string): string {
  return s.toLowerCase().replace(/[,\s]/g, '').replace(/(months|years|weeks|days)$/, (u) => u.slice(0, -1))
}

export function extractDraftProvenance(sourceText: string, draftText: string): DraftProvenance {
  const draftKeys = factKey(draftText)
  const seen = new Set<string>()
  const facts: string[] = []
  for (const re of [MONEY_RE, NUM_UNIT_RE]) {
    for (const m of sourceText.matchAll(re)) {
      const raw = m[0].trim()
      const key = factKey(raw)
      // A key shorter than 2 chars is a bare unit-less digit — never a fact.
      if (key.length < 2 || seen.has(key)) continue
      seen.add(key)
      if (draftKeys.includes(key)) facts.push(raw)
    }
  }
  // Cap the list — past a handful of chips the UI stops being a trust
  // signal and starts being noise.
  return { facts: facts.slice(0, 8) }
}
