/**
 * Family & Household detector rule tests
 *
 * Validates the four family detector YAMLs by evaluating their filtrex rule
 * conditions and numeric impact expressions against representative signals.
 * Mirrors the pattern in trading-detectors.test.ts and social-detectors.test.ts.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { evaluate, evaluateNumeric } from '../evaluator.js'

const DETECTORS_DIR = path.join(__dirname, '..', '..', '..', '..', 'detectors', 'family')

const FILENAME_MAP: Record<string, string> = {
  family_protection_gap: 'protection-gap.yaml',
  family_education_shortfall: 'education-shortfall.yaml',
  family_emergency_fund_adequacy: 'emergency-fund-adequacy.yaml',
  family_retirement_gap: 'retirement-gap.yaml',
}

async function loadDetector(id: string): Promise<{
  rules: Array<{
    id: string
    condition: string
    impact_low: string | number
    impact_high: string | number
    reasoning_template: string
    actions: string[]
  }>
}> {
  const filename = FILENAME_MAP[id]
  if (!filename) throw new Error(`Unknown family detector: ${id}`)
  const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
  return yaml.load(content) as any
}

function ruleById(
  detector: {
    rules: Array<{
      id: string
      condition: string
      impact_low: string | number
      impact_high: string | number
    }>
  },
  ruleId: string,
) {
  const rule = detector.rules.find((r) => r.id === ruleId)
  if (!rule) throw new Error(`Rule not found: ${ruleId}`)
  return rule
}

describe('Family & Household detectors', () => {
  describe('family_protection_gap', () => {
    it('fires life_insurance_below_household_needs when cover is below estimated needs', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'life_insurance_below_household_needs')
      const fired = evaluate(rule.condition, {
        data: {
          life_cover_minor: 500_000,
          mortgage_outstanding_minor: 1_200_000,
          education_funding_gap_minor: 300_000,
          annual_living_expenses_minor: 480_000,
          has_dependents: 0,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire life_insurance_below_household_needs when cover exceeds needs', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'life_insurance_below_household_needs')
      const fired = evaluate(rule.condition, {
        data: {
          life_cover_minor: 5_000_000,
          mortgage_outstanding_minor: 1_200_000,
          education_funding_gap_minor: 300_000,
          annual_living_expenses_minor: 480_000,
          has_dependents: 0,
        },
      })
      expect(fired).toBe(false)
    })

    it('fires when life_cover_minor is zero and genuine household need exists (see PR #270)', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'life_insurance_below_household_needs')
      const fired = evaluate(rule.condition, {
        data: {
          life_cover_minor: 0,
          mortgage_outstanding_minor: 1_200_000,
          education_funding_gap_minor: 300_000,
          annual_living_expenses_minor: 480_000,
          has_dependents: 0,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire when life_cover_minor is zero and there is no household need either', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'life_insurance_below_household_needs')
      const fired = evaluate(rule.condition, {
        data: {
          life_cover_minor: 0,
          mortgage_outstanding_minor: 0,
          education_funding_gap_minor: 0,
          annual_living_expenses_minor: 0,
          has_dependents: 0,
        },
      })
      expect(fired).toBe(false)
    })

    it('PRD-105: fires when there is no mortgage but a dependent exists (the gate is an "or")', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'life_insurance_below_household_needs')
      const fired = evaluate(rule.condition, {
        data: {
          life_cover_minor: 0,
          mortgage_outstanding_minor: 0,
          education_funding_gap_minor: 300_000,
          annual_living_expenses_minor: 480_000,
          has_dependents: 1,
        },
      })
      expect(fired).toBe(true)
    })

    it('fires no_income_protection when employed with zero income protection', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'no_income_protection')
      const fired = evaluate(rule.condition, {
        data: {
          income_protection_monthly_minor: 0,
          employed: 1,
          years_to_retirement: 20,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire no_income_protection when income protection exists', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'no_income_protection')
      const fired = evaluate(rule.condition, {
        data: {
          income_protection_monthly_minor: 5_000,
          employed: 1,
          years_to_retirement: 20,
        },
      })
      expect(fired).toBe(false)
    })

    it('fires no_income_protection for self-employed households (employed flag set upstream for self-employed too)', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'no_income_protection')
      const fired = evaluate(rule.condition, {
        data: {
          income_protection_monthly_minor: 0,
          employed: 1, // set by the route for both 'employed' and 'self_employed' status
          years_to_retirement: 20,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire no_income_protection when within a year of target retirement age', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'no_income_protection')
      const fired = evaluate(rule.condition, {
        data: {
          income_protection_monthly_minor: 0,
          employed: 1,
          years_to_retirement: 1,
        },
      })
      expect(fired).toBe(false)
    })

    it('does not fire no_income_protection when already past target retirement age', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'no_income_protection')
      const fired = evaluate(rule.condition, {
        data: {
          income_protection_monthly_minor: 0,
          employed: 1,
          years_to_retirement: 0,
        },
      })
      expect(fired).toBe(false)
    })

    it('computes impact expressions correctly', async () => {
      const detector = await loadDetector('family_protection_gap')
      const rule = ruleById(detector, 'life_insurance_below_household_needs')
      const data = {
        life_cover_minor: 500_000,
        mortgage_outstanding_minor: 1_200_000,
        education_funding_gap_minor: 300_000,
        annual_living_expenses_minor: 480_000,
      }
      const gap = 1_200_000 + 300_000 + 480_000 * 5 - 500_000
      const low = evaluateNumeric(rule.impact_low as string, { data })
      const high = evaluateNumeric(rule.impact_high as string, { data })
      expect(low).toBe(Math.round(gap * 0.3))
      expect(high).toBe(gap)
    })
  })

  describe('family_education_shortfall', () => {
    it('fires education_fund_behind_target when savings below 50% and <= 5 years remaining', async () => {
      const detector = await loadDetector('family_education_shortfall')
      const rule = ruleById(detector, 'education_fund_behind_target')
      const fired = evaluate(rule.condition, {
        data: {
          current_savings_minor: 50_000,
          target_savings_minor: 200_000,
          years_remaining: 5,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire education_fund_behind_target when savings above 50%', async () => {
      const detector = await loadDetector('family_education_shortfall')
      const rule = ruleById(detector, 'education_fund_behind_target')
      const fired = evaluate(rule.condition, {
        data: {
          current_savings_minor: 150_000,
          target_savings_minor: 200_000,
          years_remaining: 5,
        },
      })
      expect(fired).toBe(false)
    })

    it('does not fire education_fund_behind_target when more than 5 years remain', async () => {
      const detector = await loadDetector('family_education_shortfall')
      const rule = ruleById(detector, 'education_fund_behind_target')
      const fired = evaluate(rule.condition, {
        data: {
          current_savings_minor: 50_000,
          target_savings_minor: 200_000,
          years_remaining: 10,
        },
      })
      expect(fired).toBe(false)
    })

    it('fires education_fund_not_started when no savings and child under 16', async () => {
      const detector = await loadDetector('family_education_shortfall')
      const rule = ruleById(detector, 'education_fund_not_started')
      const fired = evaluate(rule.condition, {
        data: {
          current_savings_minor: 0,
          years_remaining: 10,
          child_age: 8,
        },
      })
      expect(fired).toBe(true)
    })
  })

  describe('family_emergency_fund_adequacy', () => {
    it('fires emergency_fund_below_3_months when savings below 3 months expenses', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'emergency_fund_below_3_months')
      const fired = evaluate(rule.condition, {
        data: {
          emergency_savings_minor: 30_000,
          monthly_expenses_minor: 20_000,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire emergency_fund_below_3_months when savings exceed 3 months', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'emergency_fund_below_3_months')
      const fired = evaluate(rule.condition, {
        data: {
          emergency_savings_minor: 100_000,
          monthly_expenses_minor: 20_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('fires high_interest_debt_unaddressed when debt is present, regardless of savings level', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'high_interest_debt_unaddressed')
      const fired = evaluate(rule.condition, {
        data: {
          has_high_interest_debt: 1,
          high_interest_debt_balance_minor: 500_000,
          emergency_savings_minor: 10_000,
          monthly_expenses_minor: 20_000,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire high_interest_debt_unaddressed when there is no debt', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'high_interest_debt_unaddressed')
      const fired = evaluate(rule.condition, {
        data: {
          has_high_interest_debt: 0,
          high_interest_debt_balance_minor: 0,
          emergency_savings_minor: 10_000,
          monthly_expenses_minor: 20_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('does not fire high_interest_debt_unaddressed when debt flag is set but no balance was entered', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'high_interest_debt_unaddressed')
      const fired = evaluate(rule.condition, {
        data: {
          has_high_interest_debt: 1,
          high_interest_debt_balance_minor: 0,
          emergency_savings_minor: 10_000,
          monthly_expenses_minor: 20_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('computes high_interest_debt_unaddressed impact expressions correctly', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'high_interest_debt_unaddressed')
      const data = { high_interest_debt_balance_minor: 500_000 }
      const low = evaluateNumeric(rule.impact_low as string, { data })
      const high = evaluateNumeric(rule.impact_high as string, { data })
      expect(low).toBe(75_000)
      expect(high).toBe(125_000)
    })

    it('fires emergency_fund_overfunded when savings > 12 months and has high-interest debt', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'emergency_fund_overfunded')
      const fired = evaluate(rule.condition, {
        data: {
          emergency_savings_minor: 300_000,
          monthly_expenses_minor: 20_000,
          has_high_interest_debt: 1,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire emergency_fund_overfunded when no high-interest debt', async () => {
      const detector = await loadDetector('family_emergency_fund_adequacy')
      const rule = ruleById(detector, 'emergency_fund_overfunded')
      const fired = evaluate(rule.condition, {
        data: {
          emergency_savings_minor: 300_000,
          monthly_expenses_minor: 20_000,
          has_high_interest_debt: 0,
        },
      })
      expect(fired).toBe(false)
    })
  })

  describe('family_retirement_gap', () => {
    it('fires retirement_behind_target_age when projected age exceeds target and the needed increase is affordable', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_behind_target_age')
      const fired = evaluate(rule.condition, {
        data: {
          projected_retirement_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 100_000,
          additional_monthly_contribution_needed_minor: 50_000,
          monthly_salary_minor: 400_000,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire retirement_behind_target_age when on track', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_behind_target_age')
      const fired = evaluate(rule.condition, {
        data: {
          projected_retirement_age: 65,
          target_retirement_age: 65,
          pension_balance_minor: 100_000,
          additional_monthly_contribution_needed_minor: 0,
          monthly_salary_minor: 400_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('does not fire retirement_behind_target_age when pension balance is zero', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_behind_target_age')
      const fired = evaluate(rule.condition, {
        data: {
          projected_retirement_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 0,
          additional_monthly_contribution_needed_minor: 50_000,
          monthly_salary_minor: 400_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('does not fire retirement_behind_target_age when the needed increase exceeds half of monthly income (defers to the unaffordable rule instead)', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_behind_target_age')
      const fired = evaluate(rule.condition, {
        data: {
          projected_retirement_age: 90,
          target_retirement_age: 67,
          pension_balance_minor: 100_000,
          additional_monthly_contribution_needed_minor: 8_000_000,
          monthly_salary_minor: 400_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('fires retirement_gap_unaffordable_by_contributions for a near-retiree with a large gap (real scenario verified this session)', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_gap_unaffordable_by_contributions')
      const fired = evaluate(rule.condition, {
        data: {
          current_age: 63,
          projected_retirement_age: 90,
          target_retirement_age: 67,
          pension_balance_minor: 100_000,
          additional_monthly_contribution_needed_minor: 8_000_000,
          monthly_salary_minor: 400_000,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire retirement_gap_unaffordable_by_contributions when the increase is affordable', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_gap_unaffordable_by_contributions')
      const fired = evaluate(rule.condition, {
        data: {
          current_age: 60,
          projected_retirement_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 100_000,
          additional_monthly_contribution_needed_minor: 50_000,
          monthly_salary_minor: 400_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('PRD-106: fires retirement_gap_unaffordable_by_contributions for a past-target-age household whose balance falls short of the target income', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_gap_unaffordable_by_contributions')
      const fired = evaluate(rule.condition, {
        data: {
          current_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 500_000,
          // Sentinel projectRetirement() now sets for this population —
          // must NOT be what gates this branch (see condition comment).
          additional_monthly_contribution_needed_minor: Number.MAX_SAFE_INTEGER,
          achievable_retirement_income_minor: 20_000,
          target_retirement_income_minor: 200_000,
        },
      })
      expect(fired).toBe(true)
    })

    it('PRD-106: does not fire for a past-target-age household whose balance genuinely covers the target income', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_gap_unaffordable_by_contributions')
      const fired = evaluate(rule.condition, {
        data: {
          current_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 6_000_000,
          additional_monthly_contribution_needed_minor: Number.MAX_SAFE_INTEGER,
          achievable_retirement_income_minor: 250_000,
          target_retirement_income_minor: 200_000,
        },
      })
      expect(fired).toBe(false)
    })

    it('computes retirement_gap_unaffordable_by_contributions impact from the achievable-vs-target income gap', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'retirement_gap_unaffordable_by_contributions')
      const data = {
        target_retirement_income_minor: 3_000_000,
        achievable_retirement_income_minor: 1_200_000,
      }
      const low = evaluateNumeric(rule.impact_low as string, { data })
      const high = evaluateNumeric(rule.impact_high as string, { data })
      expect(low).toBe(18_000_000)
      expect(high).toBe(45_000_000)
    })

    it('fires no_retirement_savings when balance is zero and age >= 25', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'no_retirement_savings')
      const fired = evaluate(rule.condition, {
        data: {
          pension_balance_minor: 0,
          current_age: 30,
        },
      })
      expect(fired).toBe(true)
    })

    it('does not fire no_retirement_savings when balance exists', async () => {
      const detector = await loadDetector('family_retirement_gap')
      const rule = ruleById(detector, 'no_retirement_savings')
      const fired = evaluate(rule.condition, {
        data: {
          pension_balance_minor: 50_000,
          current_age: 30,
        },
      })
      expect(fired).toBe(false)
    })
  })
})
