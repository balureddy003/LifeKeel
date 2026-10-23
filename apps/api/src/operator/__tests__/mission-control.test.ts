import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MAX_DECISIONS, SUPPORT_SLA_HOURS, buildDecisions } from '../mission-control.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('mission-control-test')
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

async function seedEverything() {
  await db.collection('autopilot_actions').insertMany([
    {
      id: 'p1',
      rule: 'propose_blog_promo',
      dedup_key: 'k1',
      target_type: 'blog_post',
      target_id: 't:s',
      reason: 'Blog never promoted',
      status: 'proposed',
      proposal: {
        kind: 'marketing.blog_draft',
        required_permission: 'marketing.manage',
        summary: 'Draft a post',
        payload: {},
      },
      created_at: hoursAgo(5),
    },
    {
      id: 'p2',
      rule: 'propose_suspend_brute_force',
      dedup_key: 'k2',
      target_type: 'user',
      target_id: 'u9',
      reason: 'Credential stuffing',
      status: 'proposed',
      proposal: {
        kind: 'user.suspend',
        required_permission: 'users.manage',
        summary: 'Suspend u9',
        payload: {},
      },
      created_at: hoursAgo(3),
    },
    // A shadow row and a resolved one must never appear.
    {
      id: 's1',
      rule: 'r',
      dedup_key: 'shadow:x',
      target_type: 'u',
      target_id: 'u',
      reason: 'r',
      status: 'shadow',
      created_at: hoursAgo(1),
    },
    {
      id: 'e1',
      rule: 'r',
      dedup_key: 'k3',
      target_type: 'u',
      target_id: 'u',
      reason: 'r',
      status: 'executed',
      created_at: hoursAgo(1),
    },
  ])
  await db.collection('operator_alerts').insertMany([
    {
      dedup_key: 'dead_letters',
      title: '3 dead-lettered jobs',
      severity: 'danger',
      status: 'open',
      updated_at: hoursAgo(2),
    },
    {
      dedup_key: 'snoozed_ended',
      title: 'Snooze ended',
      severity: 'warning',
      status: 'snoozed',
      snoozed_until: hoursAgo(1),
      updated_at: hoursAgo(25),
    },
    {
      dedup_key: 'still_snoozed',
      title: 'Still snoozed',
      severity: 'warning',
      status: 'snoozed',
      snoozed_until: new Date(Date.now() + 3_600_000),
    },
    { dedup_key: 'acked', title: 'Acked', severity: 'warning', status: 'ack' },
  ])
  await db.collection('support_cases').insertMany([
    {
      id: 'c-old',
      status: 'open',
      subject: 'Cannot upload',
      updated_at: hoursAgo(SUPPORT_SLA_HOURS + 6),
      messages: [{ text: 'SECRET BODY TEXT' }],
    },
    { id: 'c-new', status: 'open', subject: 'Fresh', updated_at: hoursAgo(1) },
    { id: 'c-answered', status: 'answered', subject: 'Answered', updated_at: hoursAgo(100) },
  ])
  await db.collection('marketing_posts').insertMany([
    {
      id: 'm1',
      state: 'draft',
      channel: 'bluesky',
      generated: 'llm',
      created_at: hoursAgo(4),
      content: 'SECRET POST BODY',
    },
    { id: 'm2', state: 'publish_failed', channel: 'x', created_at: hoursAgo(2) },
    { id: 'm3', state: 'published', channel: 'x', created_at: hoursAgo(2) },
  ])
  await db.collection('campaigns').insertMany([
    { id: 'k1', name: 'Welcome', status: 'draft', created_at: hoursAgo(9) },
    { id: 'k2', name: 'Sent', status: 'sent', created_at: hoursAgo(9) },
  ])
  await db.collection('operator_dual_approvals').insertMany([
    {
      id: 'd1',
      action: 'operator.campaign.send',
      required_permission: 'marketing.manage',
      reason: 'send it',
      requested_by: 'someone-else',
      status: 'pending',
      created_at: hoursAgo(1),
      expires_at: new Date(Date.now() + 600_000),
    },
    {
      id: 'd2',
      action: 'operator.campaign.send',
      required_permission: 'marketing.manage',
      reason: 'mine',
      requested_by: 'me',
      status: 'pending',
      created_at: hoursAgo(1),
      expires_at: new Date(Date.now() + 600_000),
    },
    {
      id: 'd3',
      action: 'operator.campaign.send',
      required_permission: 'marketing.manage',
      reason: 'expired',
      requested_by: 'someone-else',
      status: 'pending',
      created_at: hoursAgo(1),
      expires_at: new Date(Date.now() - 1000),
    },
  ])
}

