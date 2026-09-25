import { describe, it, expect } from 'vitest'
import { detectUnreportedLifeChange, type ProfileChangeSnapshot } from '../detect-unreported-change.js'

function snapshot(overrides: Partial<ProfileChangeSnapshot> = {}): ProfileChangeSnapshot {
  return {
    earners: [{ employment_status: 'employed', monthly_salary_minor: 400000 }],
    emergency_savings_minor: 900000,
    ...overrides,
  }
}

describe('PRD-111: detectUnreportedLifeChange', () => {
  it('returns null on a first-ever save (no previous snapshot)', () => {
    expect(detectUnreportedLifeChange(null, snapshot())).toBeNull()
  })

  it('returns null when nothing meaningful changed', () => {
    expect(detectUnreportedLifeChange(snapshot(), snapshot())).toBeNull()
  })

  it('detects the household earner moving from employed to unemployed', () => {
    const previous = snapshot()
    const next = snapshot({ earners: [{ employment_status: 'unemployed', monthly_salary_minor: 400000 }] })
    expect(detectUnreportedLifeChange(previous, next)).toBe('employment_status_change')
  })

  it('detects self_employed moving to retired too, not just "unemployed"', () => {
    const previous = snapshot({ earners: [{ employment_status: 'self_employed', monthly_salary_minor: 350000 }] })
    const next = snapshot({ earners: [{ employment_status: 'retired', monthly_salary_minor: 350000 }] })
    expect(detectUnreportedLifeChange(previous, next)).toBe('employment_status_change')
  })

  it('does not fire when employment status moves between two still-earning states', () => {
    const previous = snapshot({ earners: [{ employment_status: 'employed', monthly_salary_minor: 400000 }] })
    const next = snapshot({ earners: [{ employment_status: 'self_employed', monthly_salary_minor: 400000 }] })
    expect(detectUnreportedLifeChange(previous, next)).toBeNull()
  })

  it('detects a salary dropping to zero', () => {
    const previous = snapshot()
    const next = snapshot({ earners: [{ employment_status: 'employed', monthly_salary_minor: 0 }] })
    expect(detectUnreportedLifeChange(previous, next)).toBe('salary_to_zero')
  })

  it('matches per-earner members[] entries by member_id, not position', () => {
    const previous: ProfileChangeSnapshot = {
      earners: [
        { employment_status: 'employed', monthly_salary_minor: 400000 },
        { member_id: 'm1', employment_status: 'employed', monthly_salary_minor: 300000 },
      ],
      emergency_savings_minor: 900000,
    }
    const next: ProfileChangeSnapshot = {
      earners: [
        { employment_status: 'employed', monthly_salary_minor: 400000 },
        { member_id: 'm1', employment_status: 'unemployed', monthly_salary_minor: 300000 },
      ],
      emergency_savings_minor: 900000,
    }
    expect(detectUnreportedLifeChange(previous, next)).toBe('employment_status_change')
  })

  it('skips a member newly added this save (no previous entry to compare against)', () => {
    const previous: ProfileChangeSnapshot = {
      earners: [{ employment_status: 'employed', monthly_salary_minor: 400000 }],
      emergency_savings_minor: 900000,
    }
    const next: ProfileChangeSnapshot = {
      earners: [
        { employment_status: 'employed', monthly_salary_minor: 400000 },
        { member_id: 'new-member', employment_status: 'unemployed', monthly_salary_minor: 0 },
      ],
      emergency_savings_minor: 900000,
    }
    expect(detectUnreportedLifeChange(previous, next)).toBeNull()
  })

  it('detects emergency savings dropping by more than 40% in one save', () => {
    const previous = snapshot({ emergency_savings_minor: 1_000_000 })
    const next = snapshot({ emergency_savings_minor: 500_000 })
    expect(detectUnreportedLifeChange(previous, next)).toBe('emergency_fund_drained')
  })

  it('does not fire just under the 40% emergency-fund threshold', () => {
    const previous = snapshot({ emergency_savings_minor: 1_000_000 })
    const next = snapshot({ emergency_savings_minor: 650_000 }) // 35% drop
    expect(detectUnreportedLifeChange(previous, next)).toBeNull()
  })

  it('does not fire on emergency fund draining from an already-zero balance', () => {
    const previous = snapshot({ emergency_savings_minor: 0 })
    const next = snapshot({ emergency_savings_minor: 0 })
    expect(detectUnreportedLifeChange(previous, next)).toBeNull()
  })

  it('checks employment/salary before emergency fund — first match wins', () => {
    const previous = snapshot({ emergency_savings_minor: 1_000_000 })
    const next = snapshot({
      earners: [{ employment_status: 'unemployed', monthly_salary_minor: 400000 }],
      emergency_savings_minor: 500_000,
    })
    expect(detectUnreportedLifeChange(previous, next)).toBe('employment_status_change')
  })
})
