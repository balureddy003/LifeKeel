/**
 * POST /family/financial-profile/figures: save the four figures a brief is built on (savings, monthly spending,
 * monthly income, income protection) onto the family list in one confirmation. Household editors only. Works
 * with no financial profile on file, and touches nothing but the fields it was sent.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyFiguresRoutes } from '../family-figures.js'

const TENANT = 't-fig'
let profile: Record<string, unknown> | null
let family: Record<string, unknown>

/** Applies a Mongo-style dotted $set onto a nested object, as the real driver would. */
function setPath(doc: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cur = doc
  for (const p of parts.slice(0, -1)) {
    cur[p] = (cur[p] as Record<string, unknown> | undefined) ?? {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]!] = value
}

const col = (name: string) => ({
  findOne: async () =>
    name === 'family_groups' ? family : name === 'family_financial_profile' ? profile : null,
  updateOne: async (
    _f: unknown,
    u: { $set?: Record<string, unknown>; $inc?: Record<string, number> },
    o?: { upsert?: boolean },
  ) => {
    if (name !== 'family_financial_profile') return {}
    if (!profile) {
      if (!o?.upsert) return {}
      profile = { tenant_id: TENANT }
    }
    for (const [k, v] of Object.entries(u.$set ?? {})) setPath(profile, k, v)
    for (const [k, v] of Object.entries(u.$inc ?? {}))
      profile[k] = ((profile[k] as number) ?? 0) + v
    return {}
  },
})
const db = () => ({ collection: (n: string) => col(n) }) as never

function appFor(user_id: string, roles = ['admin']) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id, roles }
  })
  registerFamilyFiguresRoutes(app, db())
  return app
}
const save = (who: string, payload: object, roles?: string[]) =>
  appFor(who, roles).inject({ method: 'POST', url: '/family/financial-profile/figures', payload })

beforeEach(() => {
  profile = null
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'kit', name: 'Kit', role: 'child', status: 'active' },
    ],
  }
})

const FIGURES = {
  savings_minor: 900000,
  monthly_spend_minor: 360000,
  monthly_inflow_minor: 420000,
}

describe('POST /family/financial-profile/figures', () => {
  it('saves the figures when there is no profile yet, and says what it saved', async () => {
    const res = await save('u1', FIGURES)
    expect(res.statusCode).toBe(200)
    expect(profile).toMatchObject({
      emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 360000 },
      household: { monthly_salary_minor: 420000 },
      version: 1,
    })
    const body = res.json() as { saved: { key: string; before: number | null; after: number }[] }
    expect(body.saved.map((s) => s.key).sort()).toEqual([
      'monthly_inflow_minor',
      'monthly_spend_minor',
      'savings_minor',
    ])
    expect(body.saved.every((s) => s.before === null)).toBe(true)
  })

  it('touches only the fields it was sent and leaves the rest of the profile alone', async () => {
    profile = {
      tenant_id: TENANT,
      version: 4,
      household: { employment_status: 'employed', monthly_salary_minor: 100, life_cover_minor: 5 },
      emergency_fund: {
        emergency_savings_minor: 1,
        monthly_expenses_minor: 2,
        has_high_interest_debt: true,
      },
      policies: [{ id: 'pol_1' }],
    }
    const res = await save('u1', { savings_minor: 500000 })
    expect(res.statusCode).toBe(200)
    expect(profile).toMatchObject({
      version: 5,
      household: { employment_status: 'employed', monthly_salary_minor: 100, life_cover_minor: 5 },
      emergency_fund: {
        emergency_savings_minor: 500000,
        monthly_expenses_minor: 2,
        has_high_interest_debt: true,
      },
      policies: [{ id: 'pol_1' }],
    })
    const body = res.json() as { saved: { key: string; before: number; after: number }[] }
    expect(body.saved).toEqual([
      { key: 'savings_minor', label: 'Savings', before: 1, after: 500000 },
    ])
  })

  it('reports a figure that is already the same as unchanged, and does not bump the version', async () => {
    profile = {
      tenant_id: TENANT,
      version: 2,
      emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 360000 },
      household: { monthly_salary_minor: 420000 },
    }
    const res = await save('u1', FIGURES)
    expect(res.statusCode).toBe(200)
    const body = res.json() as { saved: unknown[]; unchanged: { key: string }[] }
    expect(body.saved).toEqual([])
    expect(body.unchanged).toHaveLength(3)
    expect(profile?.['version']).toBe(2)
  })

  it('accepts zero savings and zero income protection, which are real answers', async () => {
    const res = await save('u1', { savings_minor: 0, income_protection_monthly_minor: 0 })
    expect(res.statusCode).toBe(200)
    expect(profile).toMatchObject({
      emergency_fund: { emergency_savings_minor: 0 },
      household: { income_protection_monthly_minor: 0 },
    })
  })

  it('refuses zero spending and zero income, which would leave the estimate empty', async () => {
    expect((await save('u1', { monthly_spend_minor: 0 })).statusCode).toBe(400)
    expect((await save('u1', { monthly_inflow_minor: 0 })).statusCode).toBe(400)
    expect(profile).toBeNull()
  })

  it('refuses a child, an outsider and a read-only role', async () => {
    expect((await save('kit', FIGURES, ['member'])).statusCode).toBe(403)
    expect((await save('stranger', FIGURES, ['member'])).statusCode).toBe(403)
    expect(profile).toBeNull()
  })

  it('refuses negative, fractional, over-limit, unknown and empty bodies', async () => {
    for (const bad of [
      { savings_minor: -1 },
      { savings_minor: 12.5 },
      { savings_minor: 1e15 },
      { savings_minor: 'lots' },
      { life_cover_minor: 100 },
      {},
    ])
      expect((await save('u1', bad)).statusCode).toBe(400)
    expect(profile).toBeNull()
  })
})
