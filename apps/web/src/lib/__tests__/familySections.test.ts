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

describe('KEEL-013: getMemberSections surfaces the soonest policy renewal', () => {
  it('appends a renewal badge when a policy renews within 60 days', () => {
    const sections = getMemberSections(makeMember(), [
      makePolicy({ renewal_date: daysFromNow(10) }),
    ])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toContain('renews in 10 days')
  })

  it('does not append a renewal badge when no policy renews within 60 days', () => {
    const sections = getMemberSections(makeMember(), [
      makePolicy({ renewal_date: daysFromNow(120) }),
    ])
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

  it('says no policies are on file, rather than claiming cover, when there are none', () => {
    const sections = getMemberSections(makeMember(), [])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toBe('No policies on file yet')
  })

  it('distinguishes "cover amounts entered" from "no policy details" when the wizard totals exist', () => {
    const sections = getMemberSections(makeMember(), [], {
      lifeCoverMinor: 300_000_00,
      incomeProtectionMonthlyMinor: 2_000_00,
    })
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toBe(
      '£300,000 life cover + £2,000/mo income protection on file — no policy details recorded yet',
    )
  })

  it('still reports the full empty state when neither totals nor policies exist', () => {
    const sections = getMemberSections(makeMember(), [], {
      lifeCoverMinor: 0,
      incomeProtectionMonthlyMinor: 0,
    })
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toBe('No policies on file yet')
  })
})

describe('Digital Twin gap audit (Phase 3): getMemberSections scopes person-specific policies per member', () => {
  it('excludes a person-scoped policy explicitly attributed to someone else', () => {
    const sections = getMemberSections(makeMember({ id: 'm1' }), [
      makePolicy({ type: 'life', member_id: 'someone-else' }),
    ])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toBe('No policies on file yet')
  })

  it('includes a person-scoped policy explicitly attributed to this member', () => {
    const sections = getMemberSections(makeMember({ id: 'm1' }), [
      makePolicy({ type: 'life', member_id: 'm1' }),
    ])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toContain('1 policy: Life')
  })

  it('includes a person-scoped policy with no member_id at all (unattributed — genuinely unknown whose)', () => {
    const sections = getMemberSections(makeMember({ id: 'm1' }), [makePolicy({ type: 'life' })])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toContain('1 policy: Life')
  })

  it('never filters a household-wide policy type by member_id', () => {
    const sections = getMemberSections(makeMember({ id: 'm1' }), [
      makePolicy({ type: 'car', member_id: 'someone-else' }),
    ])
    const protection = sections.find((s) => s.label === 'Protection')
    expect(protection?.story).toContain('1 policy: Car')
  })

  it('shows each member only their own person-scoped policy out of a mixed household list', () => {
    const shared = [
      makePolicy({ type: 'life', member_id: 'alex' }),
      makePolicy({ type: 'health', member_id: 'sam' }),
      makePolicy({ type: 'car' }),
    ]
    const alexProtection = getMemberSections(makeMember({ id: 'alex' }), shared).find(
      (s) => s.label === 'Protection',
    )
    const samProtection = getMemberSections(makeMember({ id: 'sam' }), shared).find(
      (s) => s.label === 'Protection',
    )
    expect(alexProtection?.story).toContain('Life')
    expect(alexProtection?.story).toContain('Car')
    expect(alexProtection?.story).not.toContain('Health')
    expect(samProtection?.story).toContain('Health')
    expect(samProtection?.story).toContain('Car')
    expect(samProtection?.story).not.toContain('Life')
  })
})
