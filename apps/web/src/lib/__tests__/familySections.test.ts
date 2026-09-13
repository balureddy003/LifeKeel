import { describe, expect, it } from 'vitest'
import { getMemberSections } from '../familySections'
import type { FamilyMember } from '../types'
import type { FinancialProfilePolicy } from '../api'

function makeMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    id: 'm1',
    name: 'Alex',
    role: 'organizer',
    emoji: '🧑',
    relation: 'owner',
    ...overrides,
  }
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function makePolicy(overrides: Partial<FinancialProfilePolicy> = {}): FinancialProfilePolicy {
  return {
    type: 'life',
    provider: 'Aviva',
    coverage_amount_minor: 10_000_00,
    monthly_premium_minor: 2_000,
    ...overrides,
  }
}

describe('OAK-013: getMemberSections surfaces the soonest policy renewal', () => {
  it('appends a renewal badge when a policy renews within 60 days', () => {
    const sections = getMemberSections(makeMember(), [makePolicy({ renewal_date: daysFromNow(10) })])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toContain('renews in 10 days')
  })

  it('does not append a renewal badge when no policy renews within 60 days', () => {
    const sections = getMemberSections(makeMember(), [makePolicy({ renewal_date: daysFromNow(120) })])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).not.toContain('renews in')
  })

  it('picks the soonest renewal across multiple policies', () => {
    const sections = getMemberSections(makeMember(), [
      makePolicy({ renewal_date: daysFromNow(45) }),
      makePolicy({ renewal_date: daysFromNow(5) }),
    ])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toContain('renews in 5 days')
  })

  it('ignores policies with no renewal_date or an already-past one', () => {
    const sections = getMemberSections(makeMember(), [
      makePolicy(),
      makePolicy({ renewal_date: daysFromNow(-5) }),
    ])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).not.toContain('renews in')
  })

  it('falls back to the static label when there are no policies at all', () => {
    const sections = getMemberSections(makeMember(), [])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toBe('Includes Life Insurance, Health Insurance')
  })
})
