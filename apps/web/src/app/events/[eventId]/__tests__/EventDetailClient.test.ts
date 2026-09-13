import { describe, expect, it } from 'vitest'
import { EVENT_ACTIONS, personalizeAction } from '../EventDetailClient'
import type { FinancialProfilePolicy } from '@/lib/api'

function makePolicy(overrides: Partial<FinancialProfilePolicy> = {}): FinancialProfilePolicy {
  return {
    type: 'life',
    provider: 'Aviva',
    coverage_amount_minor: 10_000_00,
    monthly_premium_minor: 2_000,
    ...overrides,
  }
}

describe('OAK-014: personalizeAction swaps in a real provider name when one exists', () => {
  it('personalizes the bereavement life-insurance action when a matching policy exists', () => {
    const action = EVENT_ACTIONS.bereavement!.find((a) => a.id === '1')!
    const result = personalizeAction(action, [makePolicy({ type: 'life', provider: 'Aviva' })])
    expect(result).toBe('Call Aviva about your life insurance claim')
  })

  it('falls back to the generic label when no matching policy exists', () => {
    const action = EVENT_ACTIONS.bereavement!.find((a) => a.id === '1')!
    const result = personalizeAction(action, [makePolicy({ type: 'health', provider: 'Bupa' })])
    expect(result).toBe('Call your life insurance provider to start a claim')
  })

  it('falls back to the generic label when there are no policies at all', () => {
    const action = EVENT_ACTIONS.bereavement!.find((a) => a.id === '1')!
    expect(personalizeAction(action, [])).toBe('Call your life insurance provider to start a claim')
  })

  it('personalizes the medical action for either a health or critical_illness policy', () => {
    const action = EVENT_ACTIONS.medical!.find((a) => a.id === '1')!
    expect(personalizeAction(action, [makePolicy({ type: 'critical_illness', provider: 'Bupa' })])).toBe('Review your Bupa coverage details')
  })

  it('leaves actions with no policyTypes configured unchanged regardless of policies', () => {
    const action = EVENT_ACTIONS.bereavement!.find((a) => a.id === '2')!
    expect(personalizeAction(action, [makePolicy()])).toBe(action.label)
  })
})
