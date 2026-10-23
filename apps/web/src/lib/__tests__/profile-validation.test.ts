import { describe, expect, it } from 'vitest'
import {
  validateWizardStep,
  type WizardFormShape,
  type WizardFundShape,
  type WizardPolicyShape,
} from '../profile-validation'

const BASE_FORM: WizardFormShape = {
  monthlySalary: '5000',
  annualLivingExpenses: '36000',
  mortgageOutstanding: '250000',
  lifeCover: '300000',
  incomeProtectionMonthly: '2000',
  hasSecondEarner: false,
  secondEarnerMonthlySalary: '',
  secondEarnerIncomeProtectionMonthly: '',
  secondEarnerPensionBalance: '',
  secondEarnerPensionMonthly: '',
  emergencySavings: '15000',
  monthlyExpenses: '3000',
  hasHighInterestDebt: false,
  highInterestDebtBalance: '',
  monthlyDebtPayments: '0',
  currentAge: '35',
  targetRetirementAge: '65',
  pensionBalance: '80000',
  monthlyContribution: '400',
  targetRetirementIncome: '30000',
  expectedAnnualGrowthPct: '5',
}

const FUND: WizardFundShape = {
  childName: 'Mia',
  childAge: '5',
  currentSavings: '2000',
  targetSavings: '40000',
  yearsRemaining: '13',
}

const POLICY: WizardPolicyShape = {
  provider: 'Example Mutual',
  coverageAmount: '300000',
  monthlyPremium: '45',
}

describe('validateWizardStep', () => {
  it('accepts a fully populated valid form on every step', () => {
    for (const step of [
      'household',
      'protection',
      'emergency',
      'retirement',
      'education',
    ] as const) {
      expect(validateWizardStep(step, BASE_FORM, [FUND], [POLICY]), step).toEqual([])
    }
  })

  it('accepts blank optional fields', () => {
    const form = { ...BASE_FORM, monthlySalary: '', mortgageOutstanding: '', lifeCover: '' }
    expect(validateWizardStep('household', form, [], [])).toEqual([])
    expect(validateWizardStep('protection', form, [], [])).toEqual([])
  })

  it('rejects a negative salary with a named field error', () => {
    const issues = validateWizardStep('household', { ...BASE_FORM, monthlySalary: '-5000' }, [], [])
    expect(issues).toEqual([{ key: 'monthlySalary', message: "Monthly salary can't be negative" }])
  })

  it('rejects a value the server would happily store as nonsense', () => {
    const issues = validateWizardStep(
      'household',
      { ...BASE_FORM, annualLivingExpenses: '999999999' },
      [],
      [],
    )
    expect(issues).toEqual([
      {
        key: 'annualLivingExpenses',
        message: 'Annual living expenses looks too large — check for a stray digit',
      },
    ])
  })

  it('rejects non-numeric text', () => {
    const issues = validateWizardStep(
      'household',
      { ...BASE_FORM, mortgageOutstanding: 'abc' },
      [],
      [],
    )
    expect(issues).toEqual([
      { key: 'mortgageOutstanding', message: 'Mortgage outstanding must be a number' },
    ])
  })

  it('requires both ages (a blank submits 0 and fails server-side)', () => {
    const issues = validateWizardStep(
      'retirement',
      { ...BASE_FORM, currentAge: '', targetRetirementAge: '0' },
      [],
      [],
    )
    expect(issues.map((i) => i.key)).toEqual(['currentAge', 'targetRetirementAge'])
  })

  it('rejects an out-of-range growth rate', () => {
    const issues = validateWizardStep(
      'retirement',
      { ...BASE_FORM, expectedAnnualGrowthPct: '45' },
      [],
      [],
    )
    expect(issues).toEqual([
      {
        key: 'expectedAnnualGrowthPct',
        message: 'Assumed annual growth rate must be between 0 and 20%',
      },
    ])
  })

  it('checks policy rows that will be submitted, skips unnamed rows', () => {
    const issues = validateWizardStep(
      'protection',
      BASE_FORM,
      [],
      [
        { ...POLICY, coverageAmount: '-1' },
        { provider: '', coverageAmount: '-1', monthlyPremium: 'x' }, // dropped from payload
      ],
    )
    expect(issues).toEqual([
      { key: 'policy.0.coverageAmount', message: "Coverage amount can't be negative" },
    ])
  })

  it('checks fund rows that will be submitted, skips unnamed rows', () => {
    const issues = validateWizardStep(
      'education',
      BASE_FORM,
      [
        { ...FUND, childAge: 'not-an-age' },
        { ...FUND, childName: '', childAge: '999' }, // dropped from payload
      ],
      [],
    )
    expect(issues).toEqual([
      { key: 'fund.0.childAge', message: "Child's age must be a whole number" },
    ])
  })

  it('only checks the debt balance when high-interest debt is declared', () => {
    const form = { ...BASE_FORM, highInterestDebtBalance: '-10' }
    expect(validateWizardStep('emergency', form, [], [])).toEqual([])
    expect(validateWizardStep('emergency', { ...form, hasHighInterestDebt: true }, [], [])).toEqual(
      [{ key: 'highInterestDebtBalance', message: "Outstanding balance can't be negative" }],
    )
  })

  it('only checks second-earner fields when a second earner is declared', () => {
    const form = { ...BASE_FORM, secondEarnerMonthlySalary: '-100' }
    expect(validateWizardStep('household', form, [], [])).toEqual([])
    expect(validateWizardStep('household', { ...form, hasSecondEarner: true }, [], [])).toEqual([
      { key: 'secondEarnerMonthlySalary', message: "Their monthly salary can't be negative" },
    ])
  })
})
