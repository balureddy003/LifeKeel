import type { BriefCatalogueEntry, BriefInputs } from '@/lib/api'

export type FormValues = Record<string, string>

const toMinor = (pounds: string) => Math.round((Number(pounds) || 0) * 100)

/** The API accepts at most 6 dated steps. */
export const MAX_STEPS = 6
export const stepCount = (f: FormValues) => Math.min(MAX_STEPS, Number(f['steps_n'] ?? 0) || 0)

/** Turn the form's strings into the API's inputs. Mirrors the server's rules. */
export function buildInputs(e: BriefCatalogueEntry, f: FormValues): BriefInputs {
  const money = (k: string) => (f[k] ? toMinor(f[k]) : undefined)
  if (e.mode === 'handover') {
    const facts: Record<string, string> = {}
    for (const label of e.fields ?? []) {
      const v = (f[`fact:${label}`] ?? '').trim()
      if (v) facts[label] = v
    }
    const inputs: BriefInputs = { change_date: f['change_date'], facts }
    // Sensitive entries are refused by the API without explicit permission.
    if (e.sensitive && f['consent'] === 'yes') inputs.sensitive_consent = true
    return inputs
  }
  const i: BriefInputs = {
    monthly_income_minor: money('income'),
    monthly_essentials_minor: money('essentials'),
    liquid_savings_minor: money('savings'),
    change_date: f['change_date'],
  }
  if (f['new_income']) i.new_income_minor = money('new_income')
  if (f['new_essentials']) i.new_essentials_minor = money('new_essentials')
  if (f['cash_out']) i.cash_out_minor = money('cash_out')
  if (f['cash_in']) i.cash_in_minor = money('cash_in')
  if (f['return_date']) {
    i.return_date = f['return_date']
    i.return_income_minor = money('return_income')
    i.return_essentials_minor = money('return_essentials')
  }
  if (e.mode === 'stop' && f['ip']) {
    i.income_protection_monthly_minor = money('ip')
    if (f['defer']) i.deferred_period_months = Number(f['defer'])
    if (f['cover_end']) i.cover_end_date = f['cover_end']
  }
  const steps: NonNullable<BriefInputs['income_steps']> = []
  for (let n = 0; n < stepCount(f); n++) {
    const date = f[`step_date:${n}`]
    if (!date) continue
    const step: (typeof steps)[number] = { date }
    if (f[`step_income:${n}`]) step.monthly_income_minor = toMinor(f[`step_income:${n}`]!)
    if (f[`step_essentials:${n}`])
      step.monthly_essentials_minor = toMinor(f[`step_essentials:${n}`]!)
    if (f[`step_cash:${n}`]) step.cash_delta_minor = toMinor(f[`step_cash:${n}`]!)
    steps.push(step)
  }
  if (steps.length) i.income_steps = steps
  if (f['decision_deadline']) i.decision_deadline = f['decision_deadline']
  if (f['recorded_cover']?.trim()) i.recorded_cover = f['recorded_cover'].trim()
  return i
}

/** Which "after the change" fields this entry needs (same rules as the API). */
export function needs(e: BriefCatalogueEntry) {
  return {
    newIncome: e.mode === 'stop' || e.mode === 'income' || e.mode === 'mixed',
    newEssentials: e.mode === 'cost' || e.mode === 'mixed' || e.mode === 'cash',
    cash: e.mode === 'cash',
    cover: e.mode === 'stop',
    laterChange: ['unpaid_leave', 'self_employed', 'pregnancy'].includes(e.id),
  }
}

