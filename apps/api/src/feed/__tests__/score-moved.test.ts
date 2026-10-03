import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

// Deterministic scores: the diff logic under test is in the route's
// snapshot block, not in computeReadiness — stub the calculator so each
// case controls the "today" number exactly.
vi.mock('../../readiness/score.js', () => ({
  computeReadiness: vi.fn(),
}))
import { computeReadiness } from '../../readiness/score.js'
import { registerFamilyReadinessRoutes } from '../../routes/family-readiness.js'

const scoreMock = vi.mocked(computeReadiness)

function setScore(score: number, componentScore = score) {
  scoreMock.mockReturnValue({
    score,
    components: [
      { key: 'protection', label: 'Protection', score: componentScore, weight: 1, detail: 'stub' },
    ],
  } as never)
}

const DAY = 86_400_000
const yesterday = () => new Date(Date.now() - DAY).toISOString().slice(0, 10)

const profile = {
  tenant_id: 't1',
  insights_evaluated_at: new Date(),
  household: { employment_status: 'employed', monthly_salary_minor: 400_000, annual_living_expenses_minor: 360_000 },
  emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 1_000_000,
    monthly_contribution_minor: 50_000,
    target_retirement_income_minor: 250_000,
  },
  education_funds: [],
  policies: [],
}

function makeDb(historyRows: Record<string, unknown>[]) {
  const events: Record<string, unknown>[] = []
  const collections: Record<string, unknown> = {
    family_financial_profile: { findOne: async () => profile },
    family_groups: {
      findOne: async () => ({
        tenant_id: 't1',
        members: [{ id: 'u1', role: 'organizer', status: 'active' }],
      }),
    },
    documents: { find: () => ({ toArray: async () => [] }) },
    insights: { find: () => ({ toArray: async () => [] }) },
    family_readiness_history: {
      // Deliberately no .sort() — exercises the JS fallback path.
      find: () => ({ toArray: async () => historyRows }),
      updateOne: async (_f: unknown, update: { $set?: Record<string, unknown> }) => {
        historyRows.push({ ...update.$set })
        return { upsertedCount: 1 }
      },
    },
    readiness_events: {
      updateOne: async (
        _filter: unknown,
        update: { $set?: Record<string, unknown>; $setOnInsert?: Record<string, unknown> },
      ) => {
        events.push({ ...update.$setOnInsert, ...update.$set })
        return { upsertedCount: 1 }
      },
    },
  }
  return { events, db: { collection: (n: string) => collections[n] } as never }
}

async function build(db: never) {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as never as { authContext: unknown }).authContext = { tenant_id: 't1', user_id: 'u1' }
  })
  registerFamilyReadinessRoutes(app, db)
  return app
}

const flush = () => new Promise((r) => setTimeout(r, 20))

describe('score_moved feed events', () => {
  beforeEach(() => scoreMock.mockReset())

  it('74 → 82 emits an attention/up event with Score evidence', async () => {
    setScore(82)
    const { db, events } = makeDb([
      { tenant_id: 't1', date: yesterday(), score: 74, components: { protection: 74 } },
    ])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'score_moved',
      severity: 'attention',
      direction: 'up',
      domain: 'protection',
    })
    expect((events[0]!['evidence'] as { label: string; value: string }[])[0]).toEqual({
      label: 'Score',
      value: '74 → 82',
    })
  })

  it('74 → 76 emits info', async () => {
    setScore(76)
    const { db, events } = makeDb([
      { tenant_id: 't1', date: yesterday(), score: 74, components: { protection: 74 } },
    ])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'score_moved', severity: 'info', direction: 'up' })
  })

  it('74 → 74 emits nothing', async () => {
    setScore(74)
    const { db, events } = makeDb([
      { tenant_id: 't1', date: yesterday(), score: 74, components: { protection: 74 } },
    ])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    expect(events).toHaveLength(0)
  })

  it('no previous snapshot emits nothing (baseline, not a move)', async () => {
    setScore(82)
    const { db, events } = makeDb([])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    expect(events).toHaveLength(0)
  })
})

describe('emergency-fund target milestone', () => {
  beforeEach(() => scoreMock.mockReset())

  function setComponents(efScore: number, protectionScore = 80) {
    scoreMock.mockReturnValue({
      score: Math.round((efScore + protectionScore) / 2),
      components: [
        { key: 'emergency_fund', label: 'Emergency fund', score: efScore, weight: 1, detail: 'stub' },
        { key: 'protection', label: 'Protection', score: protectionScore, weight: 1, detail: 'stub' },
      ],
    } as never)
  }

  it('emits a once-ever milestone when the fund first reaches 100', async () => {
    setComponents(100)
    const { db, events } = makeDb([
      { tenant_id: 't1', date: yesterday(), score: 85, components: { emergency_fund: 90, protection: 80 } },
    ])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    const milestone = events.find((e) => e['type'] === 'milestone')
    expect(milestone).toMatchObject({
      type: 'milestone',
      severity: 'notice',
      direction: 'up',
      domain: 'emergency_fund',
      dedupe_key: 'milestone:t1:emergency-fund-target',
    })
  })

  it('already at target yesterday → no milestone', async () => {
    setComponents(100)
    const { db, events } = makeDb([
      { tenant_id: 't1', date: yesterday(), score: 90, components: { emergency_fund: 100, protection: 80 } },
    ])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    expect(events.some((e) => e['type'] === 'milestone')).toBe(false)
  })

  it('no previous snapshot → no milestone', async () => {
    setComponents(100)
    const { db, events } = makeDb([])
    await (await build(db)).inject({ method: 'GET', url: '/family/readiness' })
    await flush()
    expect(events.some((e) => e['type'] === 'milestone')).toBe(false)
  })
})
