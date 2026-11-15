/**
 * GET /family/resilience — the income-stops runway range for the household (intent 94, Tier 0, read-only).
 * Adults in the family see it (A5); every other caller gets a 403 and no figures.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyResilienceRoutes } from '../family-resilience.js'

const TENANT = 't-resilience'
let profile: Record<string, unknown> | null
let family: Record<string, unknown> | null

const col = (store: Record<string, unknown>[]) => ({
  findOne: async () => store[0] ?? null,
})
const makeDb = () =>
  ({
    collection: (name: string) =>
      name === 'family_financial_profile'
        ? col(profile ? [profile] : [])
        : name === 'family_groups'
          ? col(family ? [family] : [])
          : col([]),
  }) as never

async function appFor(user_id: string) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = {
      tenant_id: TENANT,
      user_id,
      roles: ['member'],
    }
  })
  registerFamilyResilienceRoutes(app, makeDb())
  return app
}

const fullProfile = (over: Record<string, unknown> = {}) => ({
  tenant_id: TENANT,
  household: {
    monthly_salary_minor: 300_000,
    income_protection_monthly_minor: 0,
    ...over,
  },
  emergency_fund: { emergency_savings_minor: 900_000, monthly_expenses_minor: 300_000 },
})

beforeEach(() => {
  profile = fullProfile()
  family = {
    tenant_id: TENANT,
    members: [
      { id: 'u1', name: 'Alex', role: 'organizer', status: 'active' },
      { id: 'u2', name: 'Sam', role: 'adult', status: 'active' },
      { id: 'kid', name: 'Kit', role: 'child', status: 'active' },
      { id: 'p', name: 'Pat', role: 'adult', status: 'pending' },
    ],
  }
})

describe('GET /family/resilience', () => {
  it('shows an adult the estimate: 3 months from savings alone, always labelled an estimate', async () => {
    const res = await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ready')
    expect(body.range).toEqual({ lowMonths: 3, highMonths: 3 })
    expect(body.text).toMatch(/estimate/)
    expect(body.left_out).toContain('tax and benefits')
    expect(body.next_checks.at(-1)).toBe(
      'Ask a licensed professional what applies to your household',
    )
  })

  it('counts income protection on file against the spend', async () => {
    profile = fullProfile({ income_protection_monthly_minor: 150_000 })
    const body = (
      await (await appFor('u2')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.range.lowMonths).toBe(6)
  })

  it('reports open ended cover as null, never the internal sentinel', async () => {
    profile = fullProfile({ income_protection_monthly_minor: 300_000 })
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.range).toEqual({ lowMonths: null, highMonths: null })
    expect(JSON.stringify(body)).not.toContain('9999')
  })

  it.each([['kid'], ['p'], ['stranger']])('refuses %s with a 403 and no figures', async (who) => {
    const res = await (await appFor(who)).inject({ method: 'GET', url: '/family/resilience' })
    expect(res.statusCode).toBe(403)
    expect(res.body).not.toMatch(/\d{4,}/)
  })

  it('lists what is missing instead of guessing', async () => {
    profile = { tenant_id: TENANT, household: {}, emergency_fund: {} }
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.status).toBe('needs_figures')
    expect(body.missing).toEqual(['savings', 'monthly spend', 'monthly income'])
    expect(body.range).toBeUndefined()
  })

  it('answers needs_figures when there is no profile at all', async () => {
    profile = null
    const body = (
      await (await appFor('u1')).inject({ method: 'GET', url: '/family/resilience' })
    ).json()
    expect(body.status).toBe('needs_figures')
  })
})
