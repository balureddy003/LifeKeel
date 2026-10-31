/**
 * PRD-102: policies[] round-trips, and the two new detector rules
 * (policy_renewal_window, no_health_or_critical_illness_cover) fire
 * correctly without disturbing the two existing protection-gap rules.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { Engine, type Insight } from '@lifekeel/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFamilyFinancialProfileRoutes } from '../family-financial-profile.js'

vi.mock('../../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

// PRD-112: rewardReferralIfPending's own logic (credit-ledger mechanics,
// the atomic double-reward guard) is covered in isolation by
// referrals.test.ts — this file only needs to confirm the *wiring*: is
// it called on a tenant's first final submit, and not on later ones.
const rewardReferralIfPendingMock = vi.fn(async (_db: unknown, _tenantId: string) => {})
vi.mock('../referrals.js', () => ({
  rewardReferralIfPending: (db: unknown, tenantId: string) =>
    rewardReferralIfPendingMock(db, tenantId),
}))

// PRD-111: getSignalsCollection() is an async singleton with no db
// parameter — it would otherwise try a real MongoDB connection the moment
// maybeFlagUnreportedLifeChange runs. Stubbed to "no recent life event on
// file" by default (recentLifeEvent lets a test opt into the other case);
// everything else in db.js (getFamilyFinancialProfileCollection,
// getLifeChangeNudgeStateCollection, ...) stays real — both are plain
// `database.collection(name)` wrappers around whatever db this test's own
// makeDb() passes in, so they need no mock of their own.
let recentLifeEvent = false
vi.mock('../../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db.js')>()
  return {
    ...actual,
    getSignalsCollection: vi.fn(async () => ({
      findOne: async () => (recentLifeEvent ? { id: 'seed-event' } : null),
    })),
  }
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

beforeEach(() => {
  recentLifeEvent = false
  rewardReferralIfPendingMock.mockClear()
  rosterMembers = []
  estateDocs = []
})

const TENANT = 'tenant-protection-domain-test'

// PRD-120: roster members for the per-member retirement eval's DOB
// lookup — reset per test alongside the other module-level state.
let rosterMembers: Record<string, unknown>[] = []

// PRD-121: vault docs the estate eval reads (tenant_id + category are set
// at seed time so the mock's matchesFilter sees a realistic shape).
let estateDocs: Record<string, unknown>[] = []

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

// Mongo-filter matcher just capable enough for what resolveStaleInsights
// actually sends (equality + $in) — not a general Mongo emulator.
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return (cond as { $in: unknown[] }).$in.includes(doc[key])
    }
    return doc[key] === cond
  })
}

function makeDb() {
  let stored: Record<string, unknown> | null = null
  const profileCol = {
    findOne: vi.fn(async () => stored),
    // KEEL-006: mirrors the real MongoDB driver's findOneAndUpdate — returns
    // the matched-and-updated document directly (not wrapped in `.value`),
    // or null when the filter (e.g. a version match) doesn't match anything
    // existing, which is exactly the conflict case the route now checks for.
    findOneAndUpdate: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown>; $inc?: Record<string, number> },
      ) => {
        if ('version' in filter && (stored?.['version'] ?? 0) !== filter['version']) return null
        const currentVersion = (stored?.['version'] as number | undefined) ?? 0
        stored = {
          ...(stored ?? {}),
          ...update.$set,
          version: currentVersion + (update.$inc?.['version'] ?? 0),
        }
        return stored
      },
    ),
    updateOne: vi.fn(
      async (_filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        stored = { ...(stored ?? {}), ...update.$set }
        return { matchedCount: stored ? 1 : 0 }
      },
    ),
    // R27: first creation is an insert; a second insert is the unique-index conflict.
    insertOne: vi.fn(async (doc: Record<string, unknown>) => {
      if (stored) throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 })
      stored = { ...doc }
      return { insertedId: 'p1' }
    }),
    createIndex: vi.fn(async () => ({})),
  }
  // PRD-107: a minimal in-memory stand-in for the real 'insights' collection
  // resolveStaleInsights writes to — this test harness otherwise never
  // persists insights to Mongo (fired insights only reach the onInsightsGenerated
  // callback below), so tests that seed a pre-existing open insight and assert
  // it transitions to 'resolved' need somewhere real for that write to land.
  const insightDocs: Record<string, unknown>[] = []
  const insightsCol = {
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => insightDocs.filter((d) => matchesFilter(d, filter)),
    }),
    updateMany: vi.fn(
      async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        let modifiedCount = 0
        for (const doc of insightDocs) {
          if (matchesFilter(doc, filter)) {
            Object.assign(doc, update.$set)
            modifiedCount++
          }
        }
        return { modifiedCount }
      },
    ),
  }
  // PRD-111: one nudge-state doc per tenant, same upsert shape as the real
  // family_life_change_nudge_state collection.
  const nudgeStateDocs: Record<string, unknown>[] = []
  const nudgeStateCol = {
    findOne: vi.fn(
      async (filter: Record<string, unknown>) =>
        nudgeStateDocs.find((d) => matchesFilter(d, filter)) ?? null,
    ),
    updateOne: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set: Record<string, unknown> },
        opts?: { upsert?: boolean },
      ) => {
        let doc = nudgeStateDocs.find((d) => d['tenant_id'] === filter['tenant_id'])
        if (!doc) {
          if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 }
          doc = { tenant_id: filter['tenant_id'] }
          nudgeStateDocs.push(doc)
        }
        Object.assign(doc, update.$set)
        return { matchedCount: 1, modifiedCount: 1 }
      },
    ),
  }

  // PRD-120: the per-member retirement eval looks up roster DOBs here.
  const familyGroupsCol = {
    findOne: vi.fn(async (filter: Record<string, unknown> = {}) =>
      rosterMembers.length > 0 &&
      (filter['tenant_id'] === undefined || filter['tenant_id'] === TENANT)
        ? { tenant_id: TENANT, members: rosterMembers }
        : null,
    ),
    createIndex: vi.fn(async () => ({})),
  }

  // PRD-121: the estate eval reads vault doc types from 'documents' —
  // without this mock the fallthrough returns profileCol (no .find()).
  const documentsCol = {
    find: vi.fn((filter: Record<string, unknown>) => ({
      toArray: async () => estateDocs.filter((d) => matchesFilter(d, filter)),
    })),
  }

  // PRD-136: profile_changed feed events upsert here — a real sink so the
  // emit doesn't fall through to profileCol and pollute the stored profile.
  const eventDocs: Record<string, unknown>[] = []
  const readinessEventsCol = {
    updateOne: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
      ) => {
        const existing = eventDocs.find((d) => d['dedupe_key'] === filter['dedupe_key'])
        if (existing) Object.assign(existing, update.$set)
        else eventDocs.push({ ...update.$setOnInsert, ...update.$set })
        return { upsertedCount: 1 }
      },
    ),
  }

  return {
    collection: (name: string) =>
      name === 'insights'
        ? insightsCol
        : name === 'family_life_change_nudge_state'
          ? nudgeStateCol
          : name === 'family_groups'
            ? familyGroupsCol
            : name === 'documents'
              ? documentsCol
              : name === 'readiness_events'
                ? readinessEventsCol
                : profileCol,
    _insightDocs: insightDocs,
    _nudgeStateDocs: nudgeStateDocs,
    _eventDocs: eventDocs,
  } as any
}

async function buildApp(engine: Engine): Promise<{
  app: ReturnType<typeof Fastify>
  insights: Insight[]
  insightDocs: Record<string, unknown>[]
  nudgeStateDocs: Record<string, unknown>[]
  eventDocs: Record<string, unknown>[]
}> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1', roles: ['admin'] }
  })
  const db = makeDb()
  // Most tests save several times in a row the way the wizard does; the
  // wizard sends back the version each response returned. Fill it in here
  // unless a test sends one itself or opts out with x-raw-version (R27).
  app.addHook('preValidation', async (request) => {
    if (request.method !== 'POST' || request.url !== '/family/financial-profile') return
    if (request.headers['x-raw-version']) return
    const body = request.body as Record<string, unknown> | undefined
    if (!body || body['version'] !== undefined) return
    const current = await db.collection('family_financial_profile').findOne({})
    if (current) body['version'] = (current['version'] as number | undefined) ?? 0
  })
  const insights: Insight[] = []
  await registerFamilyFinancialProfileRoutes(app, db, engine, async (generated) => {
    insights.push(...generated)
  })
  return {
    app,
    insights,
    insightDocs: db._insightDocs,
    nudgeStateDocs: db._nudgeStateDocs,
    eventDocs: db._eventDocs,
  }
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
    {
      child_name: 'Sam',
      child_age: 8,
      current_savings_minor: 2_000_000,
      target_savings_minor: 2_000_000,
      years_remaining: 10,
    },
  ],
}

describe('PRD-102: policies[] and the new protection-domain rules', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('marks insights_evaluated_at only after a generate_insights submit, not after an autosave', async () => {
    const { app } = await buildApp(engine)
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const autosaved = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(autosaved.json().profile.insights_evaluated_at).toBeUndefined()

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    const finalised = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(finalised.json().profile.insights_evaluated_at).toBeDefined()

    // A later autosave must not clear it.
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const again = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(again.json().profile.insights_evaluated_at).toBeDefined()
  })

  it('round-trips policies[] through POST then GET', async () => {
    const { app } = await buildApp(engine)
    const policies = [
      {
        type: 'life',
        provider: 'Acme Insurance',
        coverage_amount_minor: 10_000_000,
        monthly_premium_minor: 2000,
      },
    ]

    const post = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, policies },
    })
    expect(post.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.statusCode).toBe(200)
    expect(get.json().profile.policies).toEqual([
      { ...policies[0], id: expect.stringMatching(/^pol_/) },
    ])
  })

  it('PRD-235: a policy saved without an id gets one, keeps it on later saves, and a client id wins', async () => {
    const { app } = await buildApp(engine)
    const life = {
      type: 'life',
      provider: 'Acme Insurance',
      coverage_amount_minor: 10_000_000,
      monthly_premium_minor: 2000,
    }
    const save = (policies: unknown[]) =>
      app.inject({
        method: 'POST',
        url: '/family/financial-profile',
        payload: { ...BASE_PROFILE, policies },
      })
    const read = async () =>
      (await app.inject({ method: 'GET', url: '/family/financial-profile' })).json().profile
        .policies

    await save([life])
    const first = (await read())[0].id
    expect(first).toMatch(/^pol_/)

    // Re-saved without an id (and a changed premium): same policy, same id.
    await save([{ ...life, monthly_premium_minor: 2500 }])
    expect((await read())[0].id).toBe(first)

    // A client-supplied id is kept as given.
    await save([{ ...life, id: 'pol_client' }])
    expect((await read())[0].id).toBe('pol_client')
  })

  it('intent 38: a changed premium appends the old amount to premium_history; an unchanged save does not', async () => {
    const { app } = await buildApp(engine)
    const policy = {
      type: 'car',
      provider: 'Acme Insurance',
      coverage_amount_minor: 5_000_000,
      monthly_premium_minor: 4000,
    }
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, policies: [policy] },
    })

    // Same premium → no history appended.
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, policies: [policy] },
    })
    let get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.policies[0].premium_history).toBeUndefined()

    // Raised premium → the old £40.00 lands in history.
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [{ ...policy, monthly_premium_minor: 5200 }],
      },
    })
    get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    const history = get.json().profile.policies[0].premium_history
    expect(history).toHaveLength(1)
    expect(history[0].amount_minor).toBe(4000)
    expect(typeof history[0].effective_from).toBe('string')

    // A second change appends again — history accumulates, never overwrites.
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [{ ...policy, monthly_premium_minor: 6000 }],
      },
    })
    get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(
      get
        .json()
        .profile.policies[0].premium_history.map((h: { amount_minor: number }) => h.amount_minor),
    ).toEqual([4000, 5200])
  })

  it('fires policy_renewal_window for a policy renewing within 60 days, not for one renewing in 200', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [
          {
            type: 'life',
            provider: 'Acme',
            coverage_amount_minor: 100,
            monthly_premium_minor: 0,
            renewal_date: daysFromNow(30),
          },
        ],
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
        policies: [
          {
            type: 'life',
            provider: 'Acme',
            coverage_amount_minor: 100,
            monthly_premium_minor: 0,
            renewal_date: daysFromNow(200),
          },
        ],
        generate_insights: true,
      },
    })
    expect(insights2.some((i) => i.rule_id === 'policy_renewal_window')).toBe(false)
  })

  it('PRD-213: fires policy_renewal_date_in_past for a renewal date already passed, not for a future one', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [
          {
            type: 'car',
            provider: 'Acme',
            coverage_amount_minor: 100,
            monthly_premium_minor: 4500,
            renewal_date: daysFromNow(-34),
          },
        ],
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)
    const stale = insights.find((i) => i.rule_id === 'policy_renewal_date_in_past')
    expect(stale).toBeDefined()
    expect(stale?.feature_snapshot?.['stale_renewal_count']).toBe(1)
    // A past-due date is not an upcoming renewal — the forward-looking
    // rule must not also fire on it.
    expect(insights.some((i) => i.rule_id === 'policy_renewal_window')).toBe(false)

    const { app: app2, insights: insights2 } = await buildApp(engine)
    await app2.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [
          {
            type: 'car',
            provider: 'Acme',
            coverage_amount_minor: 100,
            monthly_premium_minor: 4500,
            renewal_date: daysFromNow(90),
          },
        ],
        generate_insights: true,
      },
    })
    expect(insights2.some((i) => i.rule_id === 'policy_renewal_date_in_past')).toBe(false)
  })

  it('PRD-110: member_id on a policy round-trips and attributes the renewal insight to that roster member', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        policies: [
          {
            type: 'health',
            provider: 'Bupa',
            coverage_amount_minor: 0,
            monthly_premium_minor: 9000,
            renewal_date: daysFromNow(30),
            member_id: 'member-7',
          },
        ],
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.policies[0].member_id).toBe('member-7')

    const renewal = insights.find((i) => i.rule_id === 'policy_renewal_window')
    expect(renewal).toBeDefined()
    expect(renewal?.feature_snapshot?.['soonest_renewal_member_id']).toBe('member-7')
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
        policies: [
          {
            type: 'critical_illness',
            provider: 'Acme',
            coverage_amount_minor: 100,
            monthly_premium_minor: 0,
          },
        ],
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
        household: {
          ...BASE_PROFILE.household,
          life_cover_minor: 0,
          income_protection_monthly_minor: 0,
        },
        policies: [],
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'life_insurance_below_household_needs')).toBe(true)
    expect(insights.some((i) => i.rule_id === 'no_income_protection')).toBe(true)
  })
})

describe('unset targets and missing monthly expenses', () => {
  let engine: Engine
  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  // Shape of a real saved profile: £400k mortgage, no cover, targets never
  // entered (0, or the legacy 1-minor-unit client placeholder), no separate
  // monthly-expenses figure.
  const UNSET = {
    ...BASE_PROFILE,
    household: {
      ...BASE_PROFILE.household,
      monthly_salary_minor: 670000,
      annual_living_expenses_minor: 7_197_700,
      mortgage_outstanding_minor: 40_000_000,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
    },
    emergency_fund: {
      ...BASE_PROFILE.emergency_fund,
      emergency_savings_minor: 3_000_000,
      monthly_expenses_minor: 0,
    },
    retirement: {
      ...BASE_PROFILE.retirement,
      current_age: 42,
      target_retirement_age: 70,
      target_retirement_income_minor: 0,
    },
    education_funds: [
      {
        child_name: 'A',
        child_age: 0,
        current_savings_minor: 0,
        target_savings_minor: 0,
        years_remaining: 0,
      },
      {
        child_name: 'B',
        child_age: 0,
        current_savings_minor: 0,
        target_savings_minor: 1,
        years_remaining: 0,
      },
    ],
    policies: [],
  }

  it('accepts a 0 target, still fires the real protection gaps, and raises no education/retirement insight from unset targets', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...UNSET, generate_insights: true },
    })
    expect(res.statusCode).toBe(200)
    const rules = insights.map((i) => i.rule_id)
    expect(rules).toContain('life_insurance_below_household_needs')
    expect(rules).toContain('no_income_protection')
    expect(insights.some((i) => i.detector_id === 'family_education_shortfall')).toBe(false)
    expect(insights.some((i) => i.detector_id === 'family_retirement_gap')).toBe(false)
  })

  it('POST /evaluate runs detectors on the saved profile without re-entry and stamps it evaluated', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: UNSET }) // autosave only
    expect(insights).toHaveLength(0)
    const res = await app.inject({ method: 'POST', url: '/family/financial-profile/evaluate' })
    expect(res.statusCode).toBe(200)
    expect(insights.map((i) => i.rule_id)).toContain('life_insurance_below_household_needs')
    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.insights_evaluated_at).toBeDefined()
  })

  it('POST /evaluate is a 404 when there is no profile', async () => {
    const { app } = await buildApp(engine)
    const res = await app.inject({ method: 'POST', url: '/family/financial-profile/evaluate' })
    expect(res.statusCode).toBe(404)
  })

  it('derives monthly expenses from annual living expenses when none was entered', async () => {
    const { app, insights } = await buildApp(engine)
    // £8,000 savings vs ~£6,000/month expenses -> under 3 months of cover.
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...UNSET,
        emergency_fund: { ...UNSET.emergency_fund, emergency_savings_minor: 800_000 },
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'emergency_fund_below_3_months')).toBe(true)
  })
})

describe('PRD-105: car/home policy types, and gating life_insurance_below_household_needs on real dependency', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('accepts and round-trips type: "car" and type: "home" — previously a 400 invalid_enum_value', async () => {
    const { app } = await buildApp(engine)
    const policies = [
      {
        type: 'car',
        provider: 'Acme Motor',
        coverage_amount_minor: 2_000_000,
        monthly_premium_minor: 3000,
      },
      {
        type: 'home',
        provider: 'Acme Home',
        coverage_amount_minor: 30_000_000,
        monthly_premium_minor: 5000,
      },
    ]

    const post = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, policies },
    })
    expect(post.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.policies).toEqual(
      policies.map((p) => ({ ...p, id: expect.stringMatching(/^pol_/) })),
    )
  })

  it('does not fire life_insurance_below_household_needs for a household with no dependents and no mortgage, even with £0 cover', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: {
          ...BASE_PROFILE.household,
          life_cover_minor: 0,
          mortgage_outstanding_minor: 0,
        },
        education_funds: [], // no children on file -> has_dependents: 0
        policies: [],
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'life_insurance_below_household_needs')).toBe(false)
  })

  it('still fires for a household with a mortgage and no dependents — the gate is an "or", not an "and" on dependents alone', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: {
          ...BASE_PROFILE.household,
          life_cover_minor: 0,
          mortgage_outstanding_minor: 20_000_000,
        },
        education_funds: [],
        policies: [],
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'life_insurance_below_household_needs')).toBe(true)
  })

  it('still fires for a household with dependents and no mortgage, under-covered — regression against the existing dependents-only scenario', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: {
          ...BASE_PROFILE.household,
          life_cover_minor: 0,
          mortgage_outstanding_minor: 0,
        },
        // BASE_PROFILE already carries one child (Sam) -> has_dependents: 1
        policies: [],
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'life_insurance_below_household_needs')).toBe(true)
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
          members: [
            {
              member_id: 'member-2',
              employment_status: 'employed',
              monthly_salary_minor: 350000,
              income_protection_monthly_minor: 0,
            },
          ],
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
    for (const ruleId of [
      'life_insurance_below_household_needs',
      'policy_renewal_window',
      'no_health_or_critical_illness_cover',
    ]) {
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
          members: [
            {
              member_id: 'member-2',
              employment_status: 'self_employed',
              monthly_salary_minor: 250000,
              income_protection_monthly_minor: 0,
            },
          ],
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
          members: [
            {
              member_id: 'member-2',
              employment_status: 'retired',
              monthly_salary_minor: 600000,
              income_protection_monthly_minor: 0,
            },
          ],
        },
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'no_income_protection')).toBe(false)
  })

  it('round-trips members[] through POST then GET, and leaves it empty for profiles that never had any', async () => {
    const { app } = await buildApp(engine)
    const members = [
      {
        member_id: 'member-2',
        employment_status: 'employed' as const,
        monthly_salary_minor: 350000,
        income_protection_monthly_minor: 0,
      },
    ]

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

describe('PRD-120: per-member retirement evaluation', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
    rosterMembers = [
      {
        id: 'member-2',
        name: 'Sudha',
        role: 'adult',
        status: 'active',
        date_of_birth: '1990-01-01',
      },
    ]
  })

  const profileWithMember = (member: Record<string, unknown>) => ({
    ...BASE_PROFILE,
    household: { ...BASE_PROFILE.household, members: [member] },
    generate_insights: true,
  })

  it("evaluates the retirement detector on a member's own pension, attributed via member_id", async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: profileWithMember({
        member_id: 'member-2',
        employment_status: 'employed',
        monthly_salary_minor: 200_000,
        income_protection_monthly_minor: 0,
        // £1k balance + £0.10/mo vs a ~£10k/yr income-share target —
        // an uncloseable-by-contributions gap, so a rule must fire.
        pension_balance_minor: 100_000,
        monthly_pension_contribution_minor: 10,
      }),
    })
    expect(res.statusCode).toBe(200)

    const memberInsights = insights.filter(
      (i) =>
        i.detector_id === 'family_retirement_gap' &&
        i.feature_snapshot?.['member_id'] === 'member-2',
    )
    expect(memberInsights.length).toBeGreaterThanOrEqual(1)
    // The member event's affordability gate used *their* salary.
    expect(memberInsights[0]?.feature_snapshot?.['monthly_salary_minor']).toBe(200_000)
    // The household event's own insights stay member-less — no cross-tagging.
    const householdInsights = insights.filter(
      (i) =>
        i.detector_id === 'family_retirement_gap' &&
        i.feature_snapshot?.['member_id'] === undefined,
    )
    expect(householdInsights.every((i) => i.feature_snapshot?.['member_id'] === undefined)).toBe(
      true,
    )
  })

  it('does not evaluate a member whose pension fields were never entered — absent is not zero', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: profileWithMember({
        member_id: 'member-2',
        employment_status: 'employed',
        monthly_salary_minor: 200_000,
        income_protection_monthly_minor: 0,
      }),
    })
    expect(
      insights.filter(
        (i) =>
          i.detector_id === 'family_retirement_gap' &&
          i.feature_snapshot?.['member_id'] === 'member-2',
      ),
    ).toHaveLength(0)
  })

  it('skips a member whose pension data exists but has no roster DOB — no invented age', async () => {
    rosterMembers = [{ id: 'member-2', name: 'Sudha', role: 'adult', status: 'active' }] // no date_of_birth
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: profileWithMember({
        member_id: 'member-2',
        employment_status: 'employed',
        monthly_salary_minor: 200_000,
        income_protection_monthly_minor: 0,
        pension_balance_minor: 100_000,
        monthly_pension_contribution_minor: 10,
      }),
    })
    expect(
      insights.filter(
        (i) =>
          i.detector_id === 'family_retirement_gap' &&
          i.feature_snapshot?.['member_id'] === 'member-2',
      ),
    ).toHaveLength(0)
  })
})

describe('PRD-128: per-member life-cover detection', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  const memberEarner = {
    member_id: 'member-2',
    employment_status: 'employed' as const,
    monthly_salary_minor: 300_000,
    income_protection_monthly_minor: 200_000, // IP covered so only the life-cover rule is in play
  }

  it('fires member_no_life_cover for an employed second earner with dependents and no attributed life policy', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, members: [memberEarner] },
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)

    const memberCover = insights.filter((i) => i.rule_id === 'member_no_life_cover')
    // Exactly one firing, attributed to the member — never double-fired
    // by the primary household event.
    expect(memberCover).toHaveLength(1)
    expect(memberCover[0]?.feature_snapshot?.['member_id']).toBe('member-2')
    expect(memberCover[0]?.detector_id).toBe('family_protection_gap')
  })

  it('does not fire when the second earner has a life policy attributed to them', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, members: [memberEarner] },
        policies: [
          {
            type: 'life',
            provider: 'Aviva',
            coverage_amount_minor: 15_000_000,
            monthly_premium_minor: 3000,
            member_id: 'member-2',
          },
        ],
        generate_insights: true,
      },
    })
    expect(insights.filter((i) => i.rule_id === 'member_no_life_cover')).toHaveLength(0)
  })

  it('does not fire without dependents — nobody relies on the second income', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, members: [memberEarner] },
        education_funds: [],
        generate_insights: true,
      },
    })
    expect(insights.filter((i) => i.rule_id === 'member_no_life_cover')).toHaveLength(0)
  })

  it('never fires on the primary earner event — member_earner gates it', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    expect(insights.filter((i) => i.rule_id === 'member_no_life_cover')).toHaveLength(0)
  })
})

describe('KEEL-006: optimistic concurrency on POST /family/financial-profile', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('first-ever save (no version) succeeds and returns version 1', async () => {
    const { app } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: BASE_PROFILE,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().version).toBe(1)
  })

  it('a save carrying the current version succeeds and bumps it', async () => {
    const { app } = await buildApp(engine)
    const first = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: BASE_PROFILE,
    })
    const v1 = first.json().version

    const second = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, version: v1 },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().version).toBe(v1 + 1)
  })

  it('a save carrying a stale version is rejected with 409, not silently overwritten', async () => {
    const { app } = await buildApp(engine)
    const first = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: BASE_PROFILE,
    })
    const v1 = first.json().version

    // Simulate a second tab saving first, advancing the version...
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, version: v1 },
    })

    // ...then the first tab, still holding the stale v1, tries to save.
    const stale = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, monthly_salary_minor: 1 },
        version: v1,
      },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toMatch(/updated elsewhere/i)

    // The stale write's field never landed.
    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.household.monthly_salary_minor).not.toBe(1)
  })

  it('R27: a save with no version against an existing profile is a 409, not an overwrite', async () => {
    const { app } = await buildApp(engine)
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const blind = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      headers: { 'x-raw-version': '1' },
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, monthly_salary_minor: 1 },
      },
    })
    expect(blind.statusCode).toBe(409)
    expect(blind.json().version).toBe(1)
    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.json().profile.household.monthly_salary_minor).not.toBe(1)
  })

  it('R04: a viewer cannot change the household profile', async () => {
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      ;(request as any).authContext = { tenant_id: TENANT, user_id: 'viewer-1', roles: ['viewer'] }
    })
    await registerFamilyFinancialProfileRoutes(app, makeDb(), engine, async () => {})
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: BASE_PROFILE,
    })
    expect(res.statusCode).toBe(403)
    const evaluate = await app.inject({ method: 'POST', url: '/family/financial-profile/evaluate' })
    expect(evaluate.statusCode).toBe(403)
  })
})

describe('PRD-106: retirement projection correctness at and past target age', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it("this session's exact repro — a retired 70-year-old (target 65, real shortfall) gets a sustainability insight, never a projected retirement age", async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        retirement: {
          ...BASE_PROFILE.retirement,
          current_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 500_000, // achievable ~£200/yr at 4% SWR
          target_retirement_income_minor: 2_000_000, // £20,000/yr target — a real, severe shortfall
        },
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)

    expect(insights.some((i) => i.rule_id === 'retirement_behind_target_age')).toBe(false)

    const shortfall = insights.find(
      (i) => i.rule_id === 'retirement_gap_unaffordable_by_contributions',
    )
    expect(shortfall).toBeDefined()
    expect(shortfall!.reasoning).not.toMatch(/age/i)
    expect(shortfall!.reasoning).not.toContain('130')
  })

  it('a genuinely on-track retiree (balance covers the target income) gets no shortfall insight at all', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        retirement: {
          ...BASE_PROFILE.retirement,
          current_age: 70,
          target_retirement_age: 65,
          pension_balance_minor: 100_000_000, // achievable = 4,000,000/yr, well above target
          target_retirement_income_minor: 2_000_000,
        },
        generate_insights: true,
      },
    })
    expect(insights.some((i) => i.rule_id === 'retirement_behind_target_age')).toBe(false)
    expect(insights.some((i) => i.rule_id === 'retirement_gap_unaffordable_by_contributions')).toBe(
      false,
    )
  })

  it('a 63-year-old with a severe pre-target shortfall gets a sustainability insight, never "retire around age 111"', async () => {
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, monthly_salary_minor: 400_000 },
        retirement: {
          current_age: 63,
          target_retirement_age: 65,
          pension_balance_minor: 100_000,
          monthly_contribution_minor: 10_000,
          target_retirement_income_minor: 3_000_000,
          expected_annual_growth_pct: 5,
        },
        generate_insights: true,
      },
    })
    const shortfall = insights.find(
      (i) => i.rule_id === 'retirement_gap_unaffordable_by_contributions',
    )
    expect(shortfall).toBeDefined()
    expect(shortfall!.reasoning).not.toMatch(/age/i)
  })
})

describe('PRD-107: insight resolution', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  function seedOpenInsight(
    insightDocs: Record<string, unknown>[],
    detectorId: string,
    ruleId: string,
    state: 'identified' | 'sent' = 'identified',
  ) {
    insightDocs.push({
      id: `${ruleId}-seed`,
      tenant_id: TENANT,
      detector_id: detectorId,
      rule_id: ruleId,
      state,
    })
  }

  it("this session's exact repro — two genuinely-open insights both resolve when a gap-free profile no longer reproduces either condition", async () => {
    const { app, insightDocs } = await buildApp(engine)
    seedOpenInsight(insightDocs, 'family_protection_gap', 'no_income_protection')
    seedOpenInsight(insightDocs, 'family_protection_gap', 'life_insurance_below_household_needs')

    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        // Gap-free: full income protection, full life cover, no mortgage,
        // no dependents (education_funds empty) so neither rule's condition
        // can hold.
        household: {
          ...BASE_PROFILE.household,
          mortgage_outstanding_minor: 0,
          life_cover_minor: 10_000_000,
          income_protection_monthly_minor: 400000,
        },
        education_funds: [],
        generate_insights: true,
      },
    })
    expect(res.statusCode).toBe(200)

    const protectionInsight = insightDocs.find((d) => d['rule_id'] === 'no_income_protection')
    const lifeInsuranceInsight = insightDocs.find(
      (d) => d['rule_id'] === 'life_insurance_below_household_needs',
    )
    expect(protectionInsight?.['state']).toBe('resolved')
    expect(lifeInsuranceInsight?.['state']).toBe('resolved')
  })

  it('a rule that still fires does not get spuriously resolved-then-refired — no duplicate, no state churn', async () => {
    const { app, insights, insightDocs } = await buildApp(engine)
    seedOpenInsight(insightDocs, 'family_retirement_gap', 'no_retirement_savings')

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        retirement: { ...BASE_PROFILE.retirement, pension_balance_minor: 0 },
        generate_insights: true,
      },
    })

    // The still-firing rule's original seeded insight is untouched...
    const seeded = insightDocs.find((d) => d['rule_id'] === 'no_retirement_savings')
    expect(seeded?.['state']).toBe('identified')
    // ...and the route's own dedup/generation path is unaware of it (this
    // harness's onInsightsGenerated doesn't dedup against the seed at all —
    // it only proves resolveStaleInsights itself didn't touch a rule id
    // that's present in firedRuleIds this cycle).
    expect(insights.some((i) => i.rule_id === 'no_retirement_savings')).toBe(true)
  })

  it('entity-aware resolution: a rule firing for one member resolves the legacy unkeyed insight and produces a member-keyed replacement', async () => {
    const { app, insights, insightDocs } = await buildApp(engine)
    seedOpenInsight(insightDocs, 'family_protection_gap', 'no_income_protection')

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        // Primary earner now has full income protection (their own gap
        // resolved), but a second household member still has none.
        household: {
          ...BASE_PROFILE.household,
          income_protection_monthly_minor: 400000,
          members: [
            {
              member_id: 'member-1',
              employment_status: 'employed',
              monthly_salary_minor: 300000,
              income_protection_monthly_minor: 0,
            },
          ],
        },
        generate_insights: true,
      },
    })

    // The legacy unkeyed seed is stale — its (rule, '') pair didn't
    // reproduce; the member-1 firing superseded it with a keyed insight.
    const seeded = insightDocs.find((d) => d['rule_id'] === 'no_income_protection')
    expect(seeded?.['state']).toBe('resolved')
    const memberInsight = insights.find((i) => i.rule_id === 'no_income_protection')
    expect(memberInsight?.['entity_key']).toBe('member-1')
  })
})

describe('PRD-111: unreported life-change nudge', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('a final save crossing employment_status to unemployed, with no recent life event, flags the nudge active', async () => {
    const { app, nudgeStateDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, employment_status: 'unemployed' },
        generate_insights: true,
      },
    })
    expect(nudgeStateDocs.find((d) => d['tenant_id'] === TENANT)?.['active']).toBe(true)
  })

  it('the same crossing on an intermediate autosave (no generate_insights) does not flag the nudge', async () => {
    const { app, nudgeStateDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, employment_status: 'unemployed' },
      },
    })
    expect(nudgeStateDocs.find((d) => d['tenant_id'] === TENANT)?.['active']).not.toBe(true)
  })

  it('a crossing does not flag the nudge when a life event was already reported recently', async () => {
    recentLifeEvent = true
    const { app, nudgeStateDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })

    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, employment_status: 'unemployed' },
        generate_insights: true,
      },
    })
    expect(nudgeStateDocs.find((d) => d['tenant_id'] === TENANT)?.['active']).not.toBe(true)
  })

  it('a first-ever save never flags the nudge — nothing to diff against', async () => {
    const { app, nudgeStateDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, employment_status: 'unemployed' },
        generate_insights: true,
      },
    })
    expect(nudgeStateDocs.find((d) => d['tenant_id'] === TENANT)?.['active']).not.toBe(true)
  })

  it('a save with no threshold crossed does not flag the nudge', async () => {
    const { app, nudgeStateDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        household: { ...BASE_PROFILE.household, monthly_salary_minor: 420000 },
        generate_insights: true,
      },
    })
    expect(nudgeStateDocs.find((d) => d['tenant_id'] === TENANT)?.['active']).not.toBe(true)
  })
})

describe('PRD-112: friend referral reward wiring', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('calls rewardReferralIfPending on a final submit', async () => {
    const { app } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    expect(rewardReferralIfPendingMock).toHaveBeenCalledTimes(1)
    expect(rewardReferralIfPendingMock).toHaveBeenCalledWith(expect.anything(), TENANT)
  })

  it('still rewards when the wizard autosaved first — the real UI path (regression)', async () => {
    // The wizard POSTs after every step; only the last sends generate_insights.
    // A profile document therefore exists before the final submit. The reward
    // used to be gated on "no previous document", so it never fired in the app.
    const { app } = await buildApp(engine)
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    const saved = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    const version = saved.json().profile?.version
    expect(rewardReferralIfPendingMock).not.toHaveBeenCalled()
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, version, generate_insights: true },
    })
    expect(rewardReferralIfPendingMock).toHaveBeenCalledTimes(1)
    expect(rewardReferralIfPendingMock).toHaveBeenCalledWith(expect.anything(), TENANT)
  })

  it('does not call rewardReferralIfPending on an intermediate autosave (no generate_insights)', async () => {
    const { app } = await buildApp(engine)
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: BASE_PROFILE })
    expect(rewardReferralIfPendingMock).not.toHaveBeenCalled()
  })
})

describe('Financial Profile wizard: education_funds[].member_id (roster-linked children)', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('round-trips education_funds[].member_id through POST then GET', async () => {
    const { app } = await buildApp(engine)
    const education_funds = [
      {
        child_name: 'Sam',
        child_age: 8,
        current_savings_minor: 2_000_000,
        target_savings_minor: 2_000_000,
        years_remaining: 10,
        member_id: 'roster-child-1',
      },
    ]

    const post = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, education_funds },
    })
    expect(post.statusCode).toBe(200)

    const get = await app.inject({ method: 'GET', url: '/family/financial-profile' })
    expect(get.statusCode).toBe(200)
    expect(get.json().profile.education_funds).toEqual(education_funds)
  })

  it('still accepts an education fund with no member_id, unchanged from before this field existed', async () => {
    const { app } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: BASE_PROFILE,
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('PRD-121: family_estate_readiness detector', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  const seedEstateDoc = (doc_type: string) => {
    estateDocs.push({ tenant_id: TENANT, category: 'estate_vault', doc_type })
  }

  it('fires estate_no_will and estate_no_power_of_attorney when the vault has no estate docs', async () => {
    const { app, insights } = await buildApp(engine)
    const res = await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    expect(res.statusCode).toBe(200)
    const estate = insights.filter((i) => i.detector_id === 'family_estate_readiness')
    expect(estate.map((i) => i.rule_id).sort()).toEqual([
      'estate_no_power_of_attorney',
      'estate_no_will',
    ])
  })

  it('fires only the missing-document rule when a will is already on file', async () => {
    seedEstateDoc('will')
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    const estate = insights.filter((i) => i.detector_id === 'family_estate_readiness')
    expect(estate.map((i) => i.rule_id)).toEqual(['estate_no_power_of_attorney'])
  })

  it('fires no estate insights when both documents are on file', async () => {
    seedEstateDoc('will')
    seedEstateDoc('power_of_attorney')
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    expect(insights.some((i) => i.detector_id === 'family_estate_readiness')).toBe(false)
  })

  it('ignores vault docs outside the estate category and unrecognised doc types', async () => {
    estateDocs.push({ tenant_id: TENANT, category: 'receipts', doc_type: 'will' })
    seedEstateDoc('other')
    const { app, insights } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    const estate = insights.filter((i) => i.detector_id === 'family_estate_readiness')
    expect(estate.map((i) => i.rule_id).sort()).toEqual([
      'estate_no_power_of_attorney',
      'estate_no_will',
    ])
  })

  it('resolves an open estate insight once the document is on file', async () => {
    const { app, insightDocs } = await buildApp(engine)
    insightDocs.push({
      id: 'ins-estate-will-open',
      tenant_id: TENANT,
      detector_id: 'family_estate_readiness',
      rule_id: 'estate_no_will',
      entity_key: '',
      state: 'identified',
      created_at: new Date(),
    })
    seedEstateDoc('will')
    seedEstateDoc('power_of_attorney')
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    expect(insightDocs.find((d) => d['id'] === 'ins-estate-will-open')?.['state']).toBe('resolved')
  })
})

describe('PRD-136: profile_changed feed event', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  const flush = () => new Promise((r) => setTimeout(r, 20))

  it('first save emits nothing — no baseline to diff against', async () => {
    const { app, eventDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    await flush()
    expect(eventDocs.filter((e) => e['type'] === 'profile_changed')).toHaveLength(0)
    await app.close()
  })

  it('a second save with changed fields emits one event naming them', async () => {
    const { app, eventDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    const changed = {
      ...BASE_PROFILE,
      household: {
        ...BASE_PROFILE.household,
        monthly_salary_minor: 500_000,
        life_cover_minor: 12_000_000,
      },
      emergency_fund: { ...BASE_PROFILE.emergency_fund, emergency_savings_minor: 4_000_000 },
      generate_insights: true,
    }
    await app.inject({ method: 'POST', url: '/family/financial-profile', payload: changed })
    await flush()

    const events = eventDocs.filter((e) => e['type'] === 'profile_changed')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      severity: 'info',
      direction: null,
      domain: null,
      links: [{ kind: 'profile_field', id: 'household.monthly_salary_minor' }],
    })
    expect(events[0]!['title']).toBe('Monthly income, life cover and emergency savings changed')
    expect(events[0]!['dedupe_key']).toMatch(/^profile_changed:/)
    await app.close()
  })

  it('an identical re-save emits nothing — same data is not a change', async () => {
    const { app, eventDocs } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: { ...BASE_PROFILE, generate_insights: true },
    })
    await flush()
    expect(eventDocs.filter((e) => e['type'] === 'profile_changed')).toHaveLength(0)
    await app.close()
  })
})

describe('GET /family/retirement/estimate (intent 32)', () => {
  let engine: Engine
  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('re-projects on hypothetical inputs and writes nothing', async () => {
    const { app } = await buildApp(engine)
    await app.inject({
      method: 'POST',
      url: '/family/financial-profile',
      payload: {
        ...BASE_PROFILE,
        retirement: {
          current_age: 40,
          target_retirement_age: 65,
          pension_balance_minor: 10_000_000,
          monthly_contribution_minor: 30_000,
          target_retirement_income_minor: 2_400_000,
          expected_annual_growth_pct: 5,
        },
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/family/retirement/estimate?monthly_contribution_minor=100000',
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.hasData).toBe(true)
    expect(body.current.monthly_contribution_minor).toBe(30_000)
    expect(body.projection.target_retirement_income_minor).toBe(2_400_000)
    // A bigger contribution must not project a lower achievable income.
    const res2 = await app.inject({
      method: 'GET',
      url: '/family/retirement/estimate?monthly_contribution_minor=5000',
    })
    expect(res2.json().projection.achievable_retirement_income_minor).toBeLessThanOrEqual(
      body.projection.achievable_retirement_income_minor,
    )
  })

  it('returns hasData:false without a profile', async () => {
    const { app } = await buildApp(engine)
    const res = await app.inject({ method: 'GET', url: '/family/retirement/estimate' })
    expect(res.json().hasData).toBe(false)
  })
})