describe('buildDecisions', () => {
  it('returns every open decision kind for a super_admin and nothing resolved or shadowed', async () => {
    await seedEverything()
    const ds = await buildDecisions(db, { user_id: 'me', roles: ['super_admin'] })
    const ids = ds.map((d) => d.id).sort()
    expect(ids).toEqual(
      [
        'alert:dead_letters',
        'alert:snoozed_ended',
        'campaign_draft:k1',
        'dual_approval:d1', // not my own request, not expired
        'post_draft:m1',
        'post_failed:m2',
        'proposal:p1',
        'proposal:p2',
        'support_case:c-old',
      ].sort(),
    )
  })

  it('ranks danger before warning before info, oldest first within a tier', async () => {
    await seedEverything()
    const ds = await buildDecisions(db, { user_id: 'me', roles: ['super_admin'] })
    const rank = { danger: 0, warning: 1, info: 2 }
    for (let i = 1; i < ds.length; i++) {
      const a = ds[i - 1]!
      const b = ds[i]!
      expect(rank[a.severity]).toBeLessThanOrEqual(rank[b.severity])
      if (a.severity === b.severity) expect(a.created_at <= b.created_at).toBe(true)
    }
    expect(ds[0]!.severity).toBe('danger')
  })

  it('only shows a role the decisions it may act on', async () => {
    await seedEverything()
    const support = await buildDecisions(db, { user_id: 'me', roles: ['support'] })
    const kinds = new Set(support.map((d) => d.kind))
    expect(kinds).toEqual(new Set(['alert', 'support_case']))
    expect(support.find((d) => d.id === 'proposal:p2')).toBeUndefined() // needs users.manage

    const marketing = await buildDecisions(db, { user_id: 'me', roles: ['marketing_operator'] })
    expect(marketing.map((d) => d.id)).toEqual(
      expect.arrayContaining(['proposal:p1', 'post_draft:m1', 'campaign_draft:k1']),
    )
    expect(marketing.find((d) => d.kind === 'support_case')).toBeUndefined()
    expect(marketing.find((d) => d.id === 'proposal:p2')).toBeUndefined()
  })

  it('marks only proposals and alerts as batchable', async () => {
    await seedEverything()
    const ds = await buildDecisions(db, { user_id: 'me', roles: ['super_admin'] })
    for (const d of ds) {
      expect(d.batchable).toBe(d.kind === 'proposal' || d.kind === 'alert')
    }
  })

  it('never leaks message or post bodies', async () => {
    await seedEverything()
    const json = JSON.stringify(await buildDecisions(db, { user_id: 'me', roles: ['super_admin'] }))
    expect(json).not.toContain('SECRET BODY TEXT')
    expect(json).not.toContain('SECRET POST BODY')
  })

  it('caps the list', async () => {
    await db.collection('marketing_posts').insertMany(
      Array.from({ length: MAX_DECISIONS + 20 }, (_, i) => ({
        id: `x${i}`,
        state: 'publish_failed',
        channel: 'x',
        created_at: new Date(),
      })),
    )
    const ds = await buildDecisions(db, { user_id: 'me', roles: ['super_admin'] })
    expect(ds.length).toBeLessThanOrEqual(MAX_DECISIONS)
  })
})
