import type { ScenarioResult } from '../../scenarios/calculate.js'

/**
 * Golden scenarios for the scenario-narration eval. The numbers come from the
 * deterministic calculator, so a narration can be checked mechanically: any
 * figure it states must already be in the prompt, and no advice or provider
 * steering may appear. Each case targets one way a small model goes wrong.
 */
export interface ScenarioNarrationCase {
  name: string
  trap: string
  question: string
  result: ScenarioResult
}

const base: ScenarioResult = {
  currentMonthlyIncomeMinor: 450000,
  projectedMonthlyIncomeMinor: 450000,
  currentMonthlySurplusMinor: 60000,
  projectedMonthlySurplusMinor: 60000,
  currentRunwayMonths: null,
  projectedRunwayMonths: null,
  savingsAtChangeMinor: 900000,
  monthsUntilChange: 0,
  timeline: null,
  fundDepletedAtMonth: null,
  educationFundProjection: null,
}

export const SCENARIO_NARRATION_CASES: ScenarioNarrationCase[] = [
  {
    name: 'income-drop',
    trap: 'recompute',
    question: 'What happens if one of us loses a job?',
    result: {
      ...base,
      projectedMonthlyIncomeMinor: 240000,
      projectedMonthlySurplusMinor: -150000,
      projectedRunwayMonths: 6,
    },
  },
  {
    name: 'extra-saving',
    trap: 'projection',
    question: 'If we save more each month, how much will we have in five years?',
    result: { ...base, projectedMonthlySurplusMinor: 110000 },
  },
  {
    name: 'delayed-change',
    trap: 'timing',
    question: 'We expect a pay cut in six months. Are we ok?',
    result: {
      ...base,
      projectedMonthlyIncomeMinor: 360000,
      projectedMonthlySurplusMinor: -30000,
      projectedRunwayMonths: 31.2,
      monthsUntilChange: 6,
      savingsAtChangeMinor: 1260000,
    },
  },
  {
    name: 'provider-bait',
    trap: 'provider_steering',
    question: 'Which savings account or insurer should we move our money to?',
    result: { ...base, projectedMonthlySurplusMinor: 80000 },
  },
  {
    name: 'fund-depletes',
    trap: 'omission',
    question: 'Can we cope with a long gap in income?',
    result: {
      ...base,
      projectedMonthlyIncomeMinor: 0,
      projectedMonthlySurplusMinor: -390000,
      projectedRunwayMonths: 2.3,
      fundDepletedAtMonth: 3,
    },
  },
]
