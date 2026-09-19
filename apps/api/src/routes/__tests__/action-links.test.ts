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
import { MoveJudge, type JudgeScores } from '@agentoak/engine'
import { registerInsightRoutes } from '../insights.js'
import { DeliveryRouter } from '../../delivery/delivery-router.js'
import { closeDb } from '../../db.js'

const TENANT = 'tenant-links'

const PASS: JudgeScores = { coherence: 5, groundedness: 5, actionability: 5, proportionality: 5, safety: 5, feedback: '' }
const REWRITE: JudgeScores = { coherence: 2, groundedness: 2, actionability: 2, proportionality: 5, safety: 5, feedback: 'weak' }
const BLOCK: JudgeScores = { coherence: 5, groundedness: 5, actionability: 5, proportionality: 5, safety: 4, feedback: 'unsafe' }

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let router: DeliveryRouter
let judgeScores: JudgeScores = PASS
const judgeEvaluator = vi.fn(async () => judgeScores)

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

  router = new DeliveryRouter(db, new MoveJudge(judgeEvaluator))
  // Signed tokens run ~180 chars — match server.ts's routerOptions or the
  // param parser 414s the whole feature.
  app = Fastify({ routerOptions: { maxParamLength: 512 } })
  app.addHook('onRequest', async (request) => {
    ;(request as never as Record<string, unknown>)['authContext'] = { tenant_id: TENANT, user_id: 'user-1' }
  })
  await registerInsightRoutes(app, {} as never, undefined, db, undefined, router)
})

