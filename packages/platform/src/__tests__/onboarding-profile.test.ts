import { describe, expect, it } from 'vitest'
import {
  PERSONA_VERTICALS,
  RISK_TIER_PRESETS,
  STRATEGY_DEFAULTS,
  isPersona,
  isRiskTier,
} from '../onboarding-profile.js'

describe('onboarding-profile', () => {
  it('maps personas to verticals', () => {
    expect(PERSONA_VERTICALS['investor']).toBe('trading-investment')
    expect(PERSONA_VERTICALS['business-owner']).toBe('smb-operations')
    expect(PERSONA_VERTICALS['real-estate']).toBe('property-wealth')
    expect(PERSONA_VERTICALS.creator).toBe('audience-growth')
    expect(PERSONA_VERTICALS['healthcare']).toBe('healthcare')
    expect(PERSONA_VERTICALS['family-organizer']).toBe('family')
    expect(PERSONA_VERTICALS['growth-marketer']).toBe('branding-marketing')
  })

  it('validates personas and risk tiers', () => {
    expect(isPersona('investor')).toBe(true)
    expect(isPersona('family-organizer')).toBe(true)
    expect(isPersona('growth-marketer')).toBe(true)
    expect(isPersona('unknown')).toBe(false)
    expect(isRiskTier('conservative')).toBe(true)
    expect(isRiskTier('balanced')).toBe(true)
    expect(isRiskTier('aggressive')).toBe(true)
    expect(isRiskTier('unknown')).toBe(false)
  })

  it('provides distinct risk tier presets', () => {
    const conservative = RISK_TIER_PRESETS.conservative
    const balanced = RISK_TIER_PRESETS.balanced
    const aggressive = RISK_TIER_PRESETS.aggressive

    expect(conservative.strategy.maxPositionWeight).toBeLessThan(balanced.strategy.maxPositionWeight)
    expect(balanced.strategy.maxPositionWeight).toBeLessThan(aggressive.strategy.maxPositionWeight)

    expect(conservative.strategy.stopLossThreshold).toBeLessThan(balanced.strategy.stopLossThreshold)
    expect(balanced.strategy.stopLossThreshold).toBeLessThan(aggressive.strategy.stopLossThreshold)

    expect(conservative.goalKpis.price_drop_alert_threshold_pct).toBeLessThan(
      aggressive.goalKpis.price_drop_alert_threshold_pct,
    )
  })

  it('includes strategy defaults independent of risk tier', () => {
    expect(STRATEGY_DEFAULTS.enabled).toBe(true)
    expect(STRATEGY_DEFAULTS.minLookback).toBe(63)
  })
})
