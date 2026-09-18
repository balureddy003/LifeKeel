/**
 * POST /documents/:id/apply-policy — the endpoint that closes the passive
 * policy-intake gap: turns an OCR'd insurance document's (reviewed,
 * possibly user-edited) fields into a real policies[] entry, instead of
 * requiring the user to retype provider/coverage/renewal-date by hand in
 * the Financial Profile wizard. See ocr/profile-mapping.ts's
 * mapExtractedFieldsToPolicySuggestion for how the suggestion itself is
 * built; this test covers the endpoint that actually persists it.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { registerDocumentRoutes } from '../routes/documents.js'

function makeDb(documentsSeed: Record<string, unknown>[] = []) {
  const documents: Record<string, unknown>[] = [...documentsSeed]
  const profiles: Record<string, unknown>[] = []

  const documentsCol = {
    findOne: async (filter: Record<string, unknown>) =>
      documents.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
  }

  // Minimal single-document-per-tenant fake — good enough for this route,
  // which never queries by anything but the implicit tenant scope ({}).
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
        doc = { policies: [] }
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

  return {
    collection: (name: string) => (name === 'documents' ? documentsCol : profilesCol),
    _profiles: profiles,
  } as any
}

async function buildApp(db: any) {
  const app = Fastify()
  await app.register(multipart)
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: request.headers['x-test-tenant'], user_id: 'user-1' }
  })
  registerDocumentRoutes(app, db)
  return app
}

async function applyPolicy(app: any, tenantId: string, documentId: string, body: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: `/documents/${documentId}/apply-policy`,
    headers: { 'x-test-tenant': tenantId, 'content-type': 'application/json' },
    payload: body,
  })
  return { status: res.statusCode, body: res.json() }
}

async function getSuggestions(app: any, tenantId: string, documentId: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/documents/${documentId}/profile-suggestions`,
    headers: { 'x-test-tenant': tenantId },
  })
  return { status: res.statusCode, body: res.json() }
}

describe('POST /documents/:id/apply-policy', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb([{ id: 'doc-1', filename: 'aviva-life.pdf', category: 'insurance', tenant_id: 'family-1' }])
  })

  it('pushes a well-formed policy into a fresh (upserted) financial profile', async () => {
    const app = await buildApp(db)
    const { status, body } = await applyPolicy(app, 'family-1', 'doc-1', {
      type: 'life',
      provider: 'Legal & General',
      coverageAmountMinor: 25_000_000,
      monthlyPremiumMinor: 2450,
      renewalDate: '2027-03-01',
      policyNumber: 'LG-99182734',
    })

    expect(status).toBe(200)
    expect(body.applied).toEqual({
      type: 'life',
      provider: 'Legal & General',
      coverage_amount_minor: 25_000_000,
      monthly_premium_minor: 2450,
      renewal_date: '2027-03-01',
      policy_number: 'LG-99182734',
    })
    expect(db._profiles[0].policies).toHaveLength(1)
    expect(db._profiles[0].policies[0].provider).toBe('Legal & General')
  })

  it('appends to an existing profile without clobbering other policies', async () => {
    db._profiles.push({ policies: [{ type: 'car', provider: 'Admiral', coverage_amount_minor: 0, monthly_premium_minor: 8500 }] })
    const app = await buildApp(db)

    const { status } = await applyPolicy(app, 'family-1', 'doc-1', {
      type: 'life',
      provider: 'Aviva',
      coverageAmountMinor: 10_000_000,
      monthlyPremiumMinor: 1200,
    })

    expect(status).toBe(200)
    expect(db._profiles[0].policies).toHaveLength(2)
    expect(db._profiles[0].policies.map((p: any) => p.provider).sort()).toEqual(['Admiral', 'Aviva'])
  })

  it('omits renewal_date and policy_number entirely when not provided, rather than storing empty strings', async () => {
    const app = await buildApp(db)
    await applyPolicy(app, 'family-1', 'doc-1', {
      type: 'home',
      provider: 'Direct Line',
      coverageAmountMinor: 0,
      monthlyPremiumMinor: 1500,
    })

    const stored = db._profiles[0].policies[0]
    expect('renewal_date' in stored).toBe(false)
    expect('policy_number' in stored).toBe(false)
  })

  it('rejects a missing or invalid policy type', async () => {
    const app = await buildApp(db)
    const missing = await applyPolicy(app, 'family-1', 'doc-1', { provider: 'Aviva' })
    expect(missing.status).toBe(400)

    const invalid = await applyPolicy(app, 'family-1', 'doc-1', { type: 'pet', provider: 'Aviva' })
    expect(invalid.status).toBe(400)
  })

  it('rejects a missing provider', async () => {
    const app = await buildApp(db)
    const { status, body } = await applyPolicy(app, 'family-1', 'doc-1', { type: 'life', provider: '   ' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/provider/i)
  })

  it('404s for a document that does not exist for this tenant', async () => {
    const app = await buildApp(db)
    const { status } = await applyPolicy(app, 'family-1', 'doc-missing', { type: 'life', provider: 'Aviva' })
    expect(status).toBe(404)
  })
})

describe('GET /documents/:id/profile-suggestions', () => {
  it('includes a policySuggestion for an insurance document with a provider', async () => {
    const db = makeDb([
      {
        id: 'doc-2',
        filename: 'aviva-life.pdf',
        category: 'insurance',
        tenant_id: 'family-1',
        extracted_data: { provider: 'Aviva', policy_type: 'life', premium: '24.50' },
      },
    ])
    const app = await buildApp(db)
    const { status, body } = await getSuggestions(app, 'family-1', 'doc-2')

    expect(status).toBe(200)
    expect(body.policySuggestion).toMatchObject({ type: 'life', provider: 'Aviva', monthlyPremiumMinor: 2450 })
  })

  it('returns null policySuggestion for a non-insurance document', async () => {
    const db = makeDb([{ id: 'doc-3', filename: 'pension.pdf', category: 'pension', tenant_id: 'family-1', extracted_data: { provider: 'Aviva' } }])
    const app = await buildApp(db)
    const { body } = await getSuggestions(app, 'family-1', 'doc-3')
    expect(body.policySuggestion).toBeNull()
  })
})
