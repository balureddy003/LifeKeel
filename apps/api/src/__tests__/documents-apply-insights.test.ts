/**
 * Remediation item 17 (doc → insight flow): POST /documents/:id/apply-policy
 * and POST /documents/:id/apply-to-profile now re-run the detector pass
 * in-request against the mutated profile, returning `insights_generated`.
 * Previously an apply persisted the change but surfaced nothing until the
 * user separately re-submitted the Financial Profile wizard — the OCR'd
 * policy sat inert while the renewal window it represented went unflagged.
 *
 * Regeneration is gated on the stored document parsing as a complete
 * FinancialProfile, so an upsert-created skeleton (a couple of OCR fields,
 * no wizard submission yet) still generates nothing — first-time profile
 * creation stays in the wizard.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { Engine, type Insight } from '@lifekeel/engine'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerDocumentRoutes } from '../routes/documents.js'

vi.mock('../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../detectors')

const TENANT = 'tenant-1'

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

// Mongo-filter matcher just capable enough for what resolveStaleInsights
// actually sends (equality + $in) — same minimal fake the
// family-financial-profile tests use.
function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in (cond as Record<string, unknown>)) {
      return (cond as { $in: unknown[] }).$in.includes(doc[key])
    }
    return doc[key] === cond
  })
}

// A complete, wizard-submittable profile — mirrors BASE_PROFILE in
// family-financial-profile.test.ts.
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

function makeDb(
  documentsSeed: Record<string, unknown>[] = [],
  profileSeed: Record<string, unknown> | null = null,
) {
  const documents: Record<string, unknown>[] = [...documentsSeed]
  const profiles: Record<string, unknown>[] = profileSeed ? [{ ...profileSeed }] : []

  const documentsCol = {
    findOne: async (filter: Record<string, unknown>) =>
      documents.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
    // PRD-121: the estate eval inside regenerateInsights reads vault doc
    // types via find(...).toArray() — direct cursor, no sort chain.
    find: (filter: Record<string, unknown>) => ({
      toArray: async () => documents.filter((d) => matchesFilter(d, filter)),
    }),
    updateOne: async (
      filter: Record<string, unknown>,
      update: { $set?: Record<string, unknown> },
    ) => {
      const doc = documents.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
      if (!doc) return { matchedCount: 0, modifiedCount: 0 }
      if (update.$set) Object.assign(doc, update.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    },
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

  return {
    collection: (name: string) => {
      if (name === 'documents') return documentsCol
      if (name === 'insights') return insightsCol
      if (name === 'extraction_candidates') return { findOne: async () => null }
      if (name === 'profile_provenance') return { replaceOne: async () => ({ matchedCount: 0 }) }
      return profilesCol
    },
    _profiles: profiles,
    _insightDocs: insightDocs,
    _documents: documents,
  } as any
}

async function buildApp(db: any, engine: Engine) {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  const insights: Insight[] = []
  registerDocumentRoutes(app, db, engine, async (generated) => {
    insights.push(...generated)
  })
  return { app, insights }
}

async function applyPolicy(app: any, documentId: string, body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/documents/${documentId}/apply-policy`,
    headers: { 'content-type': 'application/json' },
    payload: body,
  })
  return { status: res.statusCode, body: res.json() }
}

async function applyToProfile(app: any, documentId: string, body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: `/documents/${documentId}/apply-to-profile`,
    headers: { 'content-type': 'application/json' },
    payload: body,
  })
  return { status: res.statusCode, body: res.json() }
}

describe('POST /documents/:id/apply-policy — in-request insight regeneration', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('fires the renewal-window insight when the applied policy renews within 60 days', async () => {
    const db = makeDb(
      [{ id: 'doc-1', filename: 'aviva.pdf', category: 'insurance', tenant_id: TENANT }],
      { ...BASE_PROFILE },
    )
    const { app, insights } = await buildApp(db, engine)

    const { status, body } = await applyPolicy(app, 'doc-1', {
      type: 'life',
      provider: 'Aviva',
      coverageAmountMinor: 10_000_000,
      monthlyPremiumMinor: 2450,
      renewalDate: daysFromNow(30),
    })

    expect(status).toBe(200)
    expect(body.insights_generated).toBeGreaterThan(0)
    expect(insights.map((i) => i.rule_id)).toContain('policy_renewal_window')
    expect(db._documents.find((d: any) => d.id === 'doc-1').feed_dismissed).toBe(true)
  })

  it('generates nothing when the apply creates only a skeleton profile (no wizard submission yet)', async () => {
    const db = makeDb([
      { id: 'doc-1', filename: 'aviva.pdf', category: 'insurance', tenant_id: TENANT },
    ])
    const { app, insights } = await buildApp(db, engine)

    const { status, body } = await applyPolicy(app, 'doc-1', {
      type: 'life',
      provider: 'Aviva',
      coverageAmountMinor: 10_000_000,
      monthlyPremiumMinor: 2450,
      renewalDate: daysFromNow(30),
    })

    // The apply itself still succeeds — the policy lands for the wizard to
    // pick up later — but a two-field skeleton isn't a submittable profile,
    // so no detector pass runs against it.
    expect(status).toBe(200)
    expect(db._profiles[0].policies).toHaveLength(1)
    expect(body.insights_generated).toBe(0)
    expect(insights).toHaveLength(0)
  })
})

describe('POST /documents/:id/apply-to-profile — in-request insight regeneration', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
    await engine.load()
  })

  it('regenerates insights off the mutated complete profile', async () => {
    // A policy renewing inside the window is already on the profile — the
    // scalar apply is what re-triggers the pass that flags it.
    const profile = {
      ...BASE_PROFILE,
      policies: [
        {
          type: 'car',
          provider: 'Admiral',
          coverage_amount_minor: 0,
          monthly_premium_minor: 8500,
          renewal_date: daysFromNow(20),
        },
      ],
    }
    const db = makeDb(
      [
        {
          id: 'doc-2',
          filename: 'statement.pdf',
          category: 'pension',
          tenant_id: TENANT,
          extracted_data: { fund_value: '62000.00' },
        },
      ],
      profile,
    )
    const { app, insights } = await buildApp(db, engine)

    const { status, body } = await applyToProfile(app, 'doc-2')

    expect(status).toBe(200)
    expect(body.applied).toHaveLength(1)
    expect(body.insights_generated).toBeGreaterThan(0)
    expect(insights.map((i) => i.rule_id)).toContain('policy_renewal_window')
    expect(db._documents.find((d: any) => d.id === 'doc-2').feed_dismissed).toBe(true)
  })

  it('generates nothing when no complete profile exists yet', async () => {
    const db = makeDb([
      {
        id: 'doc-3',
        filename: 'statement.pdf',
        category: 'pension',
        tenant_id: TENANT,
        extracted_data: { fund_value: '62000.00' },
      },
    ])
    const { app, insights } = await buildApp(db, engine)

    const { status, body } = await applyToProfile(app, 'doc-3')

    expect(status).toBe(200)
    expect(body.insights_generated).toBe(0)
    expect(insights).toHaveLength(0)
  })
})
