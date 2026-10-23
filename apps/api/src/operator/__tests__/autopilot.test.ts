import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  AUTOPILOT_RULES,
  NEVER_AUTONOMOUS,
  PROPOSAL_HANDLERS,
  ensureAutopilotIndexes,
  listAutopilotRules,
  meetsPromotion,
  reviewShadowRow,
  runAutopilotSweep,
  shadowStats,
} from '../autopilot.js'
import { invalidatePlatformConfigCache } from '../platform-config.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('autopilot-test')
  ensureAutopilotIndexes(db)
})

beforeEach(async () => {
  invalidatePlatformConfigCache()
  for (const name of await db.listCollections().toArray()) {
    await db.collection(name.name).deleteMany({})
  }
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

async function enableRule(rule: string, over: Record<string, unknown> = {}) {
  await db
    .collection('autopilot_rules')
    .updateOne({ rule }, { $set: { rule, enabled: true, ...over } }, { upsert: true })
}

describe('autopilot rules', () => {
  it('lists every registry rule disabled by default', async () => {
    const rules = await listAutopilotRules(db)
    expect(rules).toHaveLength(AUTOPILOT_RULES.length)
    expect(rules.every((r) => r.enabled === false)).toBe(true)
    expect(rules.every((r) => r.max_blast_radius > 0 && r.cooldown_minutes > 0)).toBe(true)
  })

  it('never exposes irreversible action families as automatable rules', () => {
    const ids = new Set(AUTOPILOT_RULES.map((r) => r.id))
    for (const family of NEVER_AUTONOMOUS) {
      // The never-list is families (dot-namespaced), rules are snake ids —
      // assert no rule id collides with a never-autonomous family name.
      expect(ids.has(family)).toBe(false)
    }
    expect(NEVER_AUTONOMOUS.length).toBeGreaterThanOrEqual(10)
  })
})

describe('runAutopilotSweep', () => {
  it('does nothing when every rule is off', async () => {
    await db.collection('users').insertOne({ id: 'u1', locked_until: new Date(Date.now() - 1000) })
    const executed = await runAutopilotSweep(db)
    expect(executed).toHaveLength(0)
    expect((await db.collection('users').findOne({ id: 'u1' }))!['locked_until']).toBeTruthy()
  })

  it('clears an expired lockout once, ledgered and audited, then never again for that lock', async () => {
    await enableRule('auto_unlock_expired')
    const lockedUntil = new Date(Date.now() - 60_000)
    await db.collection('users').insertOne({
      id: 'u1',
      failed_login_attempts: 7,
      locked_until: lockedUntil,
      status: 'active',
    })

    const first = await runAutopilotSweep(db)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      rule: 'auto_unlock_expired',
      target_id: 'u1',
      status: 'executed',
    })
    const user = await db.collection('users').findOne({ id: 'u1' })
    expect(user!['locked_until']).toBeUndefined()
    expect(user!['failed_login_attempts']).toBe(0)

    // Cooldown blocks an immediate re-run…
    expect(await runAutopilotSweep(db)).toHaveLength(0)

    // …and even after cooldown, the dedup key stops the same lock
    // being re-acted-on. A NEW lock gets a new dedup key and is handled.
    await db
      .collection('autopilot_rules')
      .updateOne(
        { rule: 'auto_unlock_expired' },
        { $set: { cooldown_minutes: 5, last_run_at: new Date(0) } },
      )
    expect(await runAutopilotSweep(db)).toHaveLength(0)
    await db
      .collection('users')
      .updateOne(
        { id: 'u1' },
        { $set: { failed_login_attempts: 5, locked_until: new Date(Date.now() - 30_000) } },
      )
    // The empty sweep above still stamped last_run_at — reset again.
    await db
      .collection('autopilot_rules')
      .updateOne({ rule: 'auto_unlock_expired' }, { $set: { last_run_at: new Date(0) } })
    const second = await runAutopilotSweep(db)
    expect(second).toHaveLength(1)

    const audit = await db
      .collection('operator_audit_log')
      .find({ action: 'autopilot.action' })
      .toArray()
    expect(audit).toHaveLength(2)
    expect(audit[0]!['operator_user_id']).toBe('autopilot')
  })

  it('leaves an unexpired lockout untouched', async () => {
    await enableRule('auto_unlock_expired')
    await db
      .collection('users')
      .insertOne({ id: 'u1', locked_until: new Date(Date.now() + 60_000) })
    expect(await runAutopilotSweep(db)).toHaveLength(0)
  })

  it('reschedules a failed reminder exactly once', async () => {
    await enableRule('auto_retry_failed_reminders', { cooldown_minutes: 5 })
    await db
      .collection('reminders')
      .insertOne({ id: 'r1', status: 'failed', attempts: 5, last_error: 'smtp down' })

    await runAutopilotSweep(db)
    const reminder = await db.collection('reminders').findOne({ id: 'r1' })
    expect(reminder!['status']).toBe('scheduled')
    expect(reminder!['attempts']).toBe(0)
    expect(reminder!['last_error']).toBeUndefined()

    // Re-fail it — autopilot already spent its one attempt on this reminder.
    await db
      .collection('reminders')
      .updateOne({ id: 'r1' }, { $set: { status: 'failed', attempts: 5 } })
    await db
      .collection('autopilot_rules')
      .updateOne({ rule: 'auto_retry_failed_reminders' }, { $set: { last_run_at: new Date(0) } })
    await runAutopilotSweep(db)
    expect((await db.collection('reminders').findOne({ id: 'r1' }))!['status']).toBe('failed')
  })

  it('honors the blast-radius cap per sweep', async () => {
    await enableRule('auto_unlock_expired', { max_blast_radius: 2, cooldown_minutes: 5 })
    await db
      .collection('users')
      .insertMany(
        ['a', 'b', 'c', 'd'].map((id) => ({ id, locked_until: new Date(Date.now() - 1000) })),
      )
    const executed = await runAutopilotSweep(db)
    expect(executed.filter((a) => a.status === 'executed')).toHaveLength(2)
    const stillLocked = await db
      .collection('users')
      .countDocuments({ locked_until: { $exists: true } })
    expect(stillLocked).toBe(2)
  })

  it('raises an assigned alert for leads stale beyond 48h', async () => {
    await enableRule('stale_lead_alerts')
    await db.collection('platform_operators').insertMany([
      { user_id: 'op-1', status: 'active', roles: ['support'] }, // has leads.manage per ROLE_PERMISSIONS? no — support lacks manage
      { user_id: 'op-2', status: 'active', roles: ['marketing_operator'] }, // leads.manage ✓
    ])
    await db.collection('leads').insertMany([
      {
        id: 'lead-old',
        email: 'old@example.com',
        stage: 'new',
        created_at: new Date(Date.now() - 72 * 3600_000),
      },
      { id: 'lead-fresh', email: 'fresh@example.com', stage: 'new', created_at: new Date() },
    ])
    const executed = await runAutopilotSweep(db)
    expect(executed).toHaveLength(1)
    const alert = await db
      .collection('operator_alerts')
      .findOne({ dedup_key: 'stale_lead:lead-old' })
    expect(alert).toMatchObject({ status: 'open', assignee: 'op-2' })
    // Upsert preserved — a second sweep creates no duplicate.
    await db
      .collection('autopilot_rules')
      .updateOne({ rule: 'stale_lead_alerts' }, { $set: { last_run_at: new Date(0) } })
    await runAutopilotSweep(db)
    expect(
      await db.collection('operator_alerts').countDocuments({ dedup_key: 'stale_lead:lead-old' }),
    ).toBe(1)
  })

  it('flags a channel whose last 3 publishes all failed with auth errors', async () => {
    await enableRule('channel_auth_failure_alert')
    const post = (id: string, channel: string, error: string, minsAgo: number) => ({
      id,
      tenant_id: 't1',
      channel,
      state: 'publish_failed',
      publish_error: error,
      updated_at: new Date(Date.now() - minsAgo * 60_000),
    })
    await db.collection('marketing_posts').insertMany([
      post('p1', 'x', '401 Unauthorized', 10),
      post('p2', 'x', 'token expired', 20),
      post('p3', 'x', 'invalid_token', 30),
      // Content rejection — not auth-shaped, doesn't count toward the rule.
      post('p4', 'bluesky', 'content rejected by moderation', 10),
      post('p5', 'bluesky', 'content rejected', 20),
      post('p6', 'bluesky', 'content rejected', 30),
    ])
    await runAutopilotSweep(db)
    const alert = await db
      .collection('operator_alerts')
      .findOne({ dedup_key: 'channel_auth_failure:t1:x' })
    expect(alert).toMatchObject({ status: 'open', severity: 'danger' })
    expect(
      await db
        .collection('operator_alerts')
        .findOne({ dedup_key: 'channel_auth_failure:t1:bluesky' }),
    ).toBeNull()
  })
})

