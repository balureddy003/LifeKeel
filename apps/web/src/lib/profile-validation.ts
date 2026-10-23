/**
 * Client-side validation for the Financial Profile wizard, run before the
 * per-step autosave. The API schema (family-financial-profile.ts) rejects
 * negatives and non-integers with a bare 400, which used to surface only as
 * the generic "couldn't save" autosave banner while the wizard kept
 * advancing — the user never learned which field failed or that nothing
 * had been saved. These checks mirror the server rules (plus a plausibility
 * ceiling the schema deliberately doesn't impose) so bad input gets a
 * named, inline error and never reaches the wire.
 */

export interface FieldIssue {
  /** Key the page maps back to the offending input — a FormState key for
   *  scalar fields, or `policy.${index}.${field}` / `fund.${index}.${field}`
   *  for rows. */
  key: string
  message: string
}

// Whole-currency ceiling (~£100m): above every legitimate household figure
// the wizard collects (including London mortgages), so its only job is
// catching a stray extra digit — a live tester entered 999999999 and the
// server schema's .nonnegative() accepted it verbatim.
const MAX_MONEY_WHOLE = 99_999_999
const MAX_AGE = 120
// Server: expected_annual_growth_pct is .min(0).max(20).
const MAX_GROWTH_PCT = 20

function checkMoney(label: string, raw: string): string | null {
  const v = raw.trim()
  if (v === '') return null // blank = unset; the payload maps it to 0
  const n = Number(v)
  if (!Number.isFinite(n)) return `${label} must be a number`
  if (n < 0) return `${label} can't be negative`
  if (n > MAX_MONEY_WHOLE) return `${label} looks too large — check for a stray digit`
  return null
}

function checkInt(
  label: string,
  raw: string,
  opts: { required?: boolean; min?: number; max?: number } = {},
): string | null {
  const v = raw.trim()
  if (v === '') return opts.required ? `${label} is required` : null
  const n = Number(v)
  const min = opts.min ?? 0
  const max = opts.max ?? MAX_AGE
  if (!Number.isFinite(n) || !Number.isInteger(n)) return `${label} must be a whole number`
  if (n < min)
    return opts.required && min > 0 ? `${label} is required` : `${label} can't be below ${min}`
  if (n > max) return `${label} can't be above ${max}`
  return null
}

// Structural mirrors of the wizard's FormState/funds/policies — this repo
// hand-mirrors types between call sites rather than sharing them (see the
// note atop familySections.ts), so keep the fields in sync with
// financial-profile/page.tsx's interfaces.
export interface WizardFormShape {
  monthlySalary: string
  annualLivingExpenses: string
  mortgageOutstanding: string
  lifeCover: string
  incomeProtectionMonthly: string
  hasSecondEarner: boolean
  secondEarnerMonthlySalary: string
  secondEarnerIncomeProtectionMonthly: string
  secondEarnerPensionBalance: string
  secondEarnerPensionMonthly: string
  emergencySavings: string
  monthlyExpenses: string
  hasHighInterestDebt: boolean
  highInterestDebtBalance: string
  monthlyDebtPayments: string
  currentAge: string
  targetRetirementAge: string
  pensionBalance: string
  monthlyContribution: string
  targetRetirementIncome: string
  expectedAnnualGrowthPct: string
}

export interface WizardFundShape {
  childName: string
  childAge: string
  currentSavings: string
  targetSavings: string
  yearsRemaining: string
}

export interface WizardPolicyShape {
  provider: string
  coverageAmount: string
  monthlyPremium: string
}

export type WizardStepKey = 'household' | 'protection' | 'emergency' | 'retirement' | 'education'

/**
 * All issues on one wizard step. Rows that would be dropped from the submit
 * payload anyway (a policy with no provider, a fund with no child name)
 * are skipped — flagging numbers that will never be saved would block the
 * user on data that doesn't exist.
 */
