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

describe('social decisions', () => {
  // Thursday 22 Oct 2026, so next week is the Monday 26th.
  const THU = new Date('2026-10-22T10:00:00Z')
  const WED = new Date('2026-10-21T10:00:00Z')
  const admin = { user_id: 'me', roles: ['super_admin'] as never }

  const plannedPost = (over: Record<string, unknown> = {}) => ({
    tenant_id: 't1',
    state: 'draft',
    content_item_id: 'ci-1',
    channel: 'bluesky',
    scheduled_at: new Date('2026-10-26T09:00:00Z'),
    created_at: new Date('2026-10-21T08:00:00Z'),
    copy_check: { ok: true, violations: [] },
    ...over,
  })
  const oauth = (connector_id: string, over: Record<string, unknown> = {}) => ({
    tenant_id: 't1',
    connector_id,
    needs_reauth: false,
    ...over,
  })

  it('groups a whole week of plan drafts into one decision, not one card per post', async () => {
    await db.collection('marketing_posts').insertMany([
      plannedPost({ channel: 'bluesky' }),
      plannedPost({ channel: 'x' }),
      plannedPost({ channel: 'linkedin', scheduled_at: new Date('2026-10-28T09:00:00Z') }),
      plannedPost({ channel: 'x', scheduled_at: new Date('2026-11-02T09:00:00Z') }), // the week after
    ])
    const ds = await buildDecisions(db, admin, THU)
    const weeks = ds.filter((d) => d.kind === 'plan_week')
    expect(weeks.map((d) => d.id).sort()).toEqual(['plan_week:2026-10-26', 'plan_week:2026-11-02'])
    const w = weeks.find((d) => d.id === 'plan_week:2026-10-26')!
    expect(w.title).toBe('Review and approve the week of 2026-10-26: 3 posts across 3 platforms')
    expect(w.batchable).toBe(false)
    expect(w.required_permission).toBe('marketing.manage')
    expect(w.effect).toMatch(/cannot be unsent/)
    expect(ds.filter((d) => d.kind === 'post_draft')).toEqual([]) // no per-post flood
  })

  it('says what blocks approval: copy-guard failures and Instagram posts with no image', async () => {
    await db
      .collection('marketing_posts')
      .insertMany([
        plannedPost(),
        plannedPost({ channel: 'x', copy_check: { ok: false, violations: [{ rule: 'x' }] } }),
        plannedPost({ channel: 'instagram' }),
        plannedPost({ channel: 'instagram', media_url: 'https://cdn.example.com/a.png' }),
      ])
    const w = (await buildDecisions(db, admin, THU)).find((d) => d.kind === 'plan_week')!
    expect(w.why).toMatch(/1 fail the copy guard/)
    expect(w.why).toMatch(/1 Instagram post needs an image/)
    expect(w.why).toMatch(/fix before approving/)
  })

  it('stays quiet for approved, past and non-plan posts', async () => {
    await db.collection('marketing_posts').insertMany([
      plannedPost({ state: 'approved' }),
      plannedPost({ scheduled_at: new Date('2026-10-20T09:00:00Z') }), // already past
      { tenant_id: 't1', state: 'draft', channel: 'x', created_at: THU }, // one-off draft, not a plan post
    ])
    const ds = await buildDecisions(db, admin, THU)
    expect(ds.find((d) => d.kind === 'plan_week')).toBeUndefined()
    expect(ds.filter((d) => d.kind === 'post_draft')).toHaveLength(1) // the one-off keeps its own card
  })

  it('flags a missing plan from Thursday, and says why', async () => {
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    expect(
      (await buildDecisions(db, admin, WED)).find((d) => d.kind === 'plan_missing'),
    ).toBeUndefined()
    const off = (await buildDecisions(db, admin, THU)).find((d) => d.kind === 'plan_missing')!
    expect(off.id).toBe('plan_missing:2026-10-26')
    expect(off.why).toMatch(/switched off/)
    await db
      .collection('tenant_settings')
      .insertOne({ tenant_id: 't1', automation: { daily_marketing_drafts_enabled: true } })
    expect(
      (await buildDecisions(db, admin, THU)).find((d) => d.kind === 'plan_missing')!.why,
    ).toMatch(/nothing was drafted/)
  })

  it('does not flag a missing plan when it exists, or when no platform is connected', async () => {
    expect(
      (await buildDecisions(db, admin, THU)).find((d) => d.kind === 'plan_missing'),
    ).toBeUndefined() // nothing connected
    await db.collection('connector_credentials').insertOne(oauth('twitter_x'))
    await db
      .collection('content_items')
      .insertOne({ tenant_id: 't1', week_key: '2026-10-26', slot: 0 })
    expect(
      (await buildDecisions(db, admin, THU)).find((d) => d.kind === 'plan_missing'),
    ).toBeUndefined()
  })

  it('raises a decision for a connection that needs reconnecting or is about to die', async () => {
    await db.collection('connector_credentials').insertMany([
      oauth('twitter_x', { needs_reauth: true }),
      oauth('linkedin', { token_expires_at: new Date(THU.getTime() + 3 * 86_400_000) }),
      oauth('threads'), // healthy: no decision
    ])
    const ds = (await buildDecisions(db, admin, THU)).filter((d) => d.kind === 'channel_attention')
    expect(ds.map((d) => d.id).sort()).toEqual([
      'channel_attention:t1:linkedin',
      'channel_attention:t1:x',
    ])
    const x = ds.find((d) => d.id.endsWith(':x'))!
    expect(x).toMatchObject({ severity: 'danger', title: 'X needs reconnecting' })
    const li = ds.find((d) => d.id.endsWith(':linkedin'))!
    expect(li).toMatchObject({
      severity: 'warning',
      title: 'LinkedIn connection expires in 3 days',
    })
    expect(ds.every((d) => !d.batchable)).toBe(true)
  })

  it('does not nag about a channel that also has a healthy connection', async () => {
    await db.collection('social_connections').insertMany([
      { tenant_id: 't1', channel: 'bluesky', status: 'error', last_error: 'old', handle: 'a' },
      { tenant_id: 't1', channel: 'bluesky', status: 'active', handle: 'b' },
    ])
    expect(
      (await buildDecisions(db, admin, THU)).filter((d) => d.kind === 'channel_attention'),
    ).toEqual([])
  })

  it('shows social decisions only to roles that can manage marketing, and never batches them', async () => {
    await db.collection('marketing_posts').insertOne(plannedPost())
    await db
      .collection('connector_credentials')
      .insertOne(oauth('twitter_x', { needs_reauth: true }))
    const support = await buildDecisions(db, { user_id: 'me', roles: ['support'] as never }, THU)
    expect(
      support.filter((d) => ['plan_week', 'plan_missing', 'channel_attention'].includes(d.kind)),
    ).toEqual([])
    const marketing = await buildDecisions(
      db,
      { user_id: 'me', roles: ['marketing_operator'] as never },
      THU,
    )
    const kinds = new Set(marketing.map((d) => d.kind))
    expect(kinds.has('plan_week')).toBe(true)
    expect(kinds.has('channel_attention')).toBe(true)
    for (const d of marketing.filter((d) =>
      ['plan_week', 'plan_missing', 'channel_attention'].includes(d.kind),
    ))
      expect(d.batchable).toBe(false)
  })
})
