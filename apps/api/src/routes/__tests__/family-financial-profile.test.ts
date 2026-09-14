/**
 * PRD-102: policies[] round-trips, and the two new detector rules
 * (policy_renewal_window, no_health_or_critical_illness_cover) fire
 * correctly without disturbing the two existing protection-gap rules.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { Engine, type Insight } from '@agentoak/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFamilyFinancialProfileRoutes } from '../family-financial-profile.js'

vi.mock('../../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

const TENANT = 'tenant-protection-domain-test'

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function makeDb() {
  let stored: Record<string, unknown> | null = null
  const col = {
    findOne: vi.fn(async () => stored),
    // OAK-006: mirrors the real MongoDB driver's findOneAndUpdate — returns
    // the matched-and-updated document directly (not wrapped in `.value`),
    // or null when the filter (e.g. a version match) doesn't match anything
    // existing, which is exactly the conflict case the route now checks for.
    findOneAndUpdate: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown>; $inc?: Record<string, number> }) => {
      if ('version' in filter && (stored?.['version'] ?? 0) !== filter['version']) return null
      const currentVersion = (stored?.['version'] as number | undefined) ?? 0
      stored = { ...(stored ?? {}), ...update.$set, version: currentVersion + (update.$inc?.['version'] ?? 0) }
      return stored
    }),
    createIndex: vi.fn(async () => ({})),
  }
  return { collection: () => col } as any
}

async function buildApp(engine: Engine): Promise<{ app: ReturnType<typeof Fastify>; insights: Insight[] }> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  const db = makeDb()
  const insights: Insight[] = []
  await registerFamilyFinancialProfileRoutes(app, db, engine, async (generated) => {
    insights.push(...generated)
  })
  return { app, insights }
}

const BASE_PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 3600000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 10_000_000,
    income_protection_monthly_minor: 400000,
  },
  emergency_fund: {
    emergency_savings_minor: 3_600_000,
    monthly_expenses_minor: 300000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 30,
    target_retirement_age: 65,
    pension_balance_minor: 5_000_000,
    monthly_contribution_minor: 50000,
    target_retirement_income_minor: 3_000_000,
    expected_annual_growth_pct: 5,
  },
  education_funds: [
    { child_name: 'Sam', child_age: 8, current_savings_minor: 2_000_000, target_savings_minor: 2_000_000, years_remaining: 10 },
  ],
}

describe('PRD-102: policies[] and the new protection-domain rules', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('round-trips policies[] through POST then GET', async () => {
    const { app } = await buildApp(engine)
    const policies = [{ type: 'life', provider: 'Acme Insurance', coverage_amount_minor: 10_000_000, monthly_premium_minor: 2000 }]

    const post = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, policies },
    })
    expect(post.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.statusCode).toBe(200)
    expect(get.json().profile.policies).toEqual(policies)
  })

  it('fires policy_renewal_window for a policy renewing within 60 days, not for one renewing in 200', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [{ type: 'life', provider: 'Acme', coverage_amount_minor: 100, monthly_premium_minor: 0, renewal_date: daysFromNow(30) }],
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(insights.some((i) => i.rule_id === 'policy_renewal_window')).toBe(true)

    const { app: app2, insights: insights2 } = await buildApp(engine)
    await app2.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [{ type: 'life', provider: 'Acme', coverage_amount_minor: 100, monthly_premium_minor: 0, renewal_date: daysFromNow(200) }],
        generate_insights: true,
      },
    })
    expect(insights2.some((i) => i.rule_id === 'policy_renewal_window')).toBe(false)
  })

  it('fires no_health_or_critical_illness_cover for dependents with no health/CI policy, not when one exists', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, policies: [], generate_insights: true },
    })
    expect(insights.some((i) => i.rule_id === 'no_health_or_critical_illness_cover')).toBe(true)

    const { app: app2, insights: insights2 } = await buildApp(engine)
    await app2.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [{ type: 'critical_illness', provider: 'Acme', coverage_amount_minor: 100, monthly_premium_minor: 0 }],
        generate_insights: true,
      },
    })
    expect(insights2.some((i) => i.rule_id === 'no_health_or_critical_illness_cover')).toBe(false)
  })

  it('leaves the two existing protection-gap rules unaffected by an empty policies[]', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, life_cover_minor: 0, income_protection_monthly_minor: 0 },
        policies: [],
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'life_insurance_below_household_needs')).toBe(true)
    expect(insights.some((i) => i.rule_id === 'no_income_protection')).toBe(true)
  })
})

describe('PRD-104: household.members[]', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('fires a second, distinct no_income_protection insight (attributed to the real roster member_id) for a member who lacks protection, without duplicating the joint rules', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: {
          ...BASE_PROFILE.household,
          // BASE_PROFILE's primary earner already has income_protection_monthly_minor: 400000,
          // so only this member's lack of protection should fire here.
          members: [{ member_id: 'member-2', employment_status: 'employed', monthly_salary_minor: 350000, income_protection_monthly_minor: 0 }],
        },
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)

    const noIncomeProtectionInsights = insights.filter((i) => i.rule_id === 'no_income_protection')
    expect(noIncomeProtectionInsights).toHaveLength(1)
    expect(noIncomeProtectionInsights[0]?.feature_snapshot?.monthly_salary_minor).toBe(350000)
    // Proves the id actually threads through the engine, not just the numbers.
    expect(noIncomeProtectionInsights[0]?.feature_snapshot?.member_id).toBe('member-2')

    // The regression this test exists to catch: the household event fired
    // twice (once per earner), but the 3 joint/shared rules must not
    // duplicate — they're evaluated once, correctly, from the primary
    // earner's event; the member event neutralizes them.
    for (const ruleId of ['life_insurance_below_household_needs', 'policy_renewal_window', 'no_health_or_critical_illness_cover']) {
      expect(insights.filter((i) => i.rule_id === ruleId).length).toBeLessThanOrEqual(1)
    }
  })

  it('fires no_income_protection independently for both the primary earner and a member when both lack protection', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: {
          ...BASE_PROFILE.household,
          income_protection_monthly_minor: 0,
          members: [{ member_id: 'member-2', employment_status: 'self_employed', monthly_salary_minor: 250000, income_protection_monthly_minor: 0 }],
        },
        generate_insights: true,
      },
    })
    expect(insights.filter((i) => i.rule_id === 'no_income_protection')).toHaveLength(2)
  })

  it('does not fire no_income_protection for a retired member, even with a real monthly_salary_minor — no income to protect via this policy type', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: {
          ...BASE_PROFILE.household,
          // Primary earner already has protection in BASE_PROFILE.
          members: [{ member_id: 'member-2', employment_status: 'retired', monthly_salary_minor: 600000, income_protection_monthly_minor: 0 }],
        },
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'no_income_protection')).toBe(false)
  })

  it('round-trips members[] through POST then GET, and leaves it empty for profiles that never had any', async () => {
    const { app } = await buildApp(engine)
    const members = [{ member_id: 'member-2', employment_status: 'employed' as const, monthly_salary_minor: 350000, income_protection_monthly_minor: 0 }]

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, household: { ...BASE_PROFILE.household, members } },
    })
    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.household.members).toEqual(members)

    const { app: app2 } = await buildApp(engine)
    await app2.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const get2 = await app2.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get2.json().profile.household.members).toEqual([])
  })
})

describe('OAK-006: optimistic concurrency on POST /family/financial-profile', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('first-ever save (no version) succeeds and returns version 1', async () => {
    const { app } = await buildApp(engine)
    const res = await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    expect(res.statusCode).toBe(200)
    expect(res.json().version).toBe(1)
  })

  it('a save carrying the current version succeeds and bumps it', async () => {
    const { app } = await buildApp(engine)
    const first = await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const v1 = first.json().version

    const second = await app.inject({ method: 'POST', url: '/family/financial-profile', payload: { ...BASE_PROFILE, version: v1 } })
    expect(second.statusCode).toBe(200)
    expect(second.json().version).toBe(v1 + 1)
  })

  it('a save carrying a stale version is rejected with 409, not silently overwritten', async () => {
    const { app } = await buildApp(engine)
    const first = await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const v1 = first.json().version

    // Simulate a second tab saving first, advancing the version...
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: { ...BASE_PROFILE, version: v1 } })

    // ...then the first tab, still holding the stale v1, tries to save.
    const stale = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, household: { ...BASE_PROFILE.household, monthly_salary_minor: 1 }, version: v1 },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toMatch(/updated elsewhere/i)

    // The stale write's field never landed.
    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.household.monthly_salary_minor).not.toBe(1)
  })
})