describe('tier-2 proposals', () => {
  it('proposes — but never executes — a suspend for a brute-forced account', async () => {
    await enableRule('propose_suspend_brute_force')
    await db
      .collection('users')
      .insertOne({ id: 'victim', email: 'v@example.com', status: 'active' })
    // 15 failures across 3 IPs in the last 24h.
    const events = Array.from({ length: 15 }, (_, i) => ({
      user_id: 'victim',
      success: false,
      reason: 'bad_password',
      ip: `10.0.0.${i % 3}`,
      created_at: new Date(),
    }))
    await db.collection('login_events').insertMany(events)

    const rows = await runAutopilotSweep(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      rule: 'propose_suspend_brute_force',
      status: 'proposed',
      target_id: 'victim',
    })
    expect(rows[0]!.proposal).toMatchObject({
      kind: 'user.suspend',
      required_permission: 'users.manage',
    })
    // The mutation did NOT run — proposals file, they never act.
    expect((await db.collection('users').findOne({ id: 'victim' }))!['status']).toBe('active')
    const audit = await db.collection('operator_audit_log').findOne({ action: 'autopilot.propose' })
    expect(audit).toMatchObject({ operator_user_id: 'autopilot', target_id: 'victim' })
  })

  it('ignores failures from a single IP — that is a forgot-password user, not stuffing', async () => {
    await enableRule('propose_suspend_brute_force')
    await db.collection('users').insertOne({ id: 'u1', status: 'active' })
    await db.collection('login_events').insertMany(
      Array.from({ length: 20 }, () => ({
        user_id: 'u1',
        success: false,
        ip: '10.0.0.1',
        created_at: new Date(),
      })),
    )
    expect(await runAutopilotSweep(db)).toHaveLength(0)
  })

  it('dedupes proposals — a second sweep files nothing for the same window', async () => {
    await enableRule('propose_suspend_brute_force')
    await db.collection('users').insertOne({ id: 'victim', status: 'active' })
    await db.collection('login_events').insertMany(
      Array.from({ length: 15 }, (_, i) => ({
        user_id: 'victim',
        success: false,
        ip: `10.0.0.${i % 3}`,
        created_at: new Date(),
      })),
    )
    await runAutopilotSweep(db)
    await db
      .collection('autopilot_rules')
      .updateOne({ rule: 'propose_suspend_brute_force' }, { $set: { last_run_at: new Date(0) } })
    expect(await runAutopilotSweep(db)).toHaveLength(0)
    expect(await db.collection('autopilot_actions').countDocuments({ status: 'proposed' })).toBe(1)
  })

  it('skips users already suspended', async () => {
    await enableRule('propose_suspend_brute_force')
    await db.collection('users').insertOne({ id: 'u1', status: 'suspended' })
    await db.collection('login_events').insertMany(
      Array.from({ length: 15 }, (_, i) => ({
        user_id: 'u1',
        success: false,
        ip: `10.0.0.${i % 3}`,
        created_at: new Date(),
      })),
    )
    expect(await runAutopilotSweep(db)).toHaveLength(0)
  })

  it('proposes a promo draft for a published blog post no channel has promoted', async () => {
    await enableRule('propose_blog_promo')
    await db.collection('blog_posts').insertOne({
      slug: 'ready-check',
      title: 'The readiness check',
      published: true,
      published_at: new Date(Date.now() - 5 * 24 * 3600_000),
      excerpt: 'excerpt',
    })
    await db
      .collection('social_connections')
      .insertOne({ tenant_id: 't1', channel: 'x', status: 'active' })

    const rows = await runAutopilotSweep(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'proposed', target_type: 'blog_post' })
    expect(rows[0]!.proposal).toMatchObject({
      kind: 'marketing.blog_draft',
      required_permission: 'marketing.manage',
      payload: { blog_slug: 'ready-check', tenant_id: 't1', channel: 'x' },
    })
  })

  it('does not re-propose a post already promoted on that tenant', async () => {
    await enableRule('propose_blog_promo')
    await db.collection('blog_posts').insertOne({
      slug: 'ready-check',
      title: 'T',
      published: true,
      published_at: new Date(Date.now() - 5 * 24 * 3600_000),
    })
    await db
      .collection('social_connections')
      .insertOne({ tenant_id: 't1', channel: 'x', status: 'active' })
    await db
      .collection('marketing_posts')
      .insertOne({ tenant_id: 't1', source_blog_slug: 'ready-check', state: 'draft' })
    expect(await runAutopilotSweep(db)).toHaveLength(0)
  })
})