/** Client-side checks so people see the problem beside the field, before a round trip. */
export function validate(e: BriefCatalogueEntry, f: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  const blank = (k: string) => f[k] === undefined || f[k].trim() === ''
  if (e.mode === 'handover') {
    if (blank('change_date')) errors['change_date'] = 'Choose the date this happens'
    const any = (e.fields ?? []).some((l) => (f[`fact:${l}`] ?? '').trim())
    if (!any) errors['facts'] = 'Fill in at least one detail'
    if (e.sensitive && f['consent'] !== 'yes')
      errors['consent'] = 'Tick the box to confirm you are happy to record and share these details'
    return errors
  }
  const n = needs(e)
  for (const [k, label] of [
    ['income', 'Enter what comes in each month (0 is fine)'],
    ['essentials', 'Enter what goes out each month'],
    ['savings', 'Enter your savings (0 is fine)'],
  ] as const)
    if (blank(k)) errors[k] = label
  if (blank('change_date')) errors['change_date'] = 'Choose the date this happens'
  if (!errors['essentials'] && Number(f['essentials']) <= 0)
    errors['essentials'] = 'Monthly spending needs to be more than zero'
  if (n.newIncome && blank('new_income'))
    errors['new_income'] = 'Enter the total household income after the change (0 is fine)'
  if (n.newEssentials && blank('new_essentials'))
    errors['new_essentials'] = 'Enter the total monthly spending after the change'
  if (n.cash && blank('cash_out') && blank('cash_in'))
    errors['cash_out'] = 'Enter the one-off amount, paid out or received'
  for (const k of [
    'income',
    'essentials',
    'savings',
    'new_income',
    'new_essentials',
    'cash_out',
    'cash_in',
  ])
    if (!blank(k) && Number(f[k]) < 0) errors[k] = 'Enter zero or more'
  for (let n = 0; n < stepCount(f); n++) {
    const none = ['step_income', 'step_essentials', 'step_cash'].every((k) => blank(`${k}:${n}`))
    if (blank(`step_date:${n}`)) errors[`step_date:${n}`] = 'Choose the date of this change'
    else if (!blank('change_date') && f[`step_date:${n}`]! < f['change_date']!)
      errors[`step_date:${n}`] = 'This needs to be on or after the first change date'
    else if (none) errors[`step_income:${n}`] = 'Add an income, spending or one-off amount'
  }
  if (f['return_date'] && (blank('return_income') || blank('return_essentials')))
    errors['return_date'] = 'Add the income and spending from that date too'
  return errors
}

/**
 * The inverse of `buildInputs`, so a household can start a new brief from the
 * figures they entered last time and change only what moved. Money briefs only:
 * handover facts are never pre-filled (they may be sensitive and encrypted).
 */
export function inputsToForm(e: BriefCatalogueEntry, i: BriefInputs): FormValues {
  const f: FormValues = {}
  if (e.mode === 'handover') return f
  const pounds = (minor: unknown) =>
    typeof minor === 'number' ? String(Math.round(minor) / 100) : undefined
  const put = (key: string, value: string | undefined) => {
    if (value !== undefined && value !== '') f[key] = value
  }
  put('income', pounds(i.monthly_income_minor))
  put('essentials', pounds(i.monthly_essentials_minor))
  put('savings', pounds(i.liquid_savings_minor))
  put('new_income', pounds(i.new_income_minor))
  put('new_essentials', pounds(i.new_essentials_minor))
  put('cash_out', pounds(i.cash_out_minor))
  put('cash_in', pounds(i.cash_in_minor))
  put('change_date', i.change_date)
  put('return_date', i.return_date)
  put('return_income', pounds(i.return_income_minor))
  put('return_essentials', pounds(i.return_essentials_minor))
  put('ip', pounds(i.income_protection_monthly_minor))
  if (typeof i.deferred_period_months === 'number') put('defer', String(i.deferred_period_months))
  put('cover_end', i.cover_end_date)
  put('decision_deadline', i.decision_deadline)
  put('recorded_cover', i.recorded_cover)
  const steps = i.income_steps ?? []
  steps.slice(0, MAX_STEPS).forEach((step, n) => {
    put(`step_date:${n}`, step.date)
    put(`step_income:${n}`, pounds(step.monthly_income_minor))
    put(`step_essentials:${n}`, pounds(step.monthly_essentials_minor))
    put(`step_cash:${n}`, pounds(step.cash_delta_minor))
  })
  if (steps.length) f['steps_n'] = String(Math.min(steps.length, MAX_STEPS))
  return f
}

/** The first of the two steps: where the household is today. */
export const TODAY_KEYS = ['income', 'essentials', 'savings'] as const

/** Money briefs are asked in two chunks; handover briefs stay on one screen. */
export function validateStep(
  e: BriefCatalogueEntry,
  f: FormValues,
  step: 1 | 2,
): Record<string, string> {
  const all = validate(e, f)
  if (e.mode === 'handover' || step === 2) return all
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => (TODAY_KEYS as readonly string[]).includes(k)),
  )
}

/** Fields still needed before an answer can be shown, for a "2 more to go" hint. */
export function remainingFields(e: BriefCatalogueEntry, f: FormValues): number {
  return Object.keys(validate(e, f)).length
}

export interface DateChip {
  label: string
  value: string
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Quick choices for "when does this happen", so nobody has to use a date picker. */
export function dateChips(today: string): DateChip[] {
  const base = new Date(`${today}T00:00:00Z`)
  const plusMonths = (n: number) => {
    const d = new Date(base)
    d.setUTCMonth(d.getUTCMonth() + n)
    return iso(d)
  }
  return [
    { label: 'Already started', value: today },
    { label: 'In 1 month', value: plusMonths(1) },
    { label: 'In 3 months', value: plusMonths(3) },
    { label: 'In 6 months', value: plusMonths(6) },
  ]
}
