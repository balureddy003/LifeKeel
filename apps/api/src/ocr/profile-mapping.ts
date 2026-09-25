/**
 * Maps OCR-extracted document fields to Financial Profile suggestions.
 *
 * extractDocumentFields() (extract.ts) already pulls structured fields out
 * of an uploaded document, but nothing ever did anything with them — they
 * sat on the document record while the Financial Profile form asked the
 * user to retype the same numbers by hand. This is deliberately
 * conservative: at most one scalar suggestion per document, gated to fields
 * we have reasonable confidence about (a plain money amount), always
 * surfaced for the user to confirm rather than applied silently.
 *
 * mapExtractedFieldsToPolicySuggestion() below is the same idea applied to
 * `policies[]` (PRD-102/105): an insurance document's provider/policy
 * number/coverage/renewal-date sat in `extracted_data` right alongside the
 * three scalar paths above, correctly OCR'd, with nothing that ever turned
 * them into a policy record — every policy had to be hand-typed in the
 * wizard regardless of what was uploaded or scanned from email. This closes
 * that gap: a best-effort, editable suggestion the user reviews before it's
 * added, never applied silently — same posture as the scalar suggestions.
 */

const APPLICABLE_PATHS = [
  'household.life_cover_minor',
  'household.mortgage_outstanding_minor',
  'retirement.pension_balance_minor',
  'household.monthly_salary_minor',
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

function findField(
  fields: Record<string, string>,
  patterns: RegExp[],
): { key: string; raw: string } | null {
  for (const pattern of patterns) {
    const entry = Object.entries(fields).find(([key]) => pattern.test(key))
    if (entry) return { key: entry[0], raw: entry[1] }
  }
  return null
}

function findMoneyField(
  fields: Record<string, string>,
  patterns: RegExp[],
): { key: string; raw: string } | null {
  return findField(fields, patterns)
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
    {
      category: 'income',
      path: 'household.monthly_salary_minor',
      label: 'Monthly salary',
      // net_pay preferred over gross — see extract.ts's CATEGORY_PROMPT
      // ("that's what a household actually receives"); a monthly_salary
      // path exists first in case the document states it directly.
      patterns: [/monthly.?salary/i, /net.?pay/i, /gross.?pay/i, /salary/i, /amount/i],
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

// Mirrors family-financial-profile.ts's policies[].type enum exactly — kept
// as an independent literal union rather than importing the zod-inferred
// type, so this module has no compile-time dependency on the routes layer.
export type PolicyType = 'life' | 'income_protection' | 'health' | 'critical_illness' | 'car' | 'home' | 'travel'

const POLICY_TYPES: readonly PolicyType[] = ['life', 'income_protection', 'health', 'critical_illness', 'car', 'home', 'travel']

export interface PolicySuggestion {
  /** null when OCR's policy_type guess doesn't match a known type — the user picks it in the review card. */
  type: PolicyType | null
  provider: string
  coverageAmountMinor: number | null
  monthlyPremiumMinor: number | null
  /** ISO "YYYY-MM-DD" only — anything OCR returned in a different format is left for the user to re-type, never guess-parsed. */
  renewalDate: string | null
  policyNumber: string | null
  /** The claims/emergency-assistance line stated on the document — never the claimant's own phone/email. */
  contactPhone: string | null
  contactEmail: string | null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function normalizePolicyType(raw: string | undefined): PolicyType | null {
  if (!raw) return null
  const normalized = raw.toLowerCase().trim().replace(/[\s-]+/g, '_')
  return (POLICY_TYPES as readonly string[]).includes(normalized) ? (normalized as PolicyType) : null
}

/**
 * Turns an OCR'd insurance document into an editable policies[] suggestion.
 * Provider is the minimum bar for a usable suggestion (same "reasonable
 * confidence" standard as the scalar suggestions above) — everything else
 * is filled in where found and left blank/null otherwise, for the user to
 * complete in the review card rather than being silently omitted or guessed.
 */
export function mapExtractedFieldsToPolicySuggestion(
  category: string,
  fields: Record<string, string>,
): PolicySuggestion | null {
  if (category !== 'insurance') return null

  const provider = findField(fields, [/^provider$/i, /insurer/i, /company/i])?.raw.trim()
  if (!provider) return null

  const type = normalizePolicyType(findField(fields, [/^policy.?type$/i])?.raw)

  const policyNumber = findField(fields, [/policy.?number/i, /policy.?no\b/i, /account.?number/i])?.raw ?? null

  const renewalRaw = findField(fields, [/renewal.?date/i, /maturity.?date/i, /due.?date/i, /expiry.?date/i])?.raw.trim()
  const renewalDate = renewalRaw && ISO_DATE.test(renewalRaw) ? renewalRaw : null

  const coverageMoney = findField(fields, [/coverage.?amount/i, /sum.?assured/i, /death.?benefit/i, /balance/i])
  const coverageAmountMinor = coverageMoney ? parseMoneyToMinorUnits(coverageMoney.raw) : null

  const premiumMoney = findField(fields, [/premium/i, /monthly.?amount/i])
  const monthlyPremiumMinor = premiumMoney ? parseMoneyToMinorUnits(premiumMoney.raw) : null

  const contactPhone = findField(fields, [/claims.?phone/i, /assistance.?phone/i, /claims.?line/i, /helpline/i, /24.?hour/i, /emergency.?number/i])?.raw.trim() ?? null
  const contactEmail = findField(fields, [/claims.?email/i, /assistance.?email/i])?.raw.trim() ?? null

  return { type, provider, coverageAmountMinor, monthlyPremiumMinor, renewalDate, policyNumber, contactPhone, contactEmail }
}
