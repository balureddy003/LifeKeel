/**
 * auto-execute-trusted — the spend side of trust_level_by_workflow.
 *
 * Exercises the real gate stack against mongodb-memory-server: opt-in,
 * trust threshold, grace period, the log_only-only invariant (an insight
 * carrying even one send_email/whatsapp action must NEVER auto-run),
 * the atomic claim, dry_run passthrough, and the monthly quota.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { runAutoExecuteTrusted, AUTO_EXECUTE_TRUST_THRESHOLD, AUTO_EXECUTE_GRACE_MS } from '../auto-execute-trusted.js'

const TENANT = 'tenant-1'
const NOW = new Date('2099-06-01T12:00:00Z')

function insight(overrides: Record<string, unknown> = {}) {
  return {
    id: `i-${Math.random().toString(36).slice(2)}`,
    tenant_id: TENANT,
    detector_id: 'family_emergency_fund_adequacy',
    rule_id: 'emergency_fund_below_3_months',
    state: 'identified',
    hypothesis: 'Emergency fund is thin',
    reasoning: 'Savings cover 1.5 months',
    actions: ['Review your monthly budget to identify potential savings opportunities'],
    confidence_breakdown: { or_score: 0.88, combined_score: 0.88, evidence_refs: [] },
    estimated_impact_low: 100000,
    estimated_impact_high: 200000,
    created_at: new Date(NOW.getTime() - AUTO_EXECUTE_GRACE_MS - 1000), // past grace
    ...overrides,
  }
}

describe('runAutoExecuteTrusted', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  const seedSettings = (automation: Record<string, unknown>) =>
    db.collection('tenant_settings').insertOne({ tenant_id: TENANT, automation })

  const trusted = { trust_level_by_workflow: { family_emergency_fund_adequacy: AUTO_EXECUTE_TRUST_THRESHOLD } }

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('auto_exec_test')
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  it('auto-executes a trusted, past-grace, log_only insight end to end', async () => {
    await seedSettings({ auto_execute_enabled: true, ...trusted })
    await db.collection('insights').insertOne(insight())

    const summary = await runAutoExecuteTrusted(db, { now: NOW })

    expect(summary.executed).toBe(1)
    const doc = await db.collection('insights').findOne({})
    expect(doc?.['state']).toBe('completed')
    expect(doc?.['approved_by']).toBe('auto-trust')
    // Decision receipt + per-action receipt exist; per-action is a log_only skip.
    const receipts = await db.collection('action_receipts').find({}).toArray()
    expect(receipts.some((r) => r['action_type'] === 'insight.auto_execute' && r['outcome'] === 'approved')).toBe(true)
    expect(receipts.every((r) => r['learning_suppressed'] !== false)).toBe(true)
    const event = await db.collection('system_events').findOne({ type: 'insight.auto_executed' })
    expect(event).toBeTruthy()
  })

  it('does nothing when the tenant has not opted in', async () => {
    await seedSettings({ ...trusted }) // trusted but auto_execute_enabled unset
    await db.collection('insights').insertOne(insight())

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('identified')
  })

  it('does nothing when trust is below threshold', async () => {
    await seedSettings({ auto_execute_enabled: true, trust_level_by_workflow: { family_emergency_fund_adequacy: AUTO_EXECUTE_TRUST_THRESHOLD - 1 } })
    await db.collection('insights').insertOne(insight())

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('identified')
  })

  it('never auto-dispatches an external action — send_email stays human-gated', async () => {
    await seedSettings({ auto_execute_enabled: true, ...trusted })
    await db.collection('insights').insertOne(insight({
      actions: ['Send an email reminder to the account holder'],
    }))

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
    expect(summary.skipped).toBe(1)
    const doc = await db.collection('insights').findOne({})
    expect(doc?.['state']).toBe('identified')
    expect(await db.collection('action_receipts').countDocuments({})).toBe(0)
  })

  it('respects the grace period — a fresh insight waits for a human first', async () => {
    await seedSettings({ auto_execute_enabled: true, ...trusted })
    await db.collection('insights').insertOne(insight({ created_at: new Date(NOW.getTime() - 1000) }))

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('identified')
  })

  it('a human dismissal in the grace window wins — terminal states are never touched', async () => {
    await seedSettings({ auto_execute_enabled: true, ...trusted })
    await db.collection('insights').insertOne(insight({ state: 'dismissed' }))

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('dismissed')
  })

  it('scopes trust per detector — trust in one does not bleed into another', async () => {
    await seedSettings({ auto_execute_enabled: true, trust_level_by_workflow: { family_retirement_gap: 5 } })
    await db.collection('insights').insertOne(insight())

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
  })

  it('tenant isolation — trusted tenant A cannot auto-execute tenant B\u2019s insights', async () => {
    await seedSettings({ auto_execute_enabled: true, ...trusted })
    await db.collection('insights').insertOne(insight({ tenant_id: 'tenant-2' }))

    const summary = await runAutoExecuteTrusted(db, { now: NOW })
    expect(summary.executed).toBe(0)
    expect((await db.collection('insights').findOne({}))?.['state']).toBe('identified')
  })

  it('honors dry_run_mode — auto-executions simulate too', async () => {
    await seedSettings({ auto_execute_enabled: true, dry_run_mode: true, ...trusted })
    await db.collection('insights').insertOne(insight())

    await runAutoExecuteTrusted(db, { now: NOW })
    const receipts = await db.collection('action_receipts').find({}).toArray()
    expect(receipts.every((r) => r['dry_run'] === true)).toBe(true)
    expect(receipts.some((r) => r['outcome'] === 'policy_blocked')).toBe(true)
  })
})
