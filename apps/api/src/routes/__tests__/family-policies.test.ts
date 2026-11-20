/**
 * POST /family/policies: one short form to add a policy, with the monthly-versus-yearly check in the answer.
 * Household editors only. Works with no financial profile on file.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

vi.mock('../../briefs/briefs.js', () => ({ markBriefsStale: vi.fn(async () => {}) }))
import { markBriefsStale } from '../../briefs/briefs.js'
import { registerFamilyPoliciesRoutes } from '../family-policies.js'

const TENANT = 't-pol'
let profile: Record<string, unknown> | null
let family: Record<string, unknown>

const col = (name: string) => ({
  findOne: async () =>
    name === 'family_groups' ? family : name === 'family_financial_profile' ? profile : null,
  updateOne: async (
    _f: unknown,
    u: {
      $push?: Record<string, unknown>
      $set?: Record<string, unknown>
      $inc?: Record<string, number>
    },
    o?: { upsert?: boolean },
  ) => {
    if (name !== 'family_financial_profile') return {}
    if (!profile) {
      if (!o?.upsert) return {}
      profile = { tenant_id: TENANT }
    }
    for (const [k, v] of Object.entries(u.$push ?? {}))
      profile[k] = [...((profile[k] as unknown[]) ?? []), v]
    Object.assign(profile, u.$set ?? {})
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
  registerFamilyPoliciesRoutes(app, db())
  return app
}
const add = (who: string, payload: object, roles?: string[]) =>
  appFor(who, roles).inject({ method: 'POST', url: '/family/policies', payload })

beforeEach(() => {
  profile = null
  vi.mocked(markBriefsStale).mockClear()
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'tom', name: 'Tom', role: 'adult', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
    ],
  }
})

const TOM = {
  type: 'life',
  provider: 'Example Life',
  covers_member_id: 'tom',
  coverage_amount_minor: 25_000_000,
  monthly_premium_minor: 4200,
  annual_premium_minor: 50_000,
  contact_phone: '0800 000 000',
}

describe('POST /family/policies', () => {
  it('adds the policy with no financial profile on file, and says the numbers do not match', async () => {
    const res = await add('u1', TOM)
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.policy.id).toMatch(/^pol_/)
    expect(body.check.status).toBe('mismatch')
    expect(body.check.text).toMatch(
      /£42 a month adds up to £504 a year\. You entered £500 a year, £4 less/,
    )
    const stored = (profile?.['policies'] as Record<string, unknown>[])[0]!
    expect(stored).toMatchObject({
      type: 'life',
      provider: 'Example Life',
      monthly_premium_minor: 4200,
      annual_premium_minor: 50_000, // as typed, never replaced by twelve months
      beneficiary_member_id: 'tom',
      contact_phone: '0800 000 000',
    })
    expect(profile?.['version']).toBe(1)
    expect(markBriefsStale).toHaveBeenCalledOnce()
  })

  it('says the figures match when they do, and says nothing when one is missing', async () => {
    expect((await add('u1', { ...TOM, annual_premium_minor: 50_400 })).json().check).toEqual({
      status: 'match',
    })
    const { annual_premium_minor: _a, ...noAnnual } = TOM
    expect((await add('u1', noAnnual)).json().check).toEqual({ status: 'not_enough' })
  })

  it('appends to an existing list instead of replacing it', async () => {
    profile = {
      tenant_id: TENANT,
      policies: [{ id: 'pol_old', type: 'home', provider: 'X' }],
      version: 3,
    }
    await add('u1', TOM)
    expect((profile['policies'] as unknown[]).length).toBe(2)
    expect(profile['version']).toBe(4)
  })

  it('refuses a child or someone outside the family, and writes nothing', async () => {
    for (const who of ['kid', 'stranger']) {
      const res = await add(who, TOM, ['viewer'])
      expect(res.statusCode).toBe(403)
    }
    expect(profile).toBeNull()
  })

  it('refuses nonsense: unknown type, blank provider, absurd amount, impossible date, unknown person, extra fields', async () => {
    for (const bad of [
      { ...TOM, type: 'car' },
      { ...TOM, provider: '   ' },
      { ...TOM, monthly_premium_minor: 1e15 },
      { ...TOM, monthly_premium_minor: -5 },
      { ...TOM, monthly_premium_minor: 42.5 },
      { ...TOM, renewal_date: '2027-02-30' },
      { ...TOM, extra: 'x' },
    ])
      expect((await add('u1', bad)).statusCode, JSON.stringify(bad)).toBe(400)
    expect((await add('u1', { ...TOM, covers_member_id: 'someone-else' })).statusCode).toBe(400)
    expect(profile).toBeNull()
  })

  it('the dry run answers without storing anything', async () => {
    const res = await appFor('u1').inject({
      method: 'POST',
      url: '/family/policies/check',
      payload: { monthly_premium_minor: 4200, annual_premium_minor: 50_000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().check.status).toBe('mismatch')
    expect(profile).toBeNull()
    const denied = await appFor('kid', ['viewer']).inject({
      method: 'POST',
      url: '/family/policies/check',
      payload: { monthly_premium_minor: 1, annual_premium_minor: 1 },
    })
    expect(denied.statusCode).toBe(403)
  })
})
