import { z } from 'zod'
import { calculateScenario, type ScenarioStep } from '../scenarios/calculate.js'

import { BRIEF_CATALOGUE } from './catalogue-entries.js'
export { BRIEF_CATALOGUE }

const money = z.number().int().min(0).max(1_000_000_000)
const date = z.iso.date()
export const CatalogueInputsSchema = z
  .object({
    monthly_income_minor: money.optional(),
    monthly_essentials_minor: money.optional(),
    liquid_savings_minor: money.optional(),
    new_income_minor: money.optional(),
    new_essentials_minor: money.optional(),
    change_date: date,
    cash_out_minor: money.optional(),
    cash_in_minor: money.optional(),
    return_date: date.optional(),
    return_income_minor: money.optional(),
    return_essentials_minor: money.optional(),
    income_steps: z
      .array(
        z.object({
          date,
          // One-off savings movement at this step (lump cost or receipt).
          monthly_income_minor: money.optional(),
          monthly_essentials_minor: money.optional(),
          cash_delta_minor: money.optional(),
        }),
      )
      .max(6)
      .optional(),
    income_protection_monthly_minor: money.optional(),
    deferred_period_months: z.number().int().min(0).max(120).optional(),
    cover_end_date: date.optional(),
    decision_deadline: date.optional(),
    recorded_cover: z.string().trim().max(600).optional(),
    cover_may_end_with_employment: z.literal(true).optional(),
    facts: z.record(z.string().max(100), z.string().trim().max(2000)).optional(),
    sensitive_consent: z.literal(true).optional(),
  })
  .strict()