describe('cooldown follows action, not attempt', () => {
  const publishedBlog = () =>
    db.collection('blog_posts').insertOne({
      slug: 'late-post',
      title: 'Published after the first sweep',
      published: true,
      published_at: new Date(Date.now() - 5 * 24 * 3600_000),
    })

  it('does not put a rule on cooldown when its sweep found nothing to do', async () => {
    await enableRule('propose_blog_promo')
    expect(await runAutopilotSweep(db)).toHaveLength(0)

    const stored = await db.collection('autopilot_rules').findOne({ rule: 'propose_blog_promo' })
    expect(stored?.['last_run_at']).toBeUndefined()

    // Content and a channel appear a moment later — the very next sweep must
    // see them rather than waiting out the rule's 24h cooldown.
    await publishedBlog()
    await db
      .collection('social_connections')
      .insertOne({ tenant_id: 't1', channel: 'x', status: 'active' })
    const rows = await runAutopilotSweep(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'proposed', target_type: 'blog_post' })
  })

  it('still cools down after a sweep that acted', async () => {
    await enableRule('propose_blog_promo')
    await publishedBlog()
    await db
      .collection('social_connections')
      .insertOne({ tenant_id: 't1', channel: 'x', status: 'active' })
    expect(await runAutopilotSweep(db)).toHaveLength(1)

    const stored = await db.collection('autopilot_rules').findOne({ rule: 'propose_blog_promo' })
    expect(stored?.['last_run_at']).toBeInstanceOf(Date)

    // A second connected channel would yield a new candidate, but the rule is
    // inside its cooldown so it must not run.
    await db
      .collection('social_connections')
      .insertOne({ tenant_id: 't2', channel: 'x', status: 'active' })
    expect(await runAutopilotSweep(db)).toHaveLength(0)
  })
})

