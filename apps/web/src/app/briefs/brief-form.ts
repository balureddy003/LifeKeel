import type { BriefCatalogueEntry, BriefInputs } from '@/lib/api'

export type FormValues = Record<string, string>

const toMinor = (pounds: string) => Math.round((Number(pounds) || 0) * 100)

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
  if (f['return_date'] && (blank('return_income') || blank('return_essentials')))
    errors['return_date'] = 'Add the income and spending from that date too'
  return errors
}
