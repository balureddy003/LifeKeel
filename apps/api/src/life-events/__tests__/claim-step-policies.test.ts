import { describe, it, expect } from 'vitest'
import { renderPlaybook, type LifeEventType } from '../render-playbook.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

type Policy = FinancialProfile['policies'][number]
const policy = (o: Partial<Policy> & Pick<Policy, 'type' | 'provider'>): Policy =>
  ({ coverage_amount_minor: 0, monthly_premium_minor: 0, ...o }) as Policy

function profile(policies: Policy[]): FinancialProfile {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 3600000,
      mortgage_outstanding_minor: 20_000_000,
      life_cover_minor: 10_000_000,
      income_protection_monthly_minor: 400000,
      monthly_debt_payments_minor: 0,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 900000,
      monthly_expenses_minor: 300000,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 30,
      target_retirement_age: 65,
      pension_balance_minor: 5_000_000,
      monthly_contribution_minor: 50000,
      target_retirement_income_minor: 3_000_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies,
  } as FinancialProfile
}

const STEP: Record<string, string> = {
  travel: 'check_travel_cover',
  medical: 'check_health_cover',
  disability: 'check_cover',
  car: 'check_car_insurance',
  property: 'check_home_cover',
}
const body = (event: LifeEventType, policies: Policy[]) =>
  renderPlaybook(event, profile(policies)).steps.find((s) => s.id === STEP[event])!.body

// Words that would turn a list of what is on file into a judgement or an instruction.
const JUDGEMENT =
  /\b(covers?|covered|not covered|cover may|may cover|should|claim|call|contact|report|check|gap|enough|worth|add )\b/i

describe('the claim step lists the policies on file, and nothing else', () => {
  const held = [
    policy({
      type: 'travel',
      provider: 'Northwind Mutual',
      policy_number: 'TRV-0001',
      contact_phone: '+44 20 7946 0000',
      contact_email: 'assist@northwind.example',
    }),
    policy({ type: 'health', provider: 'Harbour Health', policy_number: 'HLT-77' }),
    policy({ type: 'critical_illness', provider: 'Ridge Life', policy_number: 'CI-5' }),
    policy({ type: 'income_protection', provider: 'Fenland Income', policy_number: 'IP-9' }),
    policy({
      type: 'car',
      provider: 'Kestrel Motor',
      policy_number: 'CAR-3',
      contact_phone: '0800 000 111',
    }),
    policy({ type: 'home', provider: 'Larch Home', policy_number: 'HOM-4' }),
    policy({ type: 'life', provider: 'Elm Life', policy_number: 'LIF-1' }),
  ]

  it('travel: lists travel and health policies with number and contact as printed', () => {
    const b = body('travel', held)
    for (const s of [
      'Northwind Mutual',
      'TRV-0001',
      '+44 20 7946 0000',
      'assist@northwind.example',
      'Harbour Health',
      'HLT-77',
    ])
      expect(b).toContain(s)
    for (const s of ['Kestrel Motor', 'Larch Home', 'Elm Life']) expect(b).not.toContain(s)
  })

  it('medical: lists health and critical-illness policies, not car or home', () => {
    const b = body('medical', held)
    expect(b).toContain('Harbour Health')
    expect(b).toContain('HLT-77')
    expect(b).toContain('Ridge Life')
    expect(b).not.toContain('Kestrel Motor')
    expect(b).not.toContain('Larch Home')
  })

  it('disability: lists income-protection and critical-illness policies', () => {
    const b = body('disability', held)
    expect(b).toContain('Fenland Income')
    expect(b).toContain('Ridge Life')
    expect(b).not.toContain('Harbour Health')
  })

  it('car: lists car policies with their contact', () => {
    const b = body('car', held)
    expect(b).toContain('Kestrel Motor')
    expect(b).toContain('CAR-3')
    expect(b).toContain('0800 000 111')
    expect(b).not.toContain('Larch Home')
  })

  it('property: lists home policies', () => {
    const b = body('property', held)
    expect(b).toContain('Larch Home')
    expect(b).toContain('HOM-4')
    expect(b).not.toContain('Kestrel Motor')
  })

  it('an empty list is a fact with no recommendation, for every event', () => {
    for (const event of Object.keys(STEP) as LifeEventType[]) {
      const b = body(event, [policy({ type: 'life', provider: 'Elm Life' })])
      expect(b).toMatch(/^No .* on file\.$/)
      expect(b).not.toContain('Elm Life')
    }
  })

  it('never says whether a policy covers the event, and never says what to do', () => {
    for (const event of Object.keys(STEP) as LifeEventType[]) {
      const b = body(event, held)
      // Strip the data the household typed so only our own words are tested.
      const ours = b
        .replace(
          /Northwind Mutual|Harbour Health|Ridge Life|Fenland Income|Kestrel Motor|Larch Home/g,
          '',
        )
        .replace(/[A-Z]{2,3}-\d+|\+?[\d ]{8,}|\S+@\S+/g, '')
      expect(ours).not.toMatch(JUDGEMENT)
    }
  })

  it('shows only what is on file: a policy with no number or contact prints no placeholder', () => {
    const b = body('car', [policy({ type: 'car', provider: 'Kestrel Motor' })])
    expect(b).toBe('On file: Kestrel Motor.')
  })
})