describe('shadow mode', () => {
  const lockedUser = () =>
    db.collection('users').insertOne({
      id: 'u1',
      email: 'u1@example.com',
      failed_login_attempts: 5,
      locked_until: new Date(Date.now() - 60_000),
    })

  it('logs what it would do and changes nothing', async () => {
    await enableRule('auto_unlock_expired', { mode: 'shadow' })
    await lockedUser()

    const rows = await runAutopilotSweep(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'shadow', target_id: 'u1' })
    expect(rows[0]!.would_do).toMatch(/would act/i)

    // The act() never ran: the user is still locked-out state, untouched.
    const user = await db.collection('users').findOne({ id: 'u1' })
    expect(user?.['failed_login_attempts']).toBe(5)
    // And no audit row claims an action happened.
    expect(await db.collection('operator_audit_log').countDocuments()).toBe(0)
  })

  it('files no real proposal and raises no alert while shadowing', async () => {
    await enableRule('propose_blog_promo', { mode: 'shadow' })
    await db.collection('blog_posts').insertOne({
      slug: 's',
      title: 'T',
      published: true,
      published_at: new Date(Date.now() - 5 * 24 * 3600_000),
    })
    await db
      .collection('social_connections')
      .insertOne({ tenant_id: 't1', channel: 'x', status: 'active' })
    await db.collection('leads').insertOne({
      id: 'l1',
      email: 'l@example.com',
      stage: 'new',
      created_at: new Date(Date.now() - 72 * 3600_000),
    })
    await enableRule('stale_lead_alerts', { mode: 'shadow' })

    const rows = await runAutopilotSweep(db)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.every((r) => r.status === 'shadow')).toBe(true)
    expect(await db.collection('autopilot_actions').countDocuments({ status: 'proposed' })).toBe(0)
    expect(await db.collection('operator_alerts').countDocuments()).toBe(0)
  })

  it('going live later still acts on targets already seen in shadow', async () => {
    await enableRule('auto_unlock_expired', { mode: 'shadow' })
    await lockedUser()
    await runAutopilotSweep(db)

    await db
      .collection('autopilot_rules')
      .updateOne(
        { rule: 'auto_unlock_expired' },
        { $set: { mode: 'live' }, $unset: { last_run_at: '' } },
      )
    const rows = await runAutopilotSweep(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'executed', target_id: 'u1' })
    expect((await db.collection('users').findOne({ id: 'u1' }))?.['failed_login_attempts']).toBe(0)
  })

  it('does not log the same target twice', async () => {
    await enableRule('auto_unlock_expired', { mode: 'shadow', cooldown_minutes: 5 })
    await lockedUser()
    await runAutopilotSweep(db)
    await db
      .collection('autopilot_rules')
      .updateOne({ rule: 'auto_unlock_expired' }, { $unset: { last_run_at: '' } })
    expect(await runAutopilotSweep(db)).toHaveLength(0)
  })

  it('treats a rule with no mode as live (rules enabled before shadow existed)', async () => {
    await enableRule('auto_unlock_expired')
    await lockedUser()
    const rows = await runAutopilotSweep(db)
    expect(rows[0]).toMatchObject({ status: 'executed' })
  })
})

