import { describe, it, expect, beforeEach } from 'vitest'
import { SignalSchemaRegistry, setSchemaRegistry, getSchemaRegistry } from '../lib/schema-registry.js'
import { registerFamilySignalSchemas } from '../lib/family-signal-schemas.js'

describe('family signal schemas', () => {
  beforeEach(() => {
    setSchemaRegistry(new SignalSchemaRegistry())
    registerFamilySignalSchemas()
  })

  const registry = () => getSchemaRegistry()

  it('registers every family signal type', () => {
    const reg = registry()
    for (const type of [
      'family.household',
      'family.savings',
      'family.pension',
      'family.education_fund',
      'family.debt',
      'family.policy_review',
      'family.estate',
      'family.life_event',
    ]) {
      expect(reg.get(type, '0.0.0')).toBeDefined()
    }
  })

  it('validates a family.household signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        employed: 1,
        monthly_salary_minor: 630000,
        member_id: 'member-1',
      },
      'family.household',
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects a family.household signal missing required fields', () => {
    const reg = registry()
    const result = reg.validate(
      { member_id: 'member-1' },
      'family.household',
    )
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('validates a family.debt signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        monthly_debt_payments_minor: 150000,
        monthly_income_minor: 400000,
        debt_to_income_ratio: 0.375,
      },
      'family.debt',
    )
    expect(result.valid).toBe(true)
  })

  it('validates a family.policy_review signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        member_id: 'member-1',
        orphaned_policy_count: 1,
        orphaned_policy_descriptions: ['life policy with Aviva'],
      },
      'family.policy_review',
    )
    expect(result.valid).toBe(true)
  })

  it('validates a family.savings signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        emergency_savings_minor: 500000,
        monthly_expenses_minor: 350000,
        has_high_interest_debt: 0,
      },
      'family.savings',
    )
    expect(result.valid).toBe(true)
  })

  it('validates a family.estate signal', () => {
    const reg = registry()
    const result = reg.validate(
      { has_will: 1, has_power_of_attorney: 1, estate_doc_count: 2 },
      'family.estate',
    )
    expect(result.valid).toBe(true)
  })

  it('validates a family.life_event signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        event_type: 'job_loss',
        reported_at: '2026-10-03T10:00:00Z',
        affected_member_id: 'member-1',
        completed_step_ids: ['step-1'],
      },
      'family.life_event',
    )
    expect(result.valid).toBe(true)
  })

  it('validates a family.education_fund signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        child_name: 'Sam',
        child_age: 11,
        current_savings_minor: 100000,
        target_savings_minor: 1500000,
        years_remaining: 7,
      },
      'family.education_fund',
    )
    expect(result.valid).toBe(true)
  })

  it('validates a family.pension signal', () => {
    const reg = registry()
    const result = reg.validate(
      {
        current_age: 40,
        target_retirement_age: 65,
        pension_balance_minor: 5000000,
        target_retirement_income_minor: 3000000,
        projected_retirement_age: 68,
        monthly_salary_minor: 630000,
      },
      'family.pension',
    )
    expect(result.valid).toBe(true)
  })
})
