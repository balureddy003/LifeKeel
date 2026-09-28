/**
 * /family/cashflow (PRD-131) — declared recurring income/expense ledger
 * with a monthly run-rate + runway summary.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyCashflowRoutes } from '../family-cashflow.js'

const TENANT = 't-cashflow'

let entries: Record<string, unknown>[]
let profile: Record<string, unknown> | null

function match(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => doc[k] === v)
}

function col(store: Record<string, unknown>[]) {
  return {
    find: (filter: Record<string, unknown> = {}) => ({ toArray: async () => store.filter((d) => match(d, filter)) }),
    findOne: async (filter: Record<string, unknown> = {}) => store.find((d) => match(d, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => { store.push(doc); return { insertedId: doc['id'] } },
    deleteOne: async (filter: Record<string, unknown>) => {
      const idx = store.findIndex((d) => match(d, filter))
      if (idx >= 0) store.splice(idx, 1)
      return { deletedCount: idx >= 0 ? 1 : 0 }
    },
    createIndex: async () => ({}),
  }
}

function makeDb() {
  return {
    collection: (name: string) =>
      name === 'family_cashflow_entries' ? col(entries) : name === 'family_financial_profile' ? col(profile ? [profile] : []) : col([]),
  } as never
}

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as { authContext?: unknown }).authContext = { tenant_id: TENANT, user_id: 'u1' }
  })
  registerFamilyCashflowRoutes(app, makeDb())
  return app
}

beforeEach(() => {
  entries = []
  profile = { tenant_id: TENANT, emergency_fund: { emergency_savings_minor: 900_000 } }
})

describe('POST /family/cashflow/entries', () => {
  it('validates and stores an entry', async () => {
    const app = await buildApp()
    const bad = await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'income', amount_minor: -5 } })
    expect(bad.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST', url: '/family/cashflow/entries',
      payload: { kind: 'expense', label: 'Childcare', amount_minor: 80_000, recurrence: 'monthly' },
    })
    expect(ok.statusCode).toBe(200)
    expect(entries).toHaveLength(1)
    expect(ok.json().entry.monthly_minor).toBe(80_000)
    await app.close()
  })
})

describe('GET /family/cashflow', () => {
  it('computes the monthly run-rate across recurrences and a runway against emergency savings', async () => {
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'income', label: 'Salary', amount_minor: 400_000, recurrence: 'monthly' } })
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'expense', label: 'Rent', amount_minor: 200_000, recurrence: 'monthly' } })
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'expense', label: 'Weekly shop', amount_minor: 12_000, recurrence: 'weekly' } }) // → 52,000/mo
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'expense', label: 'Annual insurance', amount_minor: 120_000, recurrence: 'yearly' } }) // → 10,000/mo
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'expense', label: 'One-off repair', amount_minor: 50_000, recurrence: 'once' } }) // not in run-rate

    const res = await app.inject({ method: 'GET', url: '/family/cashflow' })
    const body = res.json()
    expect(body.summary.monthly_inflow_minor).toBe(400_000)
    expect(body.summary.monthly_outflow_minor).toBe(200_000 + 52_000 + 10_000)
    expect(body.summary.net_minor).toBe(400_000 - 262_000)
    expect(body.summary.runway_months).toBeNull() // surplus — no runway problem

    // Entries report their own monthly equivalent; 'once' is zero.
    const once = body.entries.find((e: { label: string }) => e.label === 'One-off repair')
    expect(once.monthly_minor).toBe(0)
    await app.close()
  })

  it('computes runway months when the household burns more than it earns', async () => {
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'income', label: 'Salary', amount_minor: 100_000, recurrence: 'monthly' } })
    await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'expense', label: 'Rent', amount_minor: 200_000, recurrence: 'monthly' } })
    const body = (await app.inject({ method: 'GET', url: '/family/cashflow' })).json()
    // Burn 100k/mo against £9k savings → 9.0 months.
    expect(body.summary.net_minor).toBe(-100_000)
    expect(body.summary.runway_months).toBe(9)
    await app.close()
  })

  it('delete removes an entry and 404s on a stranger id', async () => {
    const app = await buildApp()
    const created = (await app.inject({ method: 'POST', url: '/family/cashflow/entries', payload: { kind: 'expense', label: 'Gym', amount_minor: 5_000 } })).json().entry
    const res = await app.inject({ method: 'DELETE', url: `/family/cashflow/entries/${created.id}` })
    expect(res.statusCode).toBe(200)
    expect(entries).toHaveLength(0)
    const missing = await app.inject({ method: 'DELETE', url: '/family/cashflow/entries/nope' })
    expect(missing.statusCode).toBe(404)
    await app.close()
  })
})
