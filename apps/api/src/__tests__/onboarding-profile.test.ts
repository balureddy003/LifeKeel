import { describe, expect, it } from 'vitest'
import { isValidOnboardingProfile } from '../routes/onboarding.js'

describe('isValidOnboardingProfile', () => {
  it('accepts a non-trading persona without a risk tier', () => {
    expect(isValidOnboardingProfile('business-owner', undefined)).toBe(true)
    expect(isValidOnboardingProfile('real-estate', undefined)).toBe(true)
    expect(isValidOnboardingProfile('creator', undefined)).toBe(true)
  })

  it('requires a valid risk tier for investor onboarding', () => {
    expect(isValidOnboardingProfile('investor', undefined)).toBe(false)
    expect(isValidOnboardingProfile('investor', 'balanced')).toBe(true)
  })

  it('rejects invalid personas and risk tiers', () => {
    expect(isValidOnboardingProfile('unknown', undefined)).toBe(false)
    expect(isValidOnboardingProfile('business-owner', 'unknown')).toBe(false)
  })
})
