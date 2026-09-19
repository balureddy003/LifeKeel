/**
 * Signed notification links — GET/POST /a/:token and GET /why/:token.
 *
 * These URLs are minted by DeliveryRouter into every delivered
 * notification (approve_url/dismiss_url/why_url) but had no handlers —
 * one-tap actions from a notification 404'd. The HMAC token is the auth;
 * GET must never mutate (mail scanners and chat previews prefetch GET
 * links), so it renders a confirmation page and only the POST executes —
 * through the same approve/dismiss decisions as the authenticated routes.
 *
 * Runs against a real in-memory MongoDB: the exercises worth covering are
 * the token round-trip, the prefetch-safe GET contract, and the shared
 * decision path's state transitions — not HTTP plumbing.
 */

import { describe, expect, it, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerInsightRoutes } from '../insights.js'
import { DeliveryRouter } from '../../delivery/delivery-router.js'
import { closeDb } from '../../db.js'

const TENANT = 'tenant-links'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let router: DeliveryRouter

function insightDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'insight-link-1',
    tenant_id: TENANT,
    detector_id: 'family.protection-gap',
    rule_id: 'protection-gap.rule',
    hypothesis: 'Life cover gap on file',
    reasoning: 'The family profile shows dependants but no life cover.',
    category: 'risk',
    urgency: 'high',
    state: 'identified',
    confidence_breakdown: { combined_score: 0.82 },
    actions: [],
    created_at: new Date(),
    ...overrides,
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env['MONGODB_URL'] = mongod.getUri()
  process.env['MONGODB_DB'] = 'action_links_test'
  process.env['JWT_SECRET'] = 'test-secret-for-links'
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('action_links_test')

  router = new DeliveryRouter(db)
  // Signed tokens run ~180 chars — match server.ts's routerOptions or the
  // param parser 414s the whole feature.
  app = Fastify({ routerOptions: { maxParamLength: 512 } })
  await registerInsightRoutes(app, {} as never, undefined, db, undefined, router)
})

afterEach(async () => {
  for (const name of ['insights', 'action_receipts', 'tenant_settings', 'delivery_preferences', 'delivery_queue', 'delivery_receipts', 'tenants', 'verified_moments', 'agent_memory']) {
    await db.collection(name).deleteMany({})
  }
})

afterAll(async () => {
  await closeDb()
  await client.close()
  await mongod.stop()
})