export function validateWizardStep(
  step: WizardStepKey,
  form: WizardFormShape,
  funds: WizardFundShape[],
  policies: WizardPolicyShape[],
): FieldIssue[] {
  const issues: FieldIssue[] = []
  const money = (key: string, label: string, raw: string) => {
    const message = checkMoney(label, raw)
    if (message) issues.push({ key, message })
  }

  switch (step) {
    case 'household':
      money('monthlySalary', 'Monthly salary', form.monthlySalary)
      money('annualLivingExpenses', 'Annual living expenses', form.annualLivingExpenses)
      money('mortgageOutstanding', 'Mortgage outstanding', form.mortgageOutstanding)
      if (form.hasSecondEarner) {
        money('secondEarnerMonthlySalary', 'Their monthly salary', form.secondEarnerMonthlySalary)
        money(
          'secondEarnerIncomeProtectionMonthly',
          'Their income protection',
          form.secondEarnerIncomeProtectionMonthly,
        )
        money(
          'secondEarnerPensionBalance',
          'Their pension balance',
          form.secondEarnerPensionBalance,
        )
        money(
          'secondEarnerPensionMonthly',
          'Their monthly pension contribution',
          form.secondEarnerPensionMonthly,
        )
      }
      break
    case 'protection':
      money('lifeCover', 'Life insurance cover', form.lifeCover)
      money('incomeProtectionMonthly', 'Income protection', form.incomeProtectionMonthly)
      policies.forEach((p, i) => {
        if (!p.provider.trim()) return
        money(`policy.${i}.coverageAmount`, 'Coverage amount', p.coverageAmount)
        money(`policy.${i}.monthlyPremium`, 'Monthly premium', p.monthlyPremium)
      })
      break
    case 'emergency':
      money('emergencySavings', 'Emergency savings', form.emergencySavings)
      money('monthlyExpenses', 'Monthly expenses', form.monthlyExpenses)
      if (form.hasHighInterestDebt) {
        money('highInterestDebtBalance', 'Outstanding balance', form.highInterestDebtBalance)
      }
      money('monthlyDebtPayments', 'Monthly debt payments', form.monthlyDebtPayments)
      break
    case 'retirement': {
      // Both ages are required positive ints server-side — a blank submits
      // 0 and fails the same silent 400 this validation exists to prevent.
      const age = checkInt('Your current age', form.currentAge, { required: true, min: 1 })
      if (age) issues.push({ key: 'currentAge', message: age })
      const target = checkInt('Target retirement age', form.targetRetirementAge, {
        required: true,
        min: 1,
      })
      if (target) issues.push({ key: 'targetRetirementAge', message: target })
      money('pensionBalance', 'Pension balance', form.pensionBalance)
      money('monthlyContribution', 'Monthly pension contribution', form.monthlyContribution)
      money(
        'targetRetirementIncome',
        'Target annual retirement income',
        form.targetRetirementIncome,
      )
      const growth = form.expectedAnnualGrowthPct.trim()
      if (growth !== '') {
        const n = Number(growth)
        if (!Number.isFinite(n) || n < 0 || n > MAX_GROWTH_PCT) {
          issues.push({
            key: 'expectedAnnualGrowthPct',
            message: `Assumed annual growth rate must be between 0 and ${MAX_GROWTH_PCT}%`,
          })
        }
      }
      break
    }
    case 'education':
      funds.forEach((f, i) => {
        if (!f.childName.trim()) return
        const childAge = checkInt("Child's age", f.childAge)
        if (childAge) issues.push({ key: `fund.${i}.childAge`, message: childAge })
        money(`fund.${i}.currentSavings`, 'Saved so far', f.currentSavings)
        money(`fund.${i}.targetSavings`, 'Target amount', f.targetSavings)
        const years = checkInt('Years remaining', f.yearsRemaining)
        if (years) issues.push({ key: `fund.${i}.yearsRemaining`, message: years })
      })
      break
  }
  return issues
}