describe('kill switch', () => {
  it('runs nothing — shadow or live — while autopilot_paused is set', async () => {
    await enableRule('auto_unlock_expired')
    await enableRule('stale_lead_alerts', { mode: 'shadow' })
    await db.collection('users').insertOne({
      id: 'u2',
      email: 'u2@example.com',
      failed_login_attempts: 5,
      locked_until: new Date(Date.now() - 60_000),
    })
    await db
      .collection('platform_config')
      .updateOne({ key: 'global' }, { $set: { autopilot_paused: true } }, { upsert: true })
    invalidatePlatformConfigCache()

    expect(await runAutopilotSweep(db)).toEqual([])
    expect((await db.collection('users').findOne({ id: 'u2' }))?.['failed_login_attempts']).toBe(5)

    await db
      .collection('platform_config')
      .updateOne({ key: 'global' }, { $set: { autopilot_paused: false } })
    invalidatePlatformConfigCache()
    expect(await runAutopilotSweep(db)).toHaveLength(1)
  })
})

describe('shadow track record', () => {
  async function shadowRows(n: number) {
    await db.collection('autopilot_actions').insertMany(
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        rule: 'auto_unlock_expired',
        dedup_key: `shadow:k${i}`,
        target_type: 'user',
        target_id: `u${i}`,
        reason: 'r',
        status: 'shadow',
        created_at: new Date(),
      })),
    )
  }

  it('needs both enough reviews and enough of them right', () => {
    expect(meetsPromotion(19, 19)).toBe(false) // too few reviewed
    expect(meetsPromotion(20, 17)).toBe(false) // 85% < 90%
    expect(meetsPromotion(20, 18)).toBe(true) // 90%
    expect(meetsPromotion(40, 40)).toBe(true)
  })

  it('computes stats from verdicts and flips promotable at the bar', async () => {
    await shadowRows(25)
    expect(await shadowStats(db, 'auto_unlock_expired')).toMatchObject({
      total: 25,
      reviewed: 0,
      precision: null,
      promotable: false,
    })

    for (let i = 0; i < 20; i++) {
      await reviewShadowRow(db, `s${i}`, i < 17 ? 'right' : 'wrong', 'op1')
    }
    const thin = await shadowStats(db, 'auto_unlock_expired')
    expect(thin).toMatchObject({ reviewed: 20, right: 17, promotable: false })
    expect(thin.precision).toBeCloseTo(0.85)

    await reviewShadowRow(db, 's17', 'right', 'op1') // re-verdict a wrong one
    expect((await shadowStats(db, 'auto_unlock_expired')).promotable).toBe(true)
  })

  it('only reviews shadow rows', async () => {
    await db.collection('autopilot_actions').insertOne({
      id: 'x1',
      rule: 'auto_unlock_expired',
      dedup_key: 'live:1',
      target_type: 'user',
      target_id: 'u',
      reason: 'r',
      status: 'executed',
      created_at: new Date(),
    })
    expect(await reviewShadowRow(db, 'x1', 'right', 'op1')).toBeNull()
    expect(await reviewShadowRow(db, 'nope', 'right', 'op1')).toBeNull()
  })
})