describe('GET /a/:token (confirmation page — prefetch-safe)', () => {
  it('renders an approve confirmation without mutating the insight', async () => {
    await db.collection('insights').insertOne(insightDoc())
    const token = router.signActionToken('insight-link-1', TENANT, 'approve')

    const res = await app.inject({ method: 'GET', url: `/a/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('Life cover gap on file')
    expect(res.body).toContain('Approve')

    const doc = await db.collection('insights').findOne({ id: 'insight-link-1' })
    expect(doc?.['state']).toBe('identified') // GET must not act
  })

  it('renders a dismiss confirmation for dismiss tokens', async () => {
    await db.collection('insights').insertOne(insightDoc())
    const token = router.signActionToken('insight-link-1', TENANT, 'dismiss')

    const res = await app.inject({ method: 'GET', url: `/a/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Dismiss')
    expect((await db.collection('insights').findOne({ id: 'insight-link-1' }))?.['state']).toBe('identified')
  })

  it('rejects a forged or expired token', async () => {
    const res = await app.inject({ method: 'GET', url: '/a/not-a-real-token' })
    expect(res.statusCode).toBe(410)
  })
})

describe('POST /a/:token (executes the decision)', () => {
  it('approves the insight through the shared decision path', async () => {
    await db.collection('insights').insertOne(insightDoc())
    const token = router.signActionToken('insight-link-1', TENANT, 'approve')

    const res = await app.inject({ method: 'POST', url: `/a/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Approved')

    const doc = await db.collection('insights').findOne({ id: 'insight-link-1' })
    // No recommended actions → execution completes immediately.
    expect(doc?.['state']).toBe('completed')
    expect(doc?.['approved_by']).toBe('signed-link')

    const receipt = await db.collection('action_receipts').findOne({ insight_id: 'insight-link-1', action_type: 'insight.approve' })
    expect(receipt).not.toBeNull()
    expect(receipt?.['approved_by']).toBe('signed-link')
  })

  it('dismisses the insight through the shared decision path', async () => {
    await db.collection('insights').insertOne(insightDoc())
    const token = router.signActionToken('insight-link-1', TENANT, 'dismiss')

    const res = await app.inject({ method: 'POST', url: `/a/${token}` })
    expect(res.statusCode).toBe(200)

    const doc = await db.collection('insights').findOne({ id: 'insight-link-1' })
    expect(doc?.['state']).toBe('dismissed')
    expect(doc?.['dismissed_by']).toBe('signed-link')
  })

  it('honors the quota/credit gates the authenticated route applies', async () => {
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('tenants').insertOne({ tenant_id: TENANT, tier: 'pro', billing: { credits_balance: 0 } })
    const token = router.signActionToken('insight-link-1', TENANT, 'approve')

    const res = await app.inject({ method: 'POST', url: `/a/${token}` })
    expect(res.statusCode).toBe(402)
    expect((await db.collection('insights').findOne({ id: 'insight-link-1' }))?.['state']).toBe('identified')
  })

  it('returns an error page for a second POST on an already-actioned insight', async () => {
    await db.collection('insights').insertOne(insightDoc())
    const token = router.signActionToken('insight-link-1', TENANT, 'approve')
    await app.inject({ method: 'POST', url: `/a/${token}` })

    const res = await app.inject({ method: 'POST', url: `/a/${token}` })
    expect(res.statusCode).toBe(404)
    expect(res.body).toContain('identified state')
  })
})

describe('GET /why/:token (read-only evidence)', () => {
  it('renders the evidence page with reasoning and confidence', async () => {
    await db.collection('insights').insertOne(insightDoc())
    const token = router.signEvidenceToken('insight-link-1', TENANT)

    const res = await app.inject({ method: 'GET', url: `/why/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('Why Oak flagged this')
    expect(res.body).toContain('dependants but no life cover')
    expect(res.body).toContain('82%')
  })

  it('rejects a forged token', async () => {
    const res = await app.inject({ method: 'GET', url: '/why/forged' })
    expect(res.statusCode).toBe(410)
  })
})

describe('drainDeliveryQueue (escalation consumer)', () => {
  it('sends a queued escalation on its named channel and marks it sent', async () => {
    const smsSend = vi.fn(async () => ({ channel: 'sms' as const, success: true, delivered_at: new Date() }))
    ;(router as unknown as Record<string, unknown>)['sms'] = { send: smsSend }

    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('delivery_queue').insertOne({
      tenant_id: TENANT, insight_id: 'insight-link-1', channel: 'sms', target: '+15550009999',
      escalation: true, status: 'queued', created_at: new Date(),
    })

    const summary = await router.drainDeliveryQueue()
    expect(summary).toEqual({ sent: 1, failed: 0 })
    expect(smsSend).toHaveBeenCalledWith('+15550009999', expect.objectContaining({ insight_id: 'insight-link-1' }))
    expect((await db.collection('delivery_queue').findOne({}))?.['status']).toBe('sent')
    expect(await db.collection('delivery_receipts').countDocuments({ channel: 'sms', success: true })).toBe(1)
  })

  it('marks a row failed when its insight no longer exists', async () => {
    await db.collection('delivery_queue').insertOne({
      tenant_id: TENANT, insight_id: 'ghost', channel: 'sms', status: 'queued', created_at: new Date(),
    })
    const summary = await router.drainDeliveryQueue()
    expect(summary.failed).toBe(1)
    const row = await db.collection('delivery_queue').findOne({})
    expect(row?.['status']).toBe('failed')
    expect(row?.['error']).toBe('insight_not_found')
  })

  it('recovers a stale "sending" claim rather than losing the escalation', async () => {
    const smsSend = vi.fn(async () => ({ channel: 'sms' as const, success: true, delivered_at: new Date() }))
    ;(router as unknown as Record<string, unknown>)['sms'] = { send: smsSend }

    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('delivery_queue').insertOne({
      tenant_id: TENANT, insight_id: 'insight-link-1', channel: 'sms',
      escalation: true, status: 'sending',
      claimed_at: new Date(Date.now() - 20 * 60 * 1000), // 20m ago — past the 10m stale window
      created_at: new Date(),
    })

    const summary = await router.drainDeliveryQueue()
    expect(summary.sent).toBe(1)
    expect(smsSend).toHaveBeenCalledTimes(1)
  })
})
