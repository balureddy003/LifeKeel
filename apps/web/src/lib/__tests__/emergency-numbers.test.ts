import { describe, it, expect } from 'vitest'
import { emergencyNumberFor } from '../emergency-numbers'

describe('emergencyNumberFor', () => {
  it('returns the UK number for GB — the exact case found live (a UK account was shown "call 911")', () => {
    expect(emergencyNumberFor('GB')).toEqual({ number: '999', label: '999 in the UK' })
  })

  it('returns India\'s unified number for IN — the session\'s original real-world scenario (UK to India travel)', () => {
    expect(emergencyNumberFor('IN')).toEqual({ number: '112', label: '112 in India' })
  })

  it('is case-insensitive', () => {
    expect(emergencyNumberFor('gb')).toEqual({ number: '999', label: '999 in the UK' })
  })

  it('falls back to a neutral, non-asserting number when the country is unknown or unset', () => {
    expect(emergencyNumberFor(undefined).number).toBe('112')
    expect(emergencyNumberFor('ZZ').number).toBe('112')
  })
})