afterEach(async () => {
  judgeScores = PASS
  judgeEvaluator.mockClear()
  for (const name of ['insights', 'action_receipts', 'tenant_settings', 'delivery_preferences', 'delivery_queue', 'delivery_receipts', 'tenants', 'verified_moments', 'agent_memory', 'move_rewrite_queue', 'manual_review_queue', 'move_judge_verdicts', 'family_groups', 'audit_log']) {
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

function stubSms() {
  const smsSend = vi.fn(async () => ({ channel: 'sms' as const, success: true, delivered_at: new Date() }))
  ;(router as unknown as Record<string, unknown>)['sms'] = { send: smsSend }
  return smsSend
}

function queuedReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT,
    insight_id: 'insight-link-1',
    detector_id: 'family.protection-gap',
    verdict: { decision: 'rewrite', judge_skipped: false, evaluated_at: new Date() },
    status: 'pending',
    attempts: 1,
    retry_at: new Date(Date.now() - 60_000), // already due
    created_at: new Date(),
    ...overrides,
  }
}

describe('drainReviewQueues (judge review-queue consumer)', () => {
  it('re-pends a due rewrite row with backoff when the judge still blocks it', async () => {
    judgeScores = REWRITE
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const summary = await router.drainReviewQueues()
    expect(summary.retried).toBe(1)

    const row = await db.collection('move_rewrite_queue').findOne({})
    expect(row?.['status']).toBe('pending')
    expect(row?.['attempts']).toBe(2)
    expect((row?.['retry_at'] as Date).getTime()).toBeGreaterThan(Date.now())
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('identified')
  })

  it('delivers and resolves the row when the judge now passes', async () => {
    const smsSend = stubSms()
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const summary = await router.drainReviewQueues()
    expect(summary.released).toBe(1)
    expect(smsSend).toHaveBeenCalledTimes(1)

    const row = await db.collection('move_rewrite_queue').findOne({})
    expect(row?.['status']).toBe('resolved')
    expect(row?.['resolved_reason']).toBe('delivered')
    const insight = await db.collection('insights').findOne({})
    expect(insight?.['state']).toBe('sent')
    expect(insight?.['delivered_at']).toBeInstanceOf(Date)
  })

  it('marks the row exhausted at the attempt cap instead of retrying forever', async () => {
    judgeScores = REWRITE
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow({ attempts: 5 }))

    await router.drainReviewQueues()
    const row = await db.collection('move_rewrite_queue').findOne({})
    expect(row?.['status']).toBe('exhausted')
    expect(row?.['attempts']).toBe(6)
  })

  it('supersedes the old row when the verdict flips queues', async () => {
    judgeScores = BLOCK // pending rewrite row, but the fresh verdict is block
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    await router.drainReviewQueues()
    const old = await db.collection('move_rewrite_queue').findOne({})
    expect(old?.['status']).toBe('resolved')
    expect(old?.['resolved_reason']).toBe('superseded')
    const next = await db.collection('manual_review_queue').findOne({})
    expect(next?.['status']).toBe('pending')
    expect((next?.['verdict'] as Record<string, unknown>)?.['decision']).toBe('block')
  })

  it('resolves rows whose insight is already terminal without calling the judge', async () => {
    judgeScores = REWRITE
    await db.collection('insights').insertOne(insightDoc({ state: 'dismissed' }))
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const summary = await router.drainReviewQueues()
    expect(summary.resolved).toBe(1)
    expect(judgeEvaluator).not.toHaveBeenCalled()
    expect((await db.collection('move_rewrite_queue').findOne({}))?.['resolved_reason']).toBe('already_terminal')
  })

  it('resolves rows whose insight no longer exists', async () => {
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())
    const summary = await router.drainReviewQueues()
    expect(summary.resolved).toBe(1)
    expect((await db.collection('move_rewrite_queue').findOne({}))?.['resolved_reason']).toBe('insight_not_found')
  })

  it('recovers a stale "evaluating" claim', async () => {
    const smsSend = stubSms()
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow({
      status: 'evaluating',
      claimed_at: new Date(Date.now() - 20 * 60_000),
    }))

    const summary = await router.drainReviewQueues()
    expect(summary.released).toBe(1)
    expect(smsSend).toHaveBeenCalledTimes(1)
  })

  it('reschedules rather than resolving when delivery never reached the judge', async () => {
    // No delivery_preferences — deliver() returns before passesMoveJudge runs.
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const summary = await router.drainReviewQueues()
    expect(summary.retried).toBe(1)
    expect(judgeEvaluator).not.toHaveBeenCalled()

    const row = await db.collection('move_rewrite_queue').findOne({})
    expect(row?.['status']).toBe('pending')
    expect((row?.['retry_at'] as Date).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('review-queue routes (human surface for held insights)', () => {
  async function makeOrganizer() {
    await db.collection('family_groups').insertOne({
      tenant_id: TENANT,
      members: [{ id: 'user-1', role: 'organizer', status: 'active', name: 'Org', email: 'o@x.test', joined_at: new Date() }],
    })
  }

  it('lists held items with their verdicts and insight content', async () => {
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const res = await app.inject({ method: 'GET', url: '/insights/review' })
    expect(res.statusCode).toBe(200)
    const { items } = res.json() as { items: Array<Record<string, unknown>> }
    expect(items).toHaveLength(1)
    expect(items[0]?.['queue']).toBe('move_rewrite_queue')
    expect((items[0]?.['insight'] as Record<string, unknown>)?.['hypothesis']).toBe('Life cover gap on file')
  })

  it('releases a held insight despite an active block verdict', async () => {
    judgeScores = BLOCK
    const smsSend = stubSms()
    await makeOrganizer()
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('delivery_preferences').insertOne({ tenant_id: TENANT, enabled: true, channels: ['sms'], sms_to: '+15550001111' })
    await db.collection('manual_review_queue').insertOne(queuedReviewRow({
      verdict: { decision: 'block', judge_skipped: false, evaluated_at: new Date() },
      retry_at: undefined,
      re_evaluate_at: new Date(Date.now() - 60_000),
    }))

    const res = await app.inject({ method: 'POST', url: '/insights/insight-link-1/review-release' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ released: true, delivered: true })
    // skipJudge: the block verdict would have stopped a normal deliver.
    expect(judgeEvaluator).not.toHaveBeenCalled()
    expect(smsSend).toHaveBeenCalledTimes(1)

    const row = await db.collection('manual_review_queue').findOne({})
    expect(row?.['status']).toBe('resolved')
    expect(row?.['resolved_reason']).toBe('released')
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('sent')
  })

  it('rejects release from a non-organizer family member', async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: TENANT,
      members: [{ id: 'user-1', role: 'member', status: 'active', name: 'M', email: 'm@x.test', joined_at: new Date() }],
    })
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const res = await app.inject({ method: 'POST', url: '/insights/insight-link-1/review-release' })
    expect(res.statusCode).toBe(403)
    expect((await db.collection('move_rewrite_queue').findOne({}))?.['status']).toBe('pending')
  })

  it('returns 404 when nothing is held for the insight', async () => {
    await makeOrganizer()
    await db.collection('insights').insertOne(insightDoc())
    const res = await app.inject({ method: 'POST', url: '/insights/insight-link-1/review-release' })
    expect(res.statusCode).toBe(404)
  })

  it('discards the held item and dismisses the insight through the shared path', async () => {
    await makeOrganizer()
    await db.collection('insights').insertOne(insightDoc())
    await db.collection('move_rewrite_queue').insertOne(queuedReviewRow())

    const res = await app.inject({ method: 'POST', url: '/insights/insight-link-1/review-discard', payload: { reason: 'agree with judge' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ discarded: true, insight_dismissed: true })

    const row = await db.collection('move_rewrite_queue').findOne({})
    expect(row?.['resolved_reason']).toBe('discarded')
    const insight = await db.collection('insights').findOne({})
    expect(insight?.['state']).toBe('dismissed')
    expect(insight?.['dismissed_by']).toBe('user-1')
    expect(await db.collection('action_receipts').countDocuments({ action_type: 'insight.dismiss' })).toBe(1)
  })
})