describe('PROPOSAL_HANDLERS', () => {
  it('user.suspend applies the same suspend+revoke mutation the manual route does', async () => {
    await db.collection('users').insertOne({ id: 'victim', status: 'active' })
    const result = await PROPOSAL_HANDLERS['user.suspend']!(db, { user_id: 'victim' }, {})
    expect(result).toContain('suspended')
    const user = await db.collection('users').findOne({ id: 'victim' })
    expect(user).toMatchObject({ status: 'suspended' })
    expect(user!['sessions_revoked_at']).toBeTruthy()
    // Idempotent — approving a stale proposal no-ops instead of failing.
    expect(await PROPOSAL_HANDLERS['user.suspend']!(db, { user_id: 'victim' }, {})).toContain(
      'no-op',
    )
  })

  it('marketing.blog_draft creates a review-gated draft, never a published post', async () => {
    await db.collection('blog_posts').insertOne({
      slug: 'ready-check',
      title: 'The readiness check',
      excerpt: 'excerpt',
      published: true,
    })
    const result = await PROPOSAL_HANDLERS['marketing.blog_draft']!(
      db,
      { tenant_id: 't1', blog_slug: 'ready-check', channel: 'x' },
      {
        llmFor: () => async () => {
          throw new Error('no provider')
        },
      }, // template fallback path
    )
    expect(result).toContain('draft')
    const post = await db.collection('marketing_posts').findOne({ source_blog_slug: 'ready-check' })
    expect(post).toMatchObject({
      state: 'draft',
      tenant_id: 't1',
      channel: 'x',
      generated: 'template',
    })
  })
})
