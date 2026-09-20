/**
 * Trajectory-level invariants — the composed path a family signal travels:
 *
 *   profile event → Engine.evaluate (real detector YAMLs)
 *                 → persistAndDeliverInsights (entity-aware dedup)
 *                 → resolveStaleInsights (per-entity resolution)
 *                 → runAutoExecuteTrusted (earned-trust spend)
 *
 * Each component has its own unit tests; this file asserts the *joint*
 * behavior no single-component test can see: two children's education
 * funds stay distinct end to end, a fixed fund resolves only its own
 * insight, and earned trust plus opt-in turns a repeated, human-approved
 * insight class into automatic completion — while an insight carrying a
 * real external action stays human-gated no matter how much trust exists.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { Engine, type Insight } from '@agentoak/engine'
import { persistAndDeliverInsights, resolveStaleInsights } from '../insights-persist.js'
import { runAutoExecuteTrusted, AUTO_EXECUTE_TRUST_THRESHOLD, AUTO_EXECUTE_GRACE_MS } from '../jobs/auto-execute-trusted.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const TENANT = 'tenant-1'
const CHECKED_EDUCATION_RULES = ['education_fund_behind_target', 'education_fund_not_started']

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let engine: Engine

async function evaluateChild(fund: Record<string, unknown>) {
  const result = await engine.evaluate({
    event_type: 'family.education_fund',
    tenant_id: TENANT,
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    data: fund,
  })
  return result.insights.filter((i) => i.detector_id === 'family_education_shortfall')
}

const firedPairs = (insights: Insight[]) =>
  insights.map((i) => ({ rule_id: i.rule_id, entity_key: i.entity_key ?? '' }))

describe('autonomy trajectory: two children, one detector', () => {
  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('trajectory_test')
    engine = new Engine({ detectorsDir: path.join(ROOT, 'detectors'), strictValidation: false })
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  it('keeps per-child insights distinct through persist, dedup, and entity-aware resolution', async () => {
    const aishaBehind = {
      child_name: 'Aisha', child_age: 14, member_id: 'member-a',
      current_savings_minor: 100000, target_savings_minor: 2000000, years_remaining: 4,
    }
    const meeraBehind = { ...aishaBehind, child_name: 'Meera', member_id: 'member-b' }

    // Cycle 1: both children behind → two insights with distinct entity keys.
    const batch1 = [...await evaluateChild(aishaBehind), ...await evaluateChild(meeraBehind)]
    expect(batch1).toHaveLength(2)
    expect(new Set(batch1.map((i) => i.entity_key)).size).toBe(2)
    await persistAndDeliverInsights(db, batch1, TENANT)
    expect(await db.collection('insights').countDocuments({})).toBe(2)

    // Cycle 2: Aisha's fund recovered — only her insight resolves.
    const aishaFixed = { ...aishaBehind, current_savings_minor: 1600000 }
    const batch2 = [...await evaluateChild(aishaFixed), ...await evaluateChild(meeraBehind)]
    expect(batch2).toHaveLength(1)
    await persistAndDeliverInsights(db, batch2, TENANT)
    await resolveStaleInsights(db, TENANT, 'family_education_shortfall', CHECKED_EDUCATION_RULES, firedPairs(batch2))

    const open = await db.collection('insights').find({ state: 'identified' }).toArray()
    const resolved = await db.collection('insights').find({ state: 'resolved' }).toArray()
    expect(open).toHaveLength(1)
    expect(open[0]?.['entity_key']).toBe('member-b')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.['entity_key']).toBe('member-a')
  })

  it('earned trust + opt-in completes a repeated log_only insight; an external action never auto-runs', async () => {
    await db.collection('tenant_settings').insertOne({
      tenant_id: TENANT,
      automation: {
        auto_execute_enabled: true,
        trust_level_by_workflow: { family_education_shortfall: AUTO_EXECUTE_TRUST_THRESHOLD },
      },
    })

    // Simulate the insight being open past the notification grace window.
    const insights = await evaluateChild({
      child_name: 'Rohan', child_age: 8,
      current_savings_minor: 0, target_savings_minor: 1500000, years_remaining: 10,
    })
    expect(insights.length).toBeGreaterThan(0)
    await persistAndDeliverInsights(db, insights, TENANT)
    await db.collection('insights').updateMany(
      {},
      { $set: { created_at: new Date(Date.now() - AUTO_EXECUTE_GRACE_MS - 1000) } },
    )

    const summary = await runAutoExecuteTrusted(db)
    expect(summary.executed).toBe(1)
    const doc = await db.collection('insights').findOne({})
    expect(doc?.['state']).toBe('completed')
    expect(doc?.['approved_by']).toBe('auto-trust')

    // Same trust, same opt-in — but an insight whose actions include a
    // real send must stay open for a human forever.
    await db.collection('insights').insertOne({
      ...(insights[0] as unknown as Record<string, unknown>),
      id: 'external-action-insight',
      state: 'identified',
      actions: ['Send an email reminder about the education fund'],
      created_at: new Date(Date.now() - AUTO_EXECUTE_GRACE_MS - 1000),
    })
    const second = await runAutoExecuteTrusted(db)
    expect(second.executed).toBe(0)
    expect((await db.collection('insights').findOne({ id: 'external-action-insight' }))?.['state']).toBe('identified')
  })
})
