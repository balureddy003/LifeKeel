/**
 * /family/learning: opt-in to share a coarse, anonymous band across households (intent 96, gated off).
 * Every adult must opt in, any adult can withdraw, and withdrawing deletes the household's contribution.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyLearningRoutes } from '../family-learning.js'
import { learningGate } from '../../learning/gate.js'

const TENANT = 't-learn'
type Doc = Record<string, unknown>
let profile: Doc | null
let family: Doc | null
let consent: Doc[]
let contributions: Doc[]

const matches = (d: Doc, f: Doc) => Object.entries(f).every(([k, v]) => d[k] === v)
const col = (store: Doc[]) => ({
  createIndex: async () => '',
  findOne: async (f: Doc) => store.find((d) => matches(d, f)) ?? null,
  find: (f: Doc = {}) => ({ toArray: async () => store.filter((d) => matches(d, f)) }),
  replaceOne: async (f: Doc, doc: Doc) => {
    const i = store.findIndex((d) => matches(d, f))
    if (i >= 0) store[i] = doc
    else store.push(doc)
    return {}
  },
  deleteOne: async (f: Doc) => {
    const i = store.findIndex((d) => matches(d, f))
    if (i >= 0) store.splice(i, 1)
    return {}
  },
  deleteMany: async (f: Doc) => {
    for (let i = store.length - 1; i >= 0; i--) if (matches(store[i]!, f)) store.splice(i, 1)
    return {}
  },
})
const db = () =>
  ({
    collection: (n: string) =>
      n === 'family_financial_profile'
        ? col(profile ? [profile] : [])
        : n === 'family_groups'
          ? col(family ? [family] : [])
          : n === 'learning_consent'
            ? col(consent)
            : n === 'learning_contributions'
              ? col(contributions)
              : col([]),
  }) as never

const OPEN = learningGate({
  LIFEKEEL_CROSS_TENANT_LEARNING: 'true',
  LEARNING_PRIVACY_REVIEW_REF: 'PRIV-1',
})
function appFor(user_id: string, gate = OPEN, minCohort = 2) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = {
      tenant_id: TENANT,
      user_id,
      roles: ['member'],
    }
  })
  registerFamilyLearningRoutes(app, db(), { gate, minCohort })
  return app
}
const get = (u: string, url = '/family/learning', gate = OPEN) =>
  appFor(u, gate).inject({ method: 'GET', url })
const put = (u: string, optIn: boolean) =>
  appFor(u).inject({ method: 'PUT', url: '/family/learning', payload: { optIn } })

beforeEach(() => {
  consent = []
  contributions = []
  profile = {
    tenant_id: TENANT,
    household: { monthly_salary_minor: 300_000, income_protection_monthly_minor: 0 },
    emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
  }
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'u2', name: 'Sam', role: 'adult', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
    ],
  }
})

describe('when the gate is closed', () => {
  it('the routes are not there and nothing is stored', async () => {
    const closed = learningGate({})
    expect((await get('u1', '/family/learning', closed)).statusCode).toBe(404)
    const res = await appFor('u1', closed).inject({
      method: 'PUT',
      url: '/family/learning',
      payload: { optIn: true },
    })
    expect(res.statusCode).toBe(404)
    expect(consent).toEqual([])
  })
})

describe('consent', () => {
  it('starts with nobody opted in', async () => {
    expect((await get('u1')).json()).toMatchObject({
      optedIn: false,
      adultsOptedIn: 0,
      adultsTotal: 2,
      contributing: false,
    })
  })

  it('refuses a child, reading and writing', async () => {
    expect((await get('kid')).statusCode).toBe(403)
    expect((await put('kid', true)).statusCode).toBe(403)
    expect(consent).toEqual([])
  })

  it('does not contribute until every adult has opted in', async () => {
    const r1 = await put('u1', true)
    expect(r1.statusCode).toBe(200)
    expect(contributions).toEqual([])
    expect((await get('u1')).json()).toMatchObject({ optedIn: true, contributing: false })
    await put('u2', true)
    expect(contributions).toHaveLength(1)
    expect((await get('u2')).json().contributing).toBe(true)
  })

  it('stores only a band: no figures, no names, no ids beyond the household key', async () => {
    await put('u1', true)
    await put('u2', true)
    const c = contributions[0]!
    expect(Object.keys(c).sort()).toEqual(['band', 'recorded_at', 'tenant_id'])
    expect(c['band']).toBe('3-6')
  })

  it('any one adult withdrawing deletes the household contribution at once', async () => {
    await put('u1', true)
    await put('u2', true)
    await put('u2', false)
    expect(contributions).toEqual([])
    expect((await get('u1')).json().contributing).toBe(false)
    expect(consent.some((c) => c['member_id'] === 'u2')).toBe(false)
  })

  it('will not contribute when the household figures are missing', async () => {
    profile = null
    await put('u1', true)
    const res = await put('u2', true)
    expect(res.statusCode).toBe(400)
    expect(contributions).toEqual([])
  })
})

describe('benchmark', () => {
  it('is for contributing households only', async () => {
    expect((await get('u1', '/family/learning/benchmark')).statusCode).toBe(403)
  })

  it('shows nothing until the cohort is big enough, then counts only', async () => {
    await put('u1', true)
    await put('u2', true)
    const small = (await get('u1', '/family/learning/benchmark')).json()
    expect(small).toEqual({ available: false })
    // Other households contribute (minCohort is 2 in this test).
    for (let i = 0; i < 9; i++)
      contributions.push({ tenant_id: `other-${i}`, band: '3-6', recorded_at: new Date() })
    const big = (await get('u1', '/family/learning/benchmark')).json()
    expect(big).toEqual({
      available: true,
      total: 10,
      bands: { '0-3': null, '3-6': 10, '6-12': null, '12+': null },
    })
    expect(JSON.stringify(big)).not.toMatch(/other-/)
  })
})