export type CatalogueInputs = z.infer<typeof CatalogueInputsSchema>
export interface BriefFact {
  label: string
  value: string
}
const gbp = (n: number) =>
  `£${(n / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Beyond this the number stops meaning anything (a 1p-a-month shortfall). */
const MAX_MONTHS = 600
const months = (n: number | null) => {
  if (n === null) return 'income covers the entered spending'
  if (n >= MAX_MONTHS) return 'savings last more than 50 years'
  if (n < 0.05) return 'there are no savings to draw on'
  return `savings last about ${n.toFixed(1)} months`
}
const monthOffset = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / ((86_400_000 * 365.25) / 12)

/**
 * Only entered facts and deterministic arithmetic. Dates use elapsed days /
 * average month length, disclosed with every result. No rates or benefits are
 * inferred. A new snapshot is needed when inputs change.
 */
export function solveCatalogueBrief(problem: string, raw: unknown, asOf: string) {
  const entry = BRIEF_CATALOGUE.find((e) => e.id === problem)
  if (!entry) throw new Error('Choose a brief from the catalogue')
  const parsed = CatalogueInputsSchema.safeParse(raw)
  if (!parsed.success) throw new Error(friendlyInputError(parsed.error))
  const i = parsed.data
  const facts: BriefFact[] = []
  const fact = (label: string, value: string | undefined) => {
    if (value) facts.push({ label, value })
  }
  fact(entry.trigger, i.change_date)
  if (entry.mode === 'handover') {
    if (entry.sensitive && !i.sensitive_consent)
      throw new Error('Permission to record and share these details is required')
    const allowed = new Set(entry.fields)
    if (Object.keys(i.facts ?? {}).some((key) => !allowed.has(key)))
      throw new Error('Unknown handover field')
    for (const label of entry.fields ?? []) fact(label, i.facts?.[label] || 'Not entered')
    if (!Object.values(i.facts ?? {}).some((value) => value.trim()))
      throw new Error('Enter at least one handover fact')
    rejectSecrets(facts)
    return {
      inputs: i,
      result: null,
      facts,
      template_sentence:
        'These are the household’s recorded facts. Missing details are marked “Not entered”.',
    }
  }
  if (i.facts && Object.keys(i.facts).length)
    throw new Error('Handover details belong in a handover brief')
  if (
    i.monthly_income_minor === undefined ||
    i.monthly_essentials_minor === undefined ||
    i.liquid_savings_minor === undefined
  )
    throw new Error(
      'Enter current household income, spending and liquid savings, including zero where applicable',
    )
  if (i.monthly_essentials_minor <= 0) throw new Error('Monthly spending must be greater than zero')
  // Friction budget (PRD-230): three money fields and a date are enough for a
  // first number. Anything about the change that is not entered yet is held at
  // today's figure, and the result says so rather than guessing a value.
  const assumed: [string, string][] = []
  if (['stop', 'income', 'mixed'].includes(entry.mode) && i.new_income_minor === undefined)
    assumed.push(['Assumed: income after the change', 'Not entered, shown the same as today'])
  if (['cost', 'mixed', 'cash'].includes(entry.mode) && i.new_essentials_minor === undefined)
    assumed.push(['Assumed: spending after the change', 'Not entered, shown the same as today'])
  if (entry.mode === 'cash' && !(i.cash_out_minor || i.cash_in_minor))
    assumed.push(['Assumed: one-off amount', 'Not entered, so savings are shown before it'])
  for (const [label, value] of assumed) fact(label, value)
  const assumedNote = assumed.length
    ? ' This is a partial answer: the figures for the change itself have not been entered yet, so add them for the full picture.'
    : ''
  if (
    i.return_date &&
    (i.return_date <= i.change_date ||
      i.return_income_minor === undefined ||
      i.return_essentials_minor === undefined)
  )
    throw new Error(
      'For a later change, enter a later date and the household income and spending then',
    )
  if (
    !i.return_date &&
    (i.return_income_minor !== undefined || i.return_essentials_minor !== undefined)
  )
    throw new Error('Enter the date of the later change')
  const at = Math.max(0, monthOffset(asOf, i.change_date))
  const nextIncome = i.new_income_minor ?? i.monthly_income_minor
  const nextExpenses = i.new_essentials_minor ?? i.monthly_essentials_minor
  const steps: ScenarioStep[] = [
    {
      atMonth: at,
      monthlyIncomeDeltaMinor: nextIncome - i.monthly_income_minor,
      monthlyExpenseDeltaMinor: nextExpenses - i.monthly_essentials_minor,
      savingsDeltaMinor: (i.cash_in_minor ?? 0) - (i.cash_out_minor ?? 0),
    },
  ]
  const cover = i.income_protection_monthly_minor ?? 0
  if (cover > 0) {
    if (entry.mode !== 'stop')
      throw new Error('Enter any expected cover payments in total household income for this brief')
    const coverStart = at + (i.deferred_period_months ?? 0)
    const coverEnd = i.cover_end_date ? monthOffset(asOf, i.cover_end_date) : null
    if (coverEnd !== null && coverEnd <= coverStart)
      throw new Error('Cover must end after its waiting period')
    steps.push({ atMonth: coverStart, monthlyIncomeDeltaMinor: cover })
    if (coverEnd !== null) steps.push({ atMonth: coverEnd, monthlyIncomeDeltaMinor: -cover })
    fact('Entered cover payment / month', gbp(cover))
    fact('Cover waiting period (months)', String(i.deferred_period_months ?? 0))
    fact(
      'Cover payment end',
      i.cover_end_date ?? 'No end entered; calculation assumes payments continue',
    )
  }
  if (i.return_date) {
    steps.push({
      atMonth: monthOffset(asOf, i.return_date),
      monthlyIncomeDeltaMinor: i.return_income_minor! - nextIncome,
      monthlyExpenseDeltaMinor: i.return_essentials_minor! - nextExpenses,
    })
    fact('Later change date', i.return_date)
    fact('Later household income / month (excluding separate cover)', gbp(i.return_income_minor!))
    fact('Later household spending / month', gbp(i.return_essentials_minor!))
  }
  let runIncome = nextIncome
  let runExpenses = nextExpenses
  if (i.return_date) {
    runIncome = i.return_income_minor!
    runExpenses = i.return_essentials_minor!
  }
  for (const step of [...(i.income_steps ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (step.date < i.change_date)
      throw new Error('Each dated step must be on or after the change date')
    if (
      step.monthly_income_minor === undefined &&
      step.monthly_essentials_minor === undefined &&
      step.cash_delta_minor === undefined
    )
      throw new Error('Each dated step needs an income, spending, or one-off amount')
    const stepIncome = step.monthly_income_minor ?? runIncome
    const stepExpenses = step.monthly_essentials_minor ?? runExpenses
    steps.push({
      atMonth: Math.max(0, monthOffset(asOf, step.date)),
      monthlyIncomeDeltaMinor: stepIncome - runIncome,
      monthlyExpenseDeltaMinor: stepExpenses - runExpenses,
      ...(step.cash_delta_minor !== undefined ? { savingsDeltaMinor: step.cash_delta_minor } : {}),
    })
    fact(`Dated step ${step.date} household income / month`, gbp(stepIncome))
    if (step.monthly_essentials_minor !== undefined)
      fact(`Dated step ${step.date} household spending / month`, gbp(stepExpenses))
    if (step.cash_delta_minor !== undefined)
      fact(`Dated step ${step.date} one-off savings movement`, gbp(step.cash_delta_minor))
    runIncome = stepIncome
    runExpenses = stepExpenses
  }
  steps.sort((a, b) => a.atMonth - b.atMonth)
  fact('Calculation date', asOf)
  fact('Current household income / month', gbp(i.monthly_income_minor))
  fact('Current household spending / month', gbp(i.monthly_essentials_minor))
  fact('Liquid savings now', gbp(i.liquid_savings_minor))
  fact('Household income after change / month (excluding separate cover)', gbp(nextIncome))
  fact('Household spending after change / month', gbp(nextExpenses))
  if (i.cash_out_minor) fact('One-off payment from savings', gbp(i.cash_out_minor))
  if (i.cash_in_minor) fact('One-off cash received', gbp(i.cash_in_minor))
  fact('Recorded cover / end date notes', i.recorded_cover)
  fact('Household-entered deadline', i.decision_deadline)
  const result = calculateScenario(
    {
      monthlyIncomeMinor: i.monthly_income_minor,
      monthlyExpensesMinor: i.monthly_essentials_minor,
      emergencySavingsMinor: i.liquid_savings_minor,
      educationFunds: [],
    },
    { steps },
  )
  const first = result.timeline![0]!
  const final = result.timeline![result.timeline!.length - 1]!
  const description = `Before the change, ${months(result.currentRunwayMonths)}. At the first change, ${months(first.runwayMonths)}. After the last entered change, ${months(final.runwayMonths)}.`
  // The solver records depletion only between steps. After the last step the
  // final regime runs on indefinitely, so a fund that is still draining there
  // would otherwise never be reported.
  const finalBurn = final.monthlyIncomeMinor - final.monthlyExpensesMinor
  const depletedAt =
    result.fundDepletedAtMonth ??
    (finalBurn < 0 ? final.atMonth + final.savingsMinor / -finalBurn : null)
  const gap =
    depletedAt === null || depletedAt >= MAX_MONTHS
      ? ''
      : ` On these figures savings would run out around ${monthLabel(asOf, depletedAt)} (about month ${depletedAt.toFixed(1)} from the calculation date).`
  const coverNote = i.cover_may_end_with_employment
    ? ` Cover on file may end with the employment${i.cover_end_date ? ` (${i.cover_end_date})` : ''}.`
    : ''
  const cashGap = result.unfundedCashMinor
    ? ` The entered one-off payments exceed available savings by ${gbp(result.unfundedCashMinor)}.`
    : ''
  const oneOff =
    (i.cash_in_minor || i.cash_out_minor) && !result.unfundedCashMinor
      ? ` Just after the one-off amount, savings are about ${gbp(first.savingsMinor)} (${gbp(i.liquid_savings_minor)} today).`
      : ''
  return {
    inputs: i,
    result,
    facts,
    template_sentence:
      description + oneOff + gap + cashGap + coverNote + assumedNote + MONEY_DISCLAIMER,
  }
}

const monthLabel = (asOf: string, monthsFrom: number) =>
  new Date(Date.parse(asOf) + monthsFrom * 30.4375 * 86_400_000).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

const FIELD_LABELS: Record<string, string> = {
  monthly_income_minor: 'Take-home income',
  monthly_essentials_minor: 'Spending',
  liquid_savings_minor: 'Liquid savings',
  new_income_minor: 'Income after the change',
  new_essentials_minor: 'Spending after the change',
  change_date: 'The change date',
  cash_out_minor: 'The one-off payment',
  cash_in_minor: 'The one-off cash received',
  return_date: 'The later change date',
  return_income_minor: 'Income at the later change',
  return_essentials_minor: 'Spending at the later change',
  income_steps: 'Later changes',
  income_protection_monthly_minor: 'The cover payment',
  deferred_period_months: 'The cover waiting period',
  cover_end_date: 'The cover end date',
  decision_deadline: 'The deadline',
  recorded_cover: 'The cover notes',
  facts: 'The handover details',
  sensitive_consent: 'Permission',
}

/** Name the field that failed instead of a generic "check the amounts" line. */
function friendlyInputError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Check the details and try again'
  if (issue.code === 'unrecognized_keys')
    return `Unexpected detail: ${issue.keys.map((k) => FIELD_LABELS[k] ?? k).join(', ')}`
  const key = String(issue.path[0] ?? '')
  if (key === 'sensitive_consent') return 'Permission to record and share these details is required'
  const label = FIELD_LABELS[key] ?? 'One of the details'
  if (issue.code === 'too_big' && key === 'income_steps') return 'You can add up to 6 later changes'
  if (key === 'change_date' && issue.code === 'invalid_type') return 'Enter the date of the change'
  if (issue.code === 'invalid_type' && key.endsWith('_minor'))
    return `${label} needs to be a whole number of pence`
  if (key.endsWith('_date') || key === 'change_date' || issue.path.includes('date'))
    return `${label} needs to be a real date`
  if (issue.code === 'too_big') return `${label} is too large`
  if (key.endsWith('_minor') || issue.path.includes('monthly_income_minor'))
    return `${label} must be zero or more`
  return `${label} needs checking`
}

/**
 * Free-text handover fields say \"not passwords\" but accept any string — flag
 * likely secrets so the UI can warn without blocking (people sometimes write
 * a password anyway).
 */
export const SECRET_PATTERNS: RegExp[] = [
  // "password: Summer2024!" / "passcode is 482913": a password-like word followed
  // by something that looks like the secret itself (has a digit or symbol).
  /\b(?:pass(?:word|code|phrase)|passwd|pwd)\b\s*(?:is|are|:|=)\s*(?=\S{6,})\S*[\d!@#$%^&*]\S*/i,
  // "pin 4821", "PIN is 123456"
  /\bpin\b\s*(?:is|number|code|:|=)?\s*\d{4,8}\b/i,
  // a card number (13-19 digits, optional spaces or dashes)
  /\b(?:\d[ -]?){13,19}\b/,
  // a long mixed letter-and-digit run with no spaces, e.g. an API key or recovery code
  /(?:^|\s)(?=[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[A-Za-z])[A-Za-z0-9+/=_-]{20,}(?=\s|$)/,
]
/** Intent 79: credential-shaped input is rejected with a plain message —
 *  a deterministic guard rail, not a control; the field hint does the real work. */
function rejectSecrets(facts: BriefFact[]): void {
  const hit = facts.find((f) => SECRET_PATTERNS.some((re) => re.test(f.value)))
  if (hit)
    throw new Error(
      `“${hit.label}” looks like it contains a password or code — record where the method lives, never the secret itself.`,
    )
}

/** Intent 80: every money brief states what it does not cover and points to
 *  free guidance — never "you can afford this". */
const MONEY_DISCLAIMER =
  ' Figures are the household’s own entries — tax, benefits, investment returns and price rises are not covered. Free guidance: MoneyHelper; for bigger decisions, a licensed professional.'
