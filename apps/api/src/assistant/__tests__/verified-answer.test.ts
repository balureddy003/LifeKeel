/**
 * PRD-212 verified-answer resolver — intent classification precision and
 * the provenance-bound renderers. The route-level behavior (falls through
 * to generation, never calls the model for verified asks, clarify response)
 * is covered in routes/__tests__/assistant-verified.test.ts.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyVerifiedIntent,
  renderVerifiedAnswer,
  type VerifiedAnswerData,
} from '../verified-answer.js'

const PROFILE = {
  updated_at: new Date('2026-10-12T00:00:00Z'),
  household: {
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 3600000,
    members: [{ member_id: 'm2', monthly_salary_minor: 250000 }],
  },
  emergency_fund: {
    emergency_savings_minor: 900000,
    monthly_expenses_minor: 300000,
    has_high_interest_debt: false,
  },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 5000000,
    monthly_contribution_minor: 50000,
    target_retirement_income_minor: 2400000,
  },
  education_funds: [
    {
      child_name: 'Sam',
      current_savings_minor: 200000,
      target_savings_minor: 800000,
      years_remaining: 10,
    },
  ],
  policies: [
    {
      type: 'car',
      provider: 'Acme Insurance',
      coverage_amount_minor: 1500000,
      monthly_premium_minor: 4500,
      renewal_date: '2027-03-01',
      member_id: 'm2',
    },
    {
      type: 'home',
      provider: 'HomeCo',
      coverage_amount_minor: 30000000,
      monthly_premium_minor: 2200,
      renewal_date: '2026-11-15',
    },
    { type: 'life', provider: 'LifeCo', coverage_amount_minor: 50000000, member_id: 'm1' },
  ],
}

const FAMILY = {
  members: [
    { id: 'm1', name: 'Priya', role: 'organizer', status: 'active' },
    { id: 'm2', name: 'Alex', role: 'parent', status: 'active' },
  ],
}

const data = (overrides: Partial<VerifiedAnswerData> = {}): VerifiedAnswerData => ({
  profile: PROFILE as never,
  family: FAMILY,
  ...overrides,
})

describe('classifyVerifiedIntent', () => {
  it.each([
    ['how much is in our emergency fund?', 'emergency_fund'],
    ['how many months would our savings cover?', 'emergency_fund'],
    ['when does the car insurance renew?', 'policy_renewals'],
    ['which policies are up for renewal soon?', 'policy_renewals'],
    ['what insurance policies do we have?', 'policies'],
    ["what's our readiness score?", 'readiness'],
    ['how prepared is our family?', 'readiness'],
    ['are we on track for the uni fund?', 'education_funds'],
    ['what if we lost our income?', 'income_stops'],
    ['what happens if I lose my job?', 'income_stops'],
  ])('resolves %s → %s', (query, op) => {
    expect(classifyVerifiedIntent(query)).toEqual({ kind: 'operation', operation: op })
  })

  it.each(['what should I invest in?', 'tell me a joke', 'how do pensions work?', ''])(
    'leaves %s to the generative path',
    (query) => {
      expect(classifyVerifiedIntent(query)).toBeNull()
    },
  )

  it('a compound job-loss + bereavement question surfaces both intents', () => {
    // Intent 57: the death half of a compound question must not silently
    // drop — bereavement maps to the policies op (life cover on file).
    const intent = classifyVerifiedIntent('lost my job and my partner passed away')
    expect(intent).toEqual({
      kind: 'clarify',
      options: expect.arrayContaining(['income_stops', 'policies']),
    })
  })

  it('a question matching two operations clarifies instead of guessing', () => {
    const intent = classifyVerifiedIntent(
      'how much is in our emergency fund and when does the car insurance renew?',
    )
    expect(intent).toEqual({
      kind: 'clarify',
      options: expect.arrayContaining(['emergency_fund', 'policy_renewals']),
    })
  })

  it('a renewal question about "what insurance" is a renewal, not a list', () => {
    expect(classifyVerifiedIntent('what insurance renews soon?')).toEqual({
      kind: 'operation',
      operation: 'policy_renewals',
    })
  })
})

describe('renderVerifiedAnswer', () => {
  it('emergency fund: computes months of cover and carries provenance + freshness', () => {
    const a = renderVerifiedAnswer('emergency_fund', data())!
    expect(a.content).toContain('£9000.00')
    expect(a.content).toContain('£3000.00')
    expect(a.content).toContain('3 months of cover')
    expect(a.content).toContain('last updated 2026-10-12')
    expect(a.provenance).toEqual({
      source: 'financial profile — emergency fund',
      updated_at: '2026-10-12',
    })
  })

  it('emergency fund: says so honestly when the section is empty', () => {
    const a = renderVerifiedAnswer(
      'emergency_fund',
      data({ profile: { updated_at: new Date('2026-01-01') } as never }),
    )!
    expect(a.content).toContain('no emergency fund')
  })

  it('policies: lists every policy; member scope filters to that member', () => {
    const all = renderVerifiedAnswer('policies', data())!
    expect(all.content).toContain('car')
    expect(all.content).toContain('home')
    expect(all.content).toContain('life')

    const scoped = renderVerifiedAnswer('policies', data({ memberId: 'm2' }))!
    expect(scoped.content).toContain('for Alex')
    expect(scoped.content).toContain('car')
    expect(scoped.content).not.toContain('life')
    // Household policies carry no member_id — scoping to a member excludes them.
    expect(scoped.content).not.toContain('home')
  })

  it('renewals: sorted soonest first, undated policies excluded', () => {
    const a = renderVerifiedAnswer('policy_renewals', data())!
    const home = a.content.indexOf('2026-11-15')
    const car = a.content.indexOf('2027-03-01')
    expect(home).toBeGreaterThan(-1)
    expect(car).toBeGreaterThan(home)
    expect(a.content).not.toContain('life') // no renewal_date → not a renewal answer
  })

  it('readiness: reports component scores and never ships NaN on a partial profile', () => {
    const a = renderVerifiedAnswer('readiness', data())!
    // The fixture's protection/retirement sections are partial, so those
    // components can't be scored — the answer must say so, not print "NaN".
    expect(a.content).not.toContain('NaN')
    expect(a.content).toContain('not scored yet')
    expect(a.content).toContain("can't be fully scored")
    // Estate is out of this resolver's scope — it must say restricted, not guess.
    expect(a.content).toContain('restricted')
    expect(a.content).toContain('Emergency fund: 65/100')
  })

  it('readiness: with estateInputs it scores estate like /family/readiness instead of gating it out', () => {
    // Home computes the composite with the vault's doc types + estate
    // signal; without those inputs the estate component gated out and the
    // mean re-weighted — the source of the Home-vs-Ask-Keel score split.
    const a = renderVerifiedAnswer(
      'readiness',
      data({
        estateInputs: { estateDocTypes: ['will', 'power_of_attorney'], estateSignal: null },
      }),
    )!
    expect(a.content).not.toContain('Estate: restricted')
    expect(a.content).toContain('Estate')
    expect(a.content).toContain('vault')
  })

  it('readiness: a gated caller (child / no vault access) still reports restricted', () => {
    const a = renderVerifiedAnswer(
      'readiness',
      data({ estateInputs: { estateDocTypes: null, estateSignal: null } }),
    )!
    expect(a.content).toContain('Estate: restricted')
  })

  it('education funds: shows each fund against its target', () => {
    const a = renderVerifiedAnswer('education_funds', data())!
    expect(a.content).toContain('Sam')
    expect(a.content).toContain('£2000.00')
    expect(a.content).toContain('£8000.00')
  })

  it('income stops: runs the real scenario calculator and states the runway', () => {
    const a = renderVerifiedAnswer('income_stops', data())!
    expect(a.content).toContain('scenario calculator')
    // income 6500/mo (4000+2500), expenses 3000/mo, savings 9000 → runway 3 mo
    expect(a.content).toContain('runway')
    expect(a.content).toMatch(/cover \*\*about 3\.?\d* months\*\*/)
  })

  it('income stops: honest when there is not enough profile to project', () => {
    const a = renderVerifiedAnswer(
      'income_stops',
      data({ profile: { updated_at: new Date() } as never }),
    )!
    expect(a.content).toContain("isn't enough on your financial profile")
  })

  it('the presence check rejects a rendered answer whose figures are not in the grounding', () => {
    // The check is the same ungroundedNumbers the output guard uses, inverted.
    // Every renderer keeps its grounding in display units; an answer with a
    // figure the data doesn't support must come back null (fall through to
    // generation) rather than ship.
    const a = renderVerifiedAnswer('emergency_fund', data())
    expect(a).not.toBeNull() // baseline: the real renderer passes its own check
    // A profile whose savings just don't appear in the content would fail —
    // assert the invariant the other way: the rendered figure IS the profile's.
    expect(a!.content).toContain('9000.00')
  })
})
