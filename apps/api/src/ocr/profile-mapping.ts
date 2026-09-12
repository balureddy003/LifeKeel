/**
 * Maps OCR-extracted document fields to Financial Profile suggestions.
 *
 * extractDocumentFields() (extract.ts) already pulls structured fields out
 * of an uploaded document, but nothing ever did anything with them — they
 * sat on the document record while the Financial Profile form asked the
 * user to retype the same numbers by hand. This is deliberately
 * conservative: at most one suggestion per document, gated to fields we
 * have reasonable confidence about (a plain money amount), always
 * surfaced for the user to confirm rather than applied silently.
 */

const APPLICABLE_PATHS = [
  'household.life_cover_minor',
  'household.mortgage_outstanding_minor',
  'retirement.pension_balance_minor',
] as const

export type ApplicableProfilePath = (typeof APPLICABLE_PATHS)[number]

export function isApplicableProfilePath(path: string): path is ApplicableProfilePath {
  return (APPLICABLE_PATHS as readonly string[]).includes(path)
}

export interface ProfileSuggestion {
  path: ApplicableProfilePath
  label: string
  valueMinor: number
  sourceField: string
  sourceValue: string
}

/**
 * Parses a free-form money string (as GPT vision returns it — "$450,000.00",
 * "£1,140", "1140") into minor units (e.g. cents/pence). Strips anything
 * that isn't a digit or decimal point, so it won't handle European-style
 * "1.234,56" decimal commas — an acceptable v1 limitation given the rest of
 * the app's money handling is US/UK-style.
 */
export function parseMoneyToMinorUnits(raw: string | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}

function findMoneyField(
  fields: Record<string, string>,
  patterns: RegExp[],
): { key: string; raw: string } | null {
  for (const pattern of patterns) {
    const entry = Object.entries(fields).find(([key]) => pattern.test(key))
    if (entry) return { key: entry[0], raw: entry[1] }
  }
  return null
}

/**
 * At most one suggestion per document — pick the first candidate field name
 * (by priority order) that both exists and parses as a plausible amount.
 */
export function mapExtractedFieldsToProfileSuggestions(
  category: string,
  fields: Record<string, string>,
): ProfileSuggestion[] {
  const rules: Array<{
    category: string
    path: ApplicableProfilePath
    label: string
    patterns: RegExp[]
  }> = [
    {
      category: 'insurance',
      path: 'household.life_cover_minor',
      label: 'Life insurance cover',
      patterns: [/coverage.?amount/i, /sum.?assured/i, /death.?benefit/i, /balance/i, /amount/i],
    },
    {
      category: 'pension',
      path: 'retirement.pension_balance_minor',
      label: 'Pension balance',
      patterns: [/fund.?value/i, /balance/i, /value/i, /coverage.?amount/i],
    },
    {
      category: 'mortgage',
      path: 'household.mortgage_outstanding_minor',
      label: 'Mortgage outstanding',
      patterns: [/outstanding/i, /remaining.?balance/i, /balance/i, /coverage.?amount/i],
    },
  ]

  const rule = rules.find((r) => r.category === category)
  if (!rule) return []

  const found = findMoneyField(fields, rule.patterns)
  if (!found) return []

  const valueMinor = parseMoneyToMinorUnits(found.raw)
  if (!valueMinor) return []

  return [{ path: rule.path, label: rule.label, valueMinor, sourceField: found.key, sourceValue: found.raw }]
}
