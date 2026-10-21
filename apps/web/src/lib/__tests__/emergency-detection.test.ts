/**
 * Web-side twin of packages/platform's emergency.ts test — the client
 * screens before the query leaves the device, the server re-screens
 * independently. Keep the assertions identical on both sides.
 */

import { describe, expect, it } from 'vitest'
import { detectEmergency } from '../emergency-detection'

describe('detectEmergency (web twin)', () => {
  it('flags in-progress medical emergencies', () => {
    expect(detectEmergency('my husband is having chest pain')).toBe('medical')
    expect(detectEmergency("I can't breathe")).toBe('medical')
    expect(detectEmergency('she collapsed and is unresponsive')).toBe('medical')
    expect(detectEmergency('my son swallowed a battery')).toBe('medical')
    expect(detectEmergency('call an ambulance')).toBe('medical')
    expect(detectEmergency('he is bleeding heavily and it won’t stop')).toBe('medical')
  })

  it('flags self-harm / suicide signals separately', () => {
    expect(detectEmergency('I want to die')).toBe('self_harm')
    expect(detectEmergency('I have been thinking about suicide')).toBe('self_harm')
    expect(detectEmergency("I don't want to be here anymore")).toBe('self_harm')
  })

  it('does not flag normal finance questions about emergencies', () => {
    expect(detectEmergency('Am I covered for a medical emergency?')).toBeNull()
    expect(detectEmergency('How big should my emergency fund be?')).toBeNull()
    expect(detectEmergency('What happens to our mortgage if one of us dies?')).toBeNull()
    expect(detectEmergency('Do we need travel insurance for our trip?')).toBeNull()
  })

  it('matches case-insensitively and tolerates hyphens', () => {
    expect(detectEmergency('CHEST PAIN')).toBe('medical')
    expect(detectEmergency('chest-pain right now')).toBe('medical')
  })
})
