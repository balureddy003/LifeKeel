import { z } from 'zod'
import { calculateScenario, type ScenarioStep } from '../scenarios/calculate.js'

type Mode = 'stop' | 'income' | 'cost' | 'mixed' | 'cash' | 'handover'
interface Entry {
  id: string
  title: string
  group: 'Money and income' | 'Practical handover' | 'Children'
  mode: Mode
  trigger: string
  fields?: readonly string[]
  sensitive?: boolean
  /** Downplay in the form: tier-4 problems exist but are not the pitch. */
  lowKey?: boolean
  /** Front-door moment this entry belongs to (Intent 80). */
  moment?: 'baby' | 'job' | 'care' | 'fix'
}

/** One catalogue drives the API allow-list and the form; no model chooses inputs. */
export const BRIEF_CATALOGUE: readonly Entry[] = [
  {
    id: 'income_stops',
    moment: 'job',
    title: 'One of us might stop earning',
    group: 'Money and income',
    mode: 'stop',
    trigger: 'Income stop date',
  },
  {
    id: 'earning_less',
    moment: 'job',
    title: 'Someone is about to earn less',
    group: 'Money and income',
    mode: 'income',
    trigger: 'Pay change date',
  },
  {
    id: 'job_change',
    moment: 'job',
    title: 'Job change or notice',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Date after final pay',
  },
  {
    id: 'hours_cut',
    moment: 'job',
    title: 'Hours cut, role changed, illness or recovery',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Change date',
  },
  {
    id: 'mortgage_fix',
    moment: 'fix',
    title: 'Mortgage fix ending',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'New payment date',
  },
  {
    id: 'fees_start',
    moment: 'baby',
    title: 'Nursery or school fees starting',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'Fees start date',
  },
  {
    id: 'fees_end',
    title: 'Nursery, school or private childcare fees ending',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'Fees end date',
  },
  {
    id: 'renewal',
    moment: 'fix',
    title: 'Renewal price rise',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'New premium effective date',
  },
  {
    id: 'self_employed',
    moment: 'job',
    title: 'Self-employed quiet period or tax bill',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Dip or bill date',
  },
  {
    id: 'supporting_relative',
    title: 'Supporting a parent or relative',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Support start date',
  },
  {
    id: 'moving_home',
    title: 'Moving home, new mortgage, downsizing or upsizing',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Completion date',
  },
  {
    id: 'child_leaving',
    title: 'Child starting university or leaving home',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'Term or move date',
  },
  {
    id: 'child_returning',
    title: 'Adult child moving back in',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'Move date',
  },
  {
    id: 'unpaid_leave',
    moment: 'job',
    title: 'Sabbatical or unpaid leave',
    group: 'Money and income',
    mode: 'income',
    trigger: 'Leave start date',
  },
  {
    id: 'retiring',
    moment: 'job',
    title: 'One adult retiring or taking pension early',
    group: 'Money and income',
    mode: 'income',
    trigger: 'Retirement date',
  },
  {
    id: 'debt_payoff',
    title: 'Paying off a large debt early',
    group: 'Money and income',
    mode: 'cash',
    trigger: 'Payment date',
  },
  {
    id: 'rental_change',
    moment: 'fix',
    title: 'Second property or rental change',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Change date',
  },
  {
    id: 'handover_gap',
    title: 'The other adult does not know',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    fields: [
      'People and contact details',
      'Key papers and their locations',
      'Accounts and record locations',
      'Cover and policy contacts',
    ],
  },
  {
    id: 'medical_contacts',
    moment: 'care',
    title: 'Medical emergency contacts',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    sensitive: true,
    fields: [
      'GP and contact details',
      'Allergies as recorded',
      'Medications as recorded',
      'Next of kin and contact details',
    ],
  },
  {
    id: 'school_handover',
    title: 'Childcare and school handover',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Handover date',
    sensitive: true,
    fields: [
      'Who can collect and contact details',
      'School or nursery contacts',
      'Location of agreed medical notes',
    ],
  },
  {
    id: 'home_emergency',
    title: 'Home emergency',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    fields: [
      'Boiler and service contact',
      'Plumber and electrician contacts',
      'Stopcock location',
      'Location of alarm instructions — not the code',
    ],
  },
  {
    id: 'digital_access',
    title: 'Digital access',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    fields: [
      'Critical accounts',
      'Location of recovery methods — not passwords or recovery codes',
      'Person who knows how to access them',
    ],
  },
  {
    id: 'care_handover',
    moment: 'care',
    title: 'Care for a parent or partner',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Care start date',
    sensitive: true,
    fields: [
      'Agreed responsibilities and who does what',
      'Contacts',
      'Location of agreed care notes',
    ],
  },
  {
    id: 'pet_care',
    title: 'Pet care',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Absence or handover date',
    fields: [
      'Pet and routine',
      'Vet contact',
      'Food and medication locations',
      'Person providing care',
    ],
  },
  {
    id: 'vehicle_handover',
    title: 'Vehicle and transport',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    fields: ['Vehicle and recorded cover', 'Insurer or breakdown contacts', 'Key location'],
  },
  {
    id: 'key_documents',
    title: 'Will, LPA and key document locations',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    fields: ['Documents known to exist', 'Original document locations', 'Named roles and contacts'],
  },
  {
    id: 'household_plan',
    title: 'Emergency household plan',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Facts checked on',
    fields: [
      'Agreed meeting point',
      'Out-of-area contact',
      'Who takes the children and contact details',
    ],
  },
  {
    id: 'pregnancy',
    moment: 'baby',
    title: 'Pregnancy and first year',
    group: 'Children',
    mode: 'mixed',
    trigger: 'Pay or cost change date / due date',
  },
  {
    id: 'nursery',
    moment: 'baby',
    title: 'Nursery',
    group: 'Children',
    mode: 'cost',
    trigger: 'Nursery start date',
  },
  {
    id: 'school_start',
    title: 'School start',
    group: 'Children',
    mode: 'cost',
    trigger: 'School start date',
  },
  {
    id: 'primary',
    title: 'Primary school',
    group: 'Children',
    mode: 'cost',
    trigger: 'New club or year start date',
  },
  {
    id: 'secondary',
    title: 'Secondary school',
    group: 'Children',
    mode: 'cost',
    trigger: 'Start date',
  },
  {
    id: 'college',
    title: 'Post-16 or college',
    group: 'Children',
    mode: 'mixed',
    trigger: 'Start date',
  },
  {
    id: 'university',
    title: 'University support costs',
    group: 'Children',
    mode: 'cost',
    trigger: 'Term start date',
  },
  {
    id: 'energy_council_tax',
    title: 'Energy or council tax rise',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'New amount from date',
    lowKey: true,
  },
  {
    id: 'car_repair',
    title: 'Car or essential repair bill',
    group: 'Money and income',
    mode: 'cash',
    trigger: 'Bill date',
    lowKey: true,
  },
  {
    id: 'joint_bill',
    title: 'A bill or joint account in one name',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Recorded on',
    fields: ['Bill or account', 'Who pays it', 'How it is paid'],
  },
  {
    id: 'bereavement',
    moment: 'care',
    title: 'Bereavement — the surviving adult',
    group: 'Practical handover',
    mode: 'handover',
    trigger: 'Recorded on',
    fields: ['Accounts and policies on file', 'Key contacts', 'Where the key papers are'],
    sensitive: true,
  },
  {
    id: 'rent_rise',
    moment: 'fix',
    title: 'Rent rise',
    group: 'Money and income',
    mode: 'cost',
    trigger: 'New rent date',
  },
  {
    id: 'tenancy_end',
    moment: 'fix',
    title: 'Tenancy ending or moving home',
    group: 'Money and income',
    mode: 'mixed',
    trigger: 'Move date',
  },
  {
    id: 'windfall',
    title: 'A lump sum arriving',
    group: 'Money and income',
    mode: 'cash',
    trigger: 'Date it lands',
  },
]

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
          monthly_income_minor: money,
          monthly_essentials_minor: money.optional(),
        }),
      )
      .max(6)
      .optional(),
    income_protection_monthly_minor: money.optional(),
    deferred_period_months: z.number().int().min(0).max(120).optional(),
    cover_end_date: date.optional(),
    decision_deadline: date.optional(),
    recorded_cover: z.string().trim().max(600).optional(),
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
const months = (n: number | null) =>
  n === null ? 'income covers the entered spending' : `savings last about ${n.toFixed(1)} months`
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
  if (!parsed.success)
    throw new Error('Check the amounts and dates; amounts must be non-negative and dates valid')
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
  if (['stop', 'income', 'mixed'].includes(entry.mode) && i.new_income_minor === undefined)
    throw new Error(
      'Enter total household income after the change, including any continuing income',
    )
  if (['cost', 'mixed', 'cash'].includes(entry.mode) && i.new_essentials_minor === undefined)
    throw new Error('Enter total monthly spending after the change')
  if (entry.mode === 'cash' && !(i.cash_out_minor || i.cash_in_minor))
    throw new Error('Enter the one-off cash payment')
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
    const stepIncome = step.monthly_income_minor
    const stepExpenses = step.monthly_essentials_minor ?? runExpenses
    steps.push({
      atMonth: Math.max(0, monthOffset(asOf, step.date)),
      monthlyIncomeDeltaMinor: stepIncome - runIncome,
      monthlyExpenseDeltaMinor: stepExpenses - runExpenses,
    })
    fact(`Dated step ${step.date} household income / month`, gbp(stepIncome))
    if (step.monthly_essentials_minor !== undefined)
      fact(`Dated step ${step.date} household spending / month`, gbp(stepExpenses))
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
  const gap =
    result.fundDepletedAtMonth === null
      ? ''
      : ` Savings reach zero around month ${result.fundDepletedAtMonth.toFixed(1)} from the calculation date.`
  const cashGap = result.unfundedCashMinor
    ? ` The entered one-off payments exceed available savings by ${gbp(result.unfundedCashMinor)}.`
    : ''
  return {
    inputs: i,
    result,
    facts,
    template_sentence: description + gap + cashGap + MONEY_DISCLAIMER,
  }
}

/**
 * Free-text handover fields say \"not passwords\" but accept any string — flag
 * likely secrets so the UI can warn without blocking (people sometimes write
 * a password anyway).
 */
const SECRET_FIELD = /\b(pass(?:word|code|phrase)?|pin\b|otp|token|secret|cvv|security answer)\b/i
const TOKEN_LIKE = /(?:^|\s)[A-Za-z0-9+/=_-]{20,}(?=\s|$)/
/** Intent 79: credential-shaped input is rejected with a plain message —
 *  a deterministic guard rail, not a control; the field hint does the real work. */
function rejectSecrets(facts: BriefFact[]): void {
  const hit = facts.find((f) => SECRET_FIELD.test(f.value) || TOKEN_LIKE.test(f.value))
  if (hit)
    throw new Error(
      `“${hit.label}” looks like it contains a password or code — record where the method lives, never the secret itself.`,
    )
}

/** Intent 80: every money brief states what it does not cover and points to
 *  free guidance — never "you can afford this". */
const MONEY_DISCLAIMER =
  ' Figures are the household’s own entries — tax, benefits, investment returns and price rises are not covered. Free guidance: MoneyHelper; for bigger decisions, a licensed professional.'
