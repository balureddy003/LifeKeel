/**
 * /family/businesses: adults enter the businesses a member runs and the income each pays the household
 * (intent 96). The server runs "if this business stops" through the same engine. Adults only, Tier 0.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyBusinessesRoutes } from '../family-businesses.js'

const TENANT = 't-biz'
let profile: Record<string, unknown> | null
let family: Record<string, unknown> | null
let graphDocs: Record<string, unknown>[]

const col = (store: Record<string, unknown>[]) => ({
  findOne: async (f: Record<string, unknown>) =>
    store.find((d) => d['tenant_id'] === f['tenant_id']) ?? null,
  replaceOne: async (f: Record<string, unknown>, doc: Record<string, unknown>) => {
    const i = store.findIndex((d) => d['tenant_id'] === f['tenant_id'])
    if (i >= 0) store[i] = doc
    else store.push(doc)
    return {}
  },
})
const db = () =>
  ({
    collection: (name: string) =>
      name === 'family_financial_profile'
        ? col(profile ? [profile] : [])
        : name === 'family_groups'
          ? col(family ? [family] : [])
          : name === 'business_graph'
            ? col(graphDocs)
            : col([]),
  }) as never

function appFor(user_id: string) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = {
      tenant_id: TENANT,
      user_id,
      roles: ['member'],
    }
  })
  registerFamilyBusinessesRoutes(app, db())
  return app
}
const get = async (u: string) => appFor(u).inject({ method: 'GET', url: '/family/businesses' })
const put = async (u: string, payload: object) =>
  appFor(u).inject({ method: 'PUT', url: '/family/businesses', payload })

const good = {
  businesses: [{ id: 'b1', name: 'Plumbing Ltd' }],
  incomeEdges: [{ businessId: 'b1', memberId: 'u1', monthlyMinor: 100_000 }],
}

beforeEach(() => {
  graphDocs = []
  profile = {
    tenant_id: TENANT,
    household: { monthly_salary_minor: 300_000, income_protection_monthly_minor: 0 },
    emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
  }
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
    ],
  }
})

describe('/family/businesses', () => {
  it('starts empty for an adult', async () => {
    const res = await get('u1')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ businesses: [], incomeEdges: [], shocks: [] })
  })

  it('refuses a child, for reading and for writing, and stores nothing', async () => {
    expect((await get('kid')).statusCode).toBe(403)
    expect((await put('kid', good)).statusCode).toBe(403)
    expect(graphDocs).toHaveLength(0)
  })

  it('saves a graph and then shows what happens if that business stops', async () => {
    expect((await put('u1', good)).statusCode).toBe(200)
    const body = (await get('u1')).json()
    expect(body.businesses).toEqual(good.businesses)
    expect(body.shocks).toHaveLength(1)
    expect(body.shocks[0]).toMatchObject({ businessId: 'b1', name: 'Plumbing Ltd' })
    expect(body.shocks[0].text).toMatch(/estimate/)
    expect(body.shocks[0].range.lowMonths).toBe(9)
  })

  it('lists no shock when the household figures are missing', async () => {
    profile = null
    await put('u1', good)
    expect((await get('u1')).json().shocks).toEqual([])
  })

  it('rejects an invalid graph and keeps the old one', async () => {
    await put('u1', good)
    const bad = {
      ...good,
      incomeEdges: [{ businessId: 'zzz', memberId: 'u1', monthlyMinor: 5 }],
    }
    const res = await put('u1', bad)
    expect(res.statusCode).toBe(400)
    expect((await get('u1')).json().businesses).toEqual(good.businesses)
  })

  it('rejects income paid to someone who is not an adult in the family', async () => {
    const res = await put('u1', {
      ...good,
      incomeEdges: [{ businessId: 'b1', memberId: 'kid', monthlyMinor: 100_000 }],
    })
    expect(res.statusCode).toBe(400)
  })
})
