/**
 * POST /inbox/:id/apply-policy — turns a policy Keel found in email (the
 * `policy` object on an email-backed feed item) into a real policies[]
 * entry, the same review-then-confirm shape as documents.ts's identically-
 * named endpoint. See that file's own test for the shared mechanics
 * (in-request detector regeneration gated on a complete stored profile);
 * this covers what's specific to an email-sourced item.
 */

import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { Engine, type Insight } from '@lifekeel/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFamilyInboxRoutes } from '../routes/family-inbox.js'

vi.mock('../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../detectors')

const TENANT = 'tenant-1'

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return ((cond as { $in: unknown[] }).$in).includes(doc[key])
    }
    return doc[key] === cond
  })
}

const BASE_PROFILE = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400000,
    annual_living_expenses_minor: 3600000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 10_000_000,
    income_protection_monthly_minor: 400000,
    members: [],
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
  education_funds: [],
  policies: [],
  tenant_id: TENANT,
  version: 3,
  updated_at: new Date(),
}

function makeDb(inboxSeed: Record<string, unknown>[] = [], profileSeed: Record<string, unknown> | null = null) {
  const inboxItems: Record<string, unknown>[] = [...inboxSeed]
  const profiles: Record<string, unknown>[] = profileSeed ? [{ ...profileSeed }] : []

  const inboxCol = {
    findOne: async (filter: Record<string, unknown>) =>
      inboxItems.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const doc = inboxItems.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      if (update.$set) Object.assign(doc, update.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    },
    find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
  }

  const profilesCol = {
    findOne: async () => profiles[0] ?? null,
    updateOne: async (
      _filter: Record<string, unknown>,
      update: { $push?: Record<string, unknown>; $set?: Record<string, unknown> },
      opts?: { upsert?: boolean },
    ) => {
      let doc = profiles[0]
      if (!doc) {
        if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 }
        doc = {}
        profiles.push(doc)
      }
      if (update.$push) {
        for (const [key, value] of Object.entries(update.$push)) {
          const arr = (doc[key] as unknown[]) ?? []
          arr.push(value)
          doc[key] = arr
        }
      }
      if (update.$set) Object.assign(doc, update.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    },
  }

  const insightDocs: Record<string, unknown>[] = []
  const insightsCol = {
    find: (filter: Record<string, unknown>) => ({
      sort: () => ({ limit: () => ({ toArray: async () => insightDocs.filter((d) => matchesFilter(d, filter)) }) }),
      toArray: async () => insightDocs.filter((d) => matchesFilter(d, filter)),
    }),
    updateMany: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      let modifiedCount = 0
      for (const doc of insightDocs) {
        if (matchesFilter(doc, filter)) {
          Object.assign(doc, update.$set)
          modifiedCount++
        }
      }
      return { modifiedCount }
    }),
  }

  const documentsCol = { find: () => ({ toArray: async () => [], sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }

  return {
    collection: (name: string) => {
      if (name === 'inbox_items') return inboxCol
      if (name === 'insights') return insightsCol
      if (name === 'documents') return documentsCol
      return profilesCol
    },
    _profiles: profiles,
    _inboxItems: inboxItems,
  } as any
}

async function buildApp(db: any, engine?: Engine) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1', roles: ['admin'] }
  })
  const insights: Insight[] = []
  registerFamilyInboxRoutes(app, db, engine, async (generated) => {
    insights.push(...generated)
  })
  return { app, insights }
}

async function applyPolicy(app: any, itemId: string, body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/inbox/${itemId}/apply-policy`,
    headers: { 'content-type': 'application/json' },
    payload: body,
  })
  return { status: res.statusCode, body: res.json() }
}

const EMAIL_ITEM = { id: 'item-1', tenant_id: TENANT, source: 'noreply@aviva.com', subject: 'Home renewed', ai_summary: 's', action_label: 'Review', action_type: 'review', priority: 'high', date: '2026-01-01', read: false, dismissed: false }

describe('POST /inbox/:id/apply-policy', () => {
  it('pushes a well-formed policy and dismisses the item it came from — no engine, no regeneration', async () => {
    const db = makeDb([{ ...EMAIL_ITEM }])
    const { app } = await buildApp(db)

    const { status, body } = await applyPolicy(app, 'item-1', {
      type: 'home', provider: 'Aviva', coverageAmountMinor: 30_000_000, monthlyPremiumMinor: 3500, policyNumber: '733885401', renewalDate: '2026-08-31',
    })

    expect(status).toBe(200)
    expect(body.applied).toEqual({
      type: 'home', provider: 'Aviva', coverage_amount_minor: 30_000_000, monthly_premium_minor: 3500,
      renewal_date: '2026-08-31', policy_number: '733885401',
    })
    expect(db._profiles[0].policies).toHaveLength(1)
    // The item that surfaced this suggestion stops nudging once acted on —
    // same treatment as an applied document's feed_dismissed.
    expect(db._inboxItems.find((i: any) => i.id === 'item-1').dismissed).toBe(true)
    expect(body.insights_generated).toBe(0)
  })

  it('accepts the new "travel" policy type — there was previously nowhere in the schema for a travel policy to live', async () => {
    const db = makeDb([{ ...EMAIL_ITEM, id: 'item-2' }])
    const { app } = await buildApp(db)
    const { status, body } = await applyPolicy(app, 'item-2', { type: 'travel', provider: 'HSBC/Aviva' })
    expect(status).toBe(200)
    expect(body.applied.type).toBe('travel')
  })

  it('404s for an unknown item, and 400s for a missing/invalid type or provider', async () => {
    const db = makeDb([{ ...EMAIL_ITEM }])
    const { app } = await buildApp(db)
    expect((await applyPolicy(app, 'nope', { type: 'home', provider: 'Aviva' })).status).toBe(404)
    expect((await applyPolicy(app, 'item-1', { type: 'spaceship', provider: 'Aviva' })).status).toBe(400)
    expect((await applyPolicy(app, 'item-1', { type: 'home', provider: '  ' })).status).toBe(400)
  })

  it('regenerates insights in-request off a complete profile, mirroring the document-apply flow', async () => {
    const engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
    const profile = {
      ...BASE_PROFILE,
      policies: [{ type: 'car', provider: 'Admiral', coverage_amount_minor: 0, monthly_premium_minor: 8500, renewal_date: daysFromNow(20) }],
    }
    const db = makeDb([{ ...EMAIL_ITEM }], profile)
    const { app, insights } = await buildApp(db, engine)

    const { status, body } = await applyPolicy(app, 'item-1', { type: 'home', provider: 'Aviva', renewalDate: daysFromNow(45) })

    expect(status).toBe(200)
    expect(body.insights_generated).toBeGreaterThan(0)
    expect(insights.map((i) => i.rule_id)).toContain('policy_renewal_window')
  })
})
