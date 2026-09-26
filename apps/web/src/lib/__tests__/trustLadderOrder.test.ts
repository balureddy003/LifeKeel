import { describe, expect, it } from 'vitest'
import { orderIncompleteTrustLadderSteps, type TrustLadderStepLike } from '../trustLadderOrder'

const FIXED_ORDER_STEPS: TrustLadderStepLike[] = [
  { id: 'family', status: 'available' },
  { id: 'documents', status: 'available' },
  { id: 'bank', status: 'available' },
  { id: 'email', status: 'available' },
  { id: 'investments', status: 'available' },
  { id: 'estate', status: 'available' },
]

describe('orderIncompleteTrustLadderSteps', () => {
  it('keeps the original fixed order when nothing calls for personalization', () => {
    const result = orderIncompleteTrustLadderSteps(FIXED_ORDER_STEPS, { hasPendingMembers: false, openDetectorIds: new Set() })
    expect(result.map((s) => s.id)).toEqual(['family', 'documents', 'bank', 'email', 'investments', 'estate'])
  })

  it('drops steps already marked done', () => {
    const steps: TrustLadderStepLike[] = [{ id: 'family', status: 'done' }, { id: 'documents', status: 'available' }]
    const result = orderIncompleteTrustLadderSteps(steps, { hasPendingMembers: false, openDetectorIds: new Set() })
    expect(result.map((s) => s.id)).toEqual(['documents'])
  })

  it('promotes "family" to the front when a member is still Pending', () => {
    const result = orderIncompleteTrustLadderSteps(FIXED_ORDER_STEPS, { hasPendingMembers: true, openDetectorIds: new Set() })
    expect(result[0]!.id).toBe('family')
  })

  it('promotes "investments" ahead of bank/email when a retirement gap is open', () => {
    const result = orderIncompleteTrustLadderSteps(FIXED_ORDER_STEPS, {
      hasPendingMembers: false,
      openDetectorIds: new Set(['family_retirement_gap']),
    })
    expect(result[0]!.id).toBe('investments')
    // Everything else keeps its relative order behind it.
    expect(result.slice(1).map((s) => s.id)).toEqual(['family', 'documents', 'bank', 'email', 'estate'])
  })

  it('does not promote "investments" for an unrelated open detector', () => {
    const result = orderIncompleteTrustLadderSteps(FIXED_ORDER_STEPS, {
      hasPendingMembers: false,
      openDetectorIds: new Set(['family_protection_gap']),
    })
    expect(result.map((s) => s.id)).toEqual(['family', 'documents', 'bank', 'email', 'investments', 'estate'])
  })

  it('puts a Pending family member ahead of an open retirement gap when both are true', () => {
    const result = orderIncompleteTrustLadderSteps(FIXED_ORDER_STEPS, {
      hasPendingMembers: true,
      openDetectorIds: new Set(['family_retirement_gap']),
    })
    expect(result[0]!.id).toBe('family')
    expect(result[1]!.id).toBe('investments')
  })
})
