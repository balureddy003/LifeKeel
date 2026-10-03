import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyFinancialProfileRoutes } from '../routes/family-financial-profile.js'

const DAY = 86_400_000

// The review endpoints only touch the profile collection — a fake
// db.collection('family_financial_profile') backed by a single in-memory
// doc, plus a catch-all for anything else the route file's other
// endpoints would touch (they aren't exercised here).
function makeDb(doc: Record<string, unknown> | null) {
  const state: { doc: Record<string, unknown> | null } = { doc }
  const profileCol = {
    findOne: async () => state.doc,
    updateOne: vi.fn(
      async (_filter: unknown, update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) => {
        if (!state.doc) return { matchedCount: 0 }
        Object.assign(state.doc, update.$set)
        for (const k of Object.keys(update.$unset ?? {})) delete state.doc[k]
        return { matchedCount: 1 }
      },
    ),
    createIndex: vi.fn(() => Promise.resolve('')),
  }
  const db = {
    collection: (name: string) =>
      name === 'family_financial_profile'
        ? profileCol
        : {
            findOne: async () => null,
            find: () => ({ toArray: async () => [] }),
            updateOne: vi.fn(async () => ({})),
            createIndex: vi.fn(() => Promise.resolve('')),
          },
  }
  return { db: db as never, state }
}

const baseProfile = {
  tenant_id: 't1',
  household: { employment_status: 'employed', monthly_salary_minor: 400_000 },
  emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
  retirement: { current_age: 40, target_retirement_age: 65, pension_balance_minor: 1_000_000 },
  education_funds: [],
  policies: [],
}

async function build(db: never) {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    ;(req as never as { authContext: unknown }).authContext = { tenant_id: 't1', user_id: 'u1' }
  })
  // The review endpoints never reach the engine — a stub stands in.
  await registerFamilyFinancialProfileRoutes(app, db, {} as never)
  return app
}

describe('annual profile review', () => {
  it('reports due=false with no profile on file', async () => {
    const { db } = makeDb(null)
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/financial-profile/review' })
    expect(res.json()).toMatchObject({ due: false, last_reviewed_at: null })
  })

  it('is not due for a profile touched recently', async () => {
    const { db } = makeDb({ ...baseProfile, updated_at: new Date(Date.now() - 30 * DAY) })
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/financial-profile/review' })
    expect(res.json().due).toBe(false)
  })

  it('is due once the reference point passes 365 days', async () => {
    const { db } = makeDb({ ...baseProfile, updated_at: new Date(Date.now() - 400 * DAY) })
    const res = await (await build(db)).inject({ method: 'GET', url: '/family/financial-profile/review' })
    expect(res.json()).toMatchObject({ due: true })
  })

  it('a confirmed review stops the prompt and stores a snapshot for next year', async () => {
    const { db, state } = makeDb({ ...baseProfile, updated_at: new Date(Date.now() - 400 * DAY) })
    const app = await build(db)
    const post = await app.inject({ method: 'POST', url: '/family/financial-profile/review', payload: { action: 'confirm' } })
    expect(post.statusCode).toBe(200)
    expect(state.doc?.['reviewed_at']).toBeInstanceOf(Date)
    expect((state.doc?.['review_snapshot'] as Record<string, unknown>)?.['household']).toBeDefined()

    const get = await app.inject({ method: 'GET', url: '/family/financial-profile/review' })
    expect(get.json().due).toBe(false)
  })

  it('next year\'s prompt names what changed since the snapshot', async () => {
    const { db, state } = makeDb({ ...baseProfile, updated_at: new Date(Date.now() - 400 * DAY) })
    const app = await build(db)
    await app.inject({ method: 'POST', url: '/family/financial-profile/review', payload: { action: 'confirm' } })
    // A year later, salary moved and a policy was added. Replace, don't
    // mutate — the in-memory fake would otherwise share the nested object
    // with the stored snapshot (real Mongo serializes, so this is a
    // test-only artifact).
    ;(state.doc as Record<string, unknown>)['reviewed_at'] = new Date(Date.now() - 400 * DAY)
    ;(state.doc as Record<string, unknown>)['updated_at'] = new Date()
    ;(state.doc as Record<string, unknown>)['household'] = { ...baseProfile.household, monthly_salary_minor: 500_000 }
    ;(state.doc as Record<string, unknown>)['policies'] = [{ type: 'life', provider: 'Aviva' }]

    const res = await app.inject({ method: 'GET', url: '/family/financial-profile/review' })
    const body = res.json()
    expect(body.due).toBe(true)
    expect(body.changed).toContain('monthly income')
    expect(body.changed.some((c: string) => c.includes('policies'))).toBe(true)
  })

  it('"later" snoozes the prompt for 30 days without confirming', async () => {
    const { db, state } = makeDb({ ...baseProfile, updated_at: new Date(Date.now() - 400 * DAY) })
    const app = await build(db)
    await app.inject({ method: 'POST', url: '/family/financial-profile/review', payload: { action: 'later' } })
    expect(state.doc?.['reviewed_at']).toBeUndefined()
    expect(state.doc?.['review_snoozed_until']).toBeInstanceOf(Date)
    const res = await app.inject({ method: 'GET', url: '/family/financial-profile/review' })
    expect(res.json().due).toBe(false)
  })
})
