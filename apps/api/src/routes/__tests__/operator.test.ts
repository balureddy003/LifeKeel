import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerOperatorRoutes } from '../operator.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

async function buildApp(userId = 'operator-1'): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.authContext = { user_id: userId, tenant_id: 'operator-tenant', roles: ['admin'] }
  })
  await registerOperatorRoutes(app, db)
  await app.ready()
  return app
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('operator-routes')
})

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('users').insertMany([
    {
      id: 'operator-1', tenant_id: 'operator-tenant', email: 'operator@example.com', name: 'Operator',
      roles: ['admin'], status: 'active', password_hash: 'secret-hash', salt: 'secret-salt', created_at: new Date(),
    },
    {
      id: 'user-2', tenant_id: 'family-1', email: 'family@example.com', name: 'Family User',
      roles: ['admin'], status: 'active', password_hash: 'secret-hash', salt: 'secret-salt', created_at: new Date(),
    },
  ])
  await db.collection('tenants').insertMany([
    { tenant_id: 'operator-tenant', name: 'Operator', status: 'active', plan: 'free', created_at: new Date() },
    { tenant_id: 'family-1', name: 'Family One', status: 'active', plan: 'plus', created_at: new Date() },
  ])
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('/operator control plane', () => {
  it('rejects an ordinary tenant admin', async () => {
    const app = await buildApp('user-2')
    const response = await app.inject({ method: 'GET', url: '/operator/overview' })
    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('returns a cross-tenant overview to a platform operator', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    await db.collection('marketing_posts').insertOne({ id: 'post-1', state: 'publish_failed' })
    await db.collection('growth_events').insertOne({ event: 'signup_completed', created_at: new Date() })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/overview' })
    expect(response.statusCode).toBe(200)
    expect(response.json().users.total).toBe(2)
    expect(response.json().tenants.total).toBe(2)
    expect(response.json().marketing.publish_failed).toBe(1)
    expect(response.json().growth_events_7d).toContainEqual({ event: 'signup_completed', count: 1 })
    // 30-day activity series for the command-center sparklines.
    const activity = response.json().activity_30d as { day: string; event: string; count: number }[]
    expect(activity).toContainEqual(expect.objectContaining({ event: 'signup_completed', count: 1 }))
    expect(response.json().users.signups_prev_week).toBe(0)
    expect(response.json().leads_7d).toBe(0)
    await app.close()
  })

  it('serves the activity series from metrics_daily once the rollup has backfilled', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    // A rollup row for an event that does NOT exist in raw growth_events —
    // if it shows up, the overview read the rollup, not the collection scan.
    const today = new Date().toISOString().slice(0, 10)
    await db.collection<{ _id: string }>('metrics_daily').insertMany([
      { _id: 'meta', backfilled_at: new Date() } as never,
      { _id: `${today}|growth_event|quiz_completed`, day: today, metric: 'growth_event', dim: 'quiz_completed', count: 7, updated_at: new Date() } as never,
    ])
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/overview' })
    expect(response.statusCode).toBe(200)
    const activity = response.json().activity_30d as { day: string; event: string; count: number }[]
    expect(activity).toContainEqual({ day: today, event: 'quiz_completed', count: 7 })
    await app.close()
  })

  it('searches users without returning credential material', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/users?q=family' })
    expect(response.statusCode).toBe(200)
    expect(response.json().users).toHaveLength(1)
    expect(response.json().users[0].id).toBe('user-2')
    expect(response.json().users[0].password_hash).toBeUndefined()
    expect(response.json().users[0].salt).toBeUndefined()
    await app.close()
  })

  it('filters users by exact tenant for the members drill-down', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    await db.collection('users').insertOne({
      id: 'user-3', tenant_id: 'family-10', email: 'other@example.com', name: 'Other',
      roles: ['member'], status: 'active', created_at: new Date(),
    })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/users?tenant=family-1' })
    expect(response.statusCode).toBe(200)
    expect(response.json().total).toBe(1)
    expect(response.json().users[0].id).toBe('user-2')
    await app.close()
  })

  it('prevents support operators from suspending users', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST', url: '/operator/users/user-2/suspend', payload: { reason: 'Support request' },
    })
    expect(response.statusCode).toBe(403)
    expect((await db.collection('users').findOne({ id: 'user-2' }))?.['status']).toBe('active')
    await app.close()
  })

  it('suspends a user with a required reason and immutable operator audit entry', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST', url: '/operator/users/user-2/suspend', payload: { reason: 'Confirmed account abuse' },
    })
    expect(response.statusCode).toBe(200)
    expect((await db.collection('users').findOne({ id: 'user-2' }))?.['status']).toBe('suspended')
    const audit = await db.collection('operator_audit_log').findOne({ target_id: 'user-2' })
    expect(audit?.['action']).toBe('operator.user.suspend')
    expect(audit?.['reason']).toBe('Confirmed account abuse')
    expect(audit?.['operator_user_id']).toBe('operator-1')
    await app.close()
  })

  it('lists tenants with cross-tenant member counts', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/tenants?q=Family' })
    expect(response.statusCode).toBe(200)
    expect(response.json().tenants).toHaveLength(1)
    expect(response.json().tenants[0]).toMatchObject({ tenant_id: 'family-1', user_count: 1 })
    await app.close()
  })

  it('suspends and reactivates a tenant with audit entries', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()
    const suspend = await app.inject({ method: 'POST', url: '/operator/tenants/family-1/suspend', payload: { reason: 'Abuse investigation' } })
    expect(suspend.statusCode).toBe(200)
    expect((await db.collection('tenants').findOne({ tenant_id: 'family-1' }))?.['status']).toBe('suspended')
    const reactivate = await app.inject({ method: 'POST', url: '/operator/tenants/family-1/reactivate', payload: { reason: 'Investigation cleared' } })
    expect(reactivate.statusCode).toBe(200)
    const entries = await db.collection('operator_audit_log').find({ target_type: 'tenant' }).toArray()
    expect(entries.map((e) => e['action']).sort()).toEqual(['operator.tenant.reactivate', 'operator.tenant.suspend'])
    await app.close()
  })

  it('issues a password-reset token through the standard email path', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()
    const response = await app.inject({ method: 'POST', url: '/operator/users/user-2/password-reset', payload: { reason: 'User requested via support' } })
    expect(response.statusCode).toBe(200)
    const user = await db.collection('users').findOne({ id: 'user-2' })
    expect(typeof user?.['password_reset_token']).toBe('string')
    expect((user?.['password_reset_expires'] as Date).getTime()).toBeGreaterThan(Date.now())
    await app.close()
  })

  it('manages platform operators while protecting self and the last super_admin', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['super_admin'] })
    const app = await buildApp()

    const create = await app.inject({ method: 'POST', url: '/operator/operators', payload: { user_id: 'user-2', roles: ['support'], reason: 'Support onboarding' } })
    expect(create.statusCode).toBe(200)

    const demoteSelf = await app.inject({ method: 'PATCH', url: '/operator/operators/operator-1', payload: { roles: ['support'], reason: 'Should not work' } })
    expect(demoteSelf.statusCode).toBe(409)

    const suspendSelf = await app.inject({ method: 'POST', url: '/operator/operators/operator-1/suspend', payload: { reason: 'Should not work' } })
    expect(suspendSelf.statusCode).toBe(409)

    const list = await app.inject({ method: 'GET', url: '/operator/operators' })
    expect(list.statusCode).toBe(200)
    expect(list.json().operators).toHaveLength(2)
    await app.close()
  })

  it('blocks operator management from non-super_admin platform roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()
    const response = await app.inject({ method: 'POST', url: '/operator/operators', payload: { user_id: 'user-2', roles: ['support'], reason: 'Not allowed' } })
    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('returns the operator audit trail and operations health', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    await db.collection('insights').insertOne({ state: 'identified' })
    const app = await buildApp()
    await app.inject({ method: 'POST', url: '/operator/tenants/family-1/suspend', payload: { reason: 'Audit test entry' } })

    const audit = await app.inject({ method: 'GET', url: '/operator/audit?target_type=tenant' })
    expect(audit.statusCode).toBe(200)
    expect(audit.json().entries[0].action).toBe('operator.tenant.suspend')
    expect(audit.json().entries[0].reason).toBe('Audit test entry')

    const ops = await app.inject({ method: 'GET', url: '/operator/operations' })
    expect(ops.statusCode).toBe(200)
    expect(ops.json().mongo.ok).toBe(true)
    expect(ops.json().insights_by_state.identified).toBe(1)
    expect(ops.json().process.uptime_seconds).toBeGreaterThanOrEqual(0)
    await app.close()
  })

  it('lists, updates, and suppresses leads with audit entries', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['marketing_operator'] })
    await db.collection('leads').insertOne({
      id: 'lead-1', email: 'lead@example.com', stage: 'new', source: 'readiness_quiz',
      suppressed: false, notes: [], consent: { marketing: true }, created_at: new Date(),
    })
    const app = await buildApp()

    const list = await app.inject({ method: 'GET', url: '/operator/leads?stage=new' })
    expect(list.statusCode).toBe(200)
    expect(list.json().leads).toHaveLength(1)
    expect(list.json().stages.new).toBe(1)
    expect(list.json().sources.readiness_quiz).toBe(1)

    const update = await app.inject({
      method: 'PATCH', url: '/operator/leads/lead-1',
      payload: { stage: 'contacted', note: 'Replied to intro email', reason: 'Pipeline progression' },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().lead.stage).toBe('contacted')
    expect(update.json().lead.notes).toHaveLength(1)
    expect(update.json().lead.notes[0].author_id).toBe('operator-1')

    const suppress = await app.inject({
      method: 'POST', url: '/operator/leads/lead-1/suppress', payload: { reason: 'Unsubscribe request received' },
    })
    expect(suppress.statusCode).toBe(200)
    expect((await db.collection('leads').findOne({ id: 'lead-1' }))?.['suppressed']).toBe(true)

    const actions = (await db.collection('operator_audit_log').find({ target_id: 'lead-1' }).toArray()).map((e) => e['action'])
    expect(actions.sort()).toEqual(['operator.lead.add_note', 'operator.lead.suppress', 'operator.lead.update_stage'])
    await app.close()
  })

  it('blocks lead management from roles without leads.manage', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const response = await app.inject({
      method: 'PATCH', url: '/operator/leads/lead-1', payload: { stage: 'contacted', reason: 'Should not work' },
    })
    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('creates, lists, and deactivates promo codes with audit entries', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['finance_operator'] })
    const app = await buildApp()

    const create = await app.inject({
      method: 'POST', url: '/operator/promotions',
      payload: { code: 'launch50', grant_credits: 50, max_uses: 100, reason: 'Launch campaign' },
    })
    expect(create.statusCode).toBe(200)
    expect(create.json().code).toBe('LAUNCH50')

    const dup = await app.inject({
      method: 'POST', url: '/operator/promotions',
      payload: { code: 'LAUNCH50', grant_credits: 10, max_uses: 1, reason: 'Duplicate attempt' },
    })
    expect(dup.statusCode).toBe(409)

    const list = await app.inject({ method: 'GET', url: '/operator/promotions' })
    expect(list.json().promotions).toHaveLength(1)
    expect(list.json().promotions[0]).toMatchObject({ code: 'LAUNCH50', grant_credits: 50, active: true, used_count: 0 })

    await db.collection('promo_redemptions').insertOne({ tenant_id: 'family-1', code: 'LAUNCH50', grant_credits: 50, redeemed_at: new Date() })
    const redemptions = await app.inject({ method: 'GET', url: '/operator/promotions/LAUNCH50/redemptions' })
    expect(redemptions.statusCode).toBe(200)
    expect(redemptions.json().redemptions).toHaveLength(1)

    const deactivate = await app.inject({
      method: 'POST', url: '/operator/promotions/LAUNCH50/deactivate', payload: { reason: 'Campaign ended' },
    })
    expect(deactivate.statusCode).toBe(200)
    expect((await db.collection('promo_codes').findOne({ code: 'LAUNCH50' }))?.['active']).toBe(false)

    const actions = (await db.collection('operator_audit_log').find({ target_type: 'promotion' }).toArray()).map((e) => e['action'])
    expect(actions.sort()).toEqual(['operator.promotion.create', 'operator.promotion.deactivate'])
    await app.close()
  })

  it('blocks promotion management from non-finance roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const response = await app.inject({
      method: 'POST', url: '/operator/promotions', payload: { code: 'TEST1', grant_credits: 5, reason: 'Should not work' },
    })
    expect(response.statusCode).toBe(403)
    expect(await db.collection('promo_codes').countDocuments({})).toBe(0)
    await app.close()
  })

  it('reports signups grouped by utm_source on the overview', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    await db.collection('users').insertMany([
      { id: 'u-x', tenant_id: 't-x', email: 'x@x.com', roles: ['admin'], created_at: new Date(), attribution: { utm_source: 'linkedin' } },
      { id: 'u-y', tenant_id: 't-y', email: 'y@y.com', roles: ['admin'], created_at: new Date(), attribution: { utm_source: 'linkedin' } },
      { id: 'u-z', tenant_id: 't-z', email: 'z@z.com', roles: ['admin'], created_at: new Date() },
    ])
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/overview' })
    expect(response.statusCode).toBe(200)
    expect(response.json().signups_by_source_7d).toEqual({ linkedin: 2, direct: 3 })
    await app.close()
  })

  it('manages the blog lifecycle with audited, reasoned actions', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['marketing_operator'] })
    const app = await buildApp()

    const create = await app.inject({
      method: 'POST', url: '/operator/blog/posts',
      payload: {
        title: 'Emergency funds', slug: 'emergency-funds', content: '# Body', excerpt: 'An excerpt',
        category: 'tutorial', author: 'Oak', meta_description: 'SEO description', reason: 'Content calendar week 12',
      },
    })
    expect(create.statusCode).toBe(200)
    const postId = create.json().post.id as string
    expect(create.json().post.published).toBe(false)

    // Drafts must not leak onto the public list (mirrors blog.ts's filter).
    expect(await db.collection('blog_posts').countDocuments({ id: postId, published: true })).toBe(0)

    const update = await app.inject({
      method: 'PATCH', url: `/operator/blog/posts/${postId}`,
      payload: { excerpt: 'Better excerpt', reason: 'Editorial review' },
    })
    expect(update.statusCode).toBe(200)
    expect(update.json().post.excerpt).toBe('Better excerpt')

    const publish = await app.inject({ method: 'POST', url: `/operator/blog/posts/${postId}/publish`, payload: { reason: 'Approved for publication' } })
    expect(publish.statusCode).toBe(200)
    const published = await db.collection('blog_posts').findOne({ id: postId })
    expect(published?.['published']).toBe(true)
    expect(published?.['published_at']).toBeInstanceOf(Date)

    const unpublish = await app.inject({ method: 'POST', url: `/operator/blog/posts/${postId}/unpublish`, payload: { reason: 'Content needs revision' } })
    expect(unpublish.statusCode).toBe(200)
    expect((await db.collection('blog_posts').findOne({ id: postId }))?.['published']).toBe(false)

    const actions = (await db.collection('operator_audit_log').find({ target_type: 'blog_post' }).toArray()).map((e) => e['action'])
    expect(actions.sort()).toEqual(['operator.blog.create', 'operator.blog.publish', 'operator.blog.unpublish', 'operator.blog.update'])
    await app.close()
  })

  it('rejects duplicate blog slugs and non-marketing roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['marketing_operator'] })
    await db.collection('blog_posts').insertOne({ id: 'p1', slug: 'taken', title: 'T', content: 'C', excerpt: 'E', category: 'news', author: 'A', published: true, created_at: new Date() })
    const app = await buildApp()

    const dup = await app.inject({
      method: 'POST', url: '/operator/blog/posts',
      payload: { title: 'T2', slug: 'taken', content: 'C', excerpt: 'E', category: 'news', author: 'A', reason: 'Dup slug attempt' },
    })
    expect(dup.statusCode).toBe(409)

    const list = await app.inject({ method: 'GET', url: '/operator/blog/posts' })
    expect(list.statusCode).toBe(200)
    expect(list.json().posts).toHaveLength(1)
    await app.close()

    const app2 = await buildApp('user-2')
    const denied = await app2.inject({ method: 'GET', url: '/operator/blog/posts' })
    expect(denied.statusCode).toBe(403)
    await app2.close()
  })

  it('reports billing overview and tenant ledger detail', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['finance_operator'] })
    await db.collection('tenants').updateOne(
      { tenant_id: 'family-1' },
      { $set: { billing: { credits_balance: 12, credits_included: 10, currency: 'GBP' }, stripe_customer_id: 'cus_123' } },
    )
    await db.collection('stripe_webhook_events').insertOne({ event_id: 'evt_1', event_type: 'invoice.paid', processed_at: new Date() })
    const app = await buildApp()

    const overview = await app.inject({ method: 'GET', url: '/operator/billing' })
    expect(overview.statusCode).toBe(200)
    expect(overview.json().tenants_by_plan.plus).toBe(1)
    expect(overview.json().stripe_linked_tenants).toBe(1)
    expect(overview.json().credits_outstanding).toBe(12)
    expect(overview.json().recent_webhooks[0].event_type).toBe('invoice.paid')

    const detail = await app.inject({ method: 'GET', url: '/operator/billing/tenants/family-1' })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().tenant.billing.credits_balance).toBe(12)
    expect(detail.json().tenant.stripe_customer_id).toBe('cus_123')
    await app.close()
  })

  it('adjusts credits atomically with ledger and audit records', async () => {
    process.env['BILLING_V2_ENABLED'] = 'true'
    try {
      await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['finance_operator'] })
      await db.collection('tenants').updateOne(
        { tenant_id: 'family-1' },
        { $set: { billing: { credits_balance: 5, credits_included: 5, currency: 'GBP' } } },
      )
      const app = await buildApp()

      const grant = await app.inject({
        method: 'POST', url: '/operator/billing/tenants/family-1/adjust-credits',
        payload: { amount: 10, reason: 'Goodwill after outage' },
      })
      expect(grant.statusCode).toBe(200)
      expect(grant.json().credits_balance).toBe(15)

      const overDeduct = await app.inject({
        method: 'POST', url: '/operator/billing/tenants/family-1/adjust-credits',
        payload: { amount: -50, reason: 'Should fail' },
      })
      expect(overDeduct.statusCode).toBe(409)
      expect((await db.collection('tenants').findOne({ tenant_id: 'family-1' }))?.['billing']?.['credits_balance']).toBe(15)

      const deduct = await app.inject({
        method: 'POST', url: '/operator/billing/tenants/family-1/adjust-credits',
        payload: { amount: -5, reason: 'Correction of duplicate grant' },
      })
      expect(deduct.statusCode).toBe(200)
      expect(deduct.json().credits_balance).toBe(10)

      const entries = await db.collection('credit_ledger').find({ tenant_id: 'family-1', type: 'admin_adjustment' }).toArray()
      expect(entries.map((e) => e['amount']).sort((a, b) => (a as number) - (b as number))).toEqual([-5, 10])
      expect(entries[0]?.['actor']).toBe('operator-1')

      const audits = (await db.collection('operator_audit_log').find({ action: 'operator.billing.adjust_credits' }).toArray())
      expect(audits).toHaveLength(2)
      await app.close()
    } finally {
      delete process.env['BILLING_V2_ENABLED']
    }
  })

  it('rejects credit adjustment on unlimited plans and non-finance roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['finance_operator'] })
    await db.collection('tenants').updateOne(
      { tenant_id: 'family-1' },
      { $set: { billing: { credits_balance: Number.MAX_SAFE_INTEGER, currency: 'GBP' } } },
    )
    const app = await buildApp()
    const unlimited = await app.inject({
      method: 'POST', url: '/operator/billing/tenants/family-1/adjust-credits',
      payload: { amount: 10, reason: 'Should not apply' },
    })
    expect(unlimited.statusCode).toBe(409)
    await app.close()

    await db.collection('platform_operators').updateOne({ user_id: 'operator-1' }, { $set: { roles: ['support'] } })
    const app2 = await buildApp()
    const denied = await app2.inject({
      method: 'POST', url: '/operator/billing/tenants/family-1/adjust-credits',
      payload: { amount: 10, reason: 'Support cannot do this' },
    })
    expect(denied.statusCode).toBe(403)
    await app2.close()
  })
})

describe('operations depth', () => {
  it('reports reminder, connector, cron, and queue health without secrets', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    await db.collection('reminders').insertMany([
      { id: 'rem-1', tenant_id: 'family-1', status: 'failed', attempts: 6, last_error: 'SMTP timeout', due_at: new Date(), policy: { type: 'motor', provider: 'Acme', policy_number: 'SECRET-123' }, updated_at: new Date() },
      { id: 'rem-2', tenant_id: 'family-1', status: 'scheduled', attempts: 0, due_at: new Date(), updated_at: new Date() },
      { id: 'rem-3', tenant_id: 'family-1', status: 'sending', attempts: 1, due_at: new Date(), updated_at: new Date(Date.now() - 20 * 60 * 1000) },
    ])
    await db.collection('connector_credentials').insertMany([
      { tenant_id: 'family-1', connector_id: 'gmail', credentials_encrypted: 'enc', token_expires_at: new Date(Date.now() + 3 * 86400000) },
      { tenant_id: 'family-1', connector_id: 'outlook', credentials_encrypted: 'enc' },
    ])
    await db.collection('cron_locks').insertMany([
      { name: 'email-scan', owner: 'worker-1', acquired_at: new Date(), expires_at: new Date(Date.now() + 60000) },
      { name: 'dead-job', owner: 'worker-2', acquired_at: new Date(Date.now() - 3600000), expires_at: new Date(Date.now() - 60000) },
    ])
    await db.collection('marketing_posts').insertOne({ id: 'post-1', state: 'publish_failed', channel: 'x', publish_error: 'rate limited', updated_at: new Date() })

    const app = await buildApp()
    const ops = await app.inject({ method: 'GET', url: '/operator/operations' })
    expect(ops.statusCode).toBe(200)
    const body = ops.json()

    expect(body.reminders_by_state.failed).toBe(1)
    expect(body.reminders_by_state.scheduled).toBe(1)
    expect(body.stale_reminder_claims).toBe(1)
    expect(body.failed_reminders).toHaveLength(1)
    expect(body.failed_reminders[0].id).toBe('rem-1')
    expect(JSON.stringify(body.failed_reminders)).not.toContain('SECRET-123')

    expect(body.connectors.by_connector.gmail).toBe(1)
    expect(body.connectors.expiring_tokens_7d).toBe(1)
    expect(JSON.stringify(body.connectors)).not.toContain('credentials_encrypted')

    const deadJob = body.cron_locks.find((l: { name: string }) => l.name === 'dead-job')
    const liveJob = body.cron_locks.find((l: { name: string }) => l.name === 'email-scan')
    expect(deadJob.stale).toBe(true)
    expect(liveJob.stale).toBe(false)

    expect(body.failed_posts[0].id).toBe('post-1')
    expect(body.queue.available).toBe(false)
    await app.close()
  })

  it('retries a failed reminder with audit, rejects non-failed reminders', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    await db.collection('reminders').insertMany([
      { id: 'rem-1', tenant_id: 'family-1', status: 'failed', attempts: 6, last_error: 'SMTP timeout', due_at: new Date(), updated_at: new Date() },
      { id: 'rem-2', tenant_id: 'family-1', status: 'sent', attempts: 1, due_at: new Date(), updated_at: new Date() },
    ])
    const app = await buildApp()

    const denied = await app.inject({ method: 'POST', url: '/operator/reminders/rem-1/retry', payload: { reason: 'no' } })
    expect(denied.statusCode).toBe(400)

    const notFailed = await app.inject({ method: 'POST', url: '/operator/reminders/rem-2/retry', payload: { reason: 'Trying anyway' } })
    expect(notFailed.statusCode).toBe(404)

    const retry = await app.inject({ method: 'POST', url: '/operator/reminders/rem-1/retry', payload: { reason: 'SMTP fixed, resending' } })
    expect(retry.statusCode).toBe(200)
    const doc = await db.collection('reminders').findOne({ id: 'rem-1' })
    expect(doc?.['status']).toBe('scheduled')
    expect(doc?.['attempts']).toBe(0)
    expect(doc?.['last_error']).toBeUndefined()

    const auditEntry = await db.collection('operator_audit_log').findOne({ action: 'operator.reminder.retry' })
    expect(auditEntry?.['reason']).toBe('SMTP fixed, resending')
    await app.close()
  })

  it('denies reminder retry to read-only roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    await db.collection('reminders').insertOne({ id: 'rem-1', tenant_id: 'family-1', status: 'failed', attempts: 6, due_at: new Date(), updated_at: new Date() })
    const app = await buildApp()
    const response = await app.inject({ method: 'POST', url: '/operator/reminders/rem-1/retry', payload: { reason: 'Support should not do this' } })
    expect(response.statusCode).toBe(403)
    await app.close()
  })
})

describe('session revocation', () => {
  it('stamps sessions_revoked_at with an audit entry', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()

    const missing = await app.inject({ method: 'POST', url: '/operator/users/ghost/revoke-sessions', payload: { reason: 'No such user' } })
    expect(missing.statusCode).toBe(404)

    const noReason = await app.inject({ method: 'POST', url: '/operator/users/user-2/revoke-sessions', payload: {} })
    expect(noReason.statusCode).toBe(400)

    const res = await app.inject({ method: 'POST', url: '/operator/users/user-2/revoke-sessions', payload: { reason: 'Device reported stolen' } })
    expect(res.statusCode).toBe(200)
    const user = await db.collection('users').findOne({ id: 'user-2' })
    expect(user?.['sessions_revoked_at']).toBeInstanceOf(Date)
    expect(user?.['status']).toBe('active') // revocation does not suspend

    const auditEntry = await db.collection('operator_audit_log').findOne({ action: 'operator.user.revoke_sessions' })
    expect(auditEntry?.['target_id']).toBe('user-2')
    await app.close()
  })

  it('denies session revocation to roles without users.manage', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['finance_operator'] })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/operator/users/user-2/revoke-sessions', payload: { reason: 'Finance should not do this' } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('dead-letter requeue', () => {
  it('requires operations.manage and a whitelisted queue', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const denied = await app.inject({ method: 'POST', url: '/operator/queues/webhook.ingest/dead/job-1/requeue', payload: { reason: 'Support cannot requeue' } })
    expect(denied.statusCode).toBe(403)
    await app.close()

    await db.collection('platform_operators').updateOne({ user_id: 'operator-1' }, { $set: { roles: ['operations'] } })
    const app2 = await buildApp()
    const unknownQueue = await app2.inject({ method: 'POST', url: '/operator/queues/evil.queue/dead/job-1/requeue', payload: { reason: 'Arbitrary key access attempt' } })
    expect(unknownQueue.statusCode).toBe(404)
    const noReason = await app2.inject({ method: 'POST', url: '/operator/queues/webhook.ingest/dead/job-1/requeue', payload: {} })
    expect(noReason.statusCode).toBe(400)
    // No Redis in the test env — inline mode means there is no durable
    // dead-letter list, so the route reports the backend as unavailable.
    const unavailable = await app2.inject({ method: 'POST', url: '/operator/queues/webhook.ingest/dead/job-1/requeue', payload: { reason: 'Retry after webhook fix' } })
    expect(unavailable.statusCode).toBe(503)
    await app2.close()
  })
})

describe('leads detail, funnel, connectors, configuration, infrastructure', () => {
  it('returns a full lead record and the 30d funnel', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['marketing_operator'] })
    await db.collection('leads').insertOne({
      id: 'lead-1', email: 'lead@example.com', stage: 'new', source: 'readiness_quiz',
      suppressed: false, notes: [{ text: 'n1', author_id: 'operator-1', created_at: new Date() }],
      consent: { marketing: true }, attribution: { utm_source: 'x' }, created_at: new Date(),
    })
    await db.collection('insights').insertOne({ tenant_id: 'family-1', state: 'identified' })
    await db.collection('tenants').updateOne({ tenant_id: 'family-1' }, { $set: { plan: 'plus' } })
    const app = await buildApp()

    const detail = await app.inject({ method: 'GET', url: '/operator/leads/lead-1' })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().lead.attribution.utm_source).toBe('x')
    expect(detail.json().lead.notes).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: '/operator/leads/ghost' })).statusCode).toBe(404)

    const funnel = await app.inject({ method: 'GET', url: '/operator/funnel' })
    expect(funnel.statusCode).toBe(200)
    expect(funnel.json().totals.leads_30d).toBe(1)
    expect(funnel.json().totals.activated_tenants).toBe(1)
    expect(funnel.json().totals.paying_tenants).toBe(1)
    expect(funnel.json().leads_by_stage.new).toBe(1)
    const quizRow = funnel.json().by_source.find((s: { source: string }) => s.source === 'readiness_quiz')
    expect(quizRow.leads).toBe(1)
    await app.close()
  })

  it('revokes a connector credential with audit, never touching secret fields', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    await db.collection('connector_credentials').insertOne({
      tenant_id: 'family-1', connector_id: 'gmail', auth_type: 'oauth2',
      access_token: 'enc:secret', refresh_token: 'enc:secret',
    })
    const app = await buildApp()

    const missing = await app.inject({ method: 'POST', url: '/operator/connectors/gmail/tenants/ghost/revoke', payload: { reason: 'No such credential' } })
    expect(missing.statusCode).toBe(404)

    const res = await app.inject({ method: 'POST', url: '/operator/connectors/gmail/tenants/family-1/revoke', payload: { reason: 'Tenant requested disconnect' } })
    expect(res.statusCode).toBe(200)
    expect(await db.collection('connector_credentials').findOne({ tenant_id: 'family-1' })).toBeNull()

    const entry = await db.collection('operator_audit_log').findOne({ action: 'operator.connector.revoke' })
    expect(entry?.['target_id']).toBe('family-1/gmail')

    // The ops view exposes the connector list without credential fields.
    await db.collection('connector_credentials').insertOne({ tenant_id: 'family-1', connector_id: 'outlook', auth_type: 'oauth2', access_token: 'enc:hidden' })
    const ops = await app.inject({ method: 'GET', url: '/operator/operations' })
    expect(ops.json().connectors.list[0].connector_id).toBe('outlook')
    expect(JSON.stringify(ops.json().connectors.list)).not.toContain('enc:hidden')
    await app.close()
  })

  it('denies connector revoke to roles without operations.manage', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    await db.collection('connector_credentials').insertOne({ tenant_id: 'family-1', connector_id: 'gmail' })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/operator/connectors/gmail/tenants/family-1/revoke', payload: { reason: 'Not allowed for support' } })
    expect(res.statusCode).toBe(403)
    expect(await db.collection('connector_credentials').countDocuments()).toBe(1)
    await app.close()
  })

  it('reads and updates platform configuration with history and audit', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()

    const read = await app.inject({ method: 'GET', url: '/operator/configuration' })
    expect(read.statusCode).toBe(200)
    expect(read.json().config.signups_enabled).toBe(true)

    const noop = await app.inject({ method: 'PUT', url: '/operator/configuration', payload: { signups_enabled: true, reason: 'Already enabled' } })
    expect(noop.statusCode).toBe(400)

    const update = await app.inject({ method: 'PUT', url: '/operator/configuration', payload: { maintenance_mode: true, marketing_paused: true, reason: 'Deploying schema migration' } })
    expect(update.statusCode).toBe(200)
    expect(update.json().config.maintenance_mode).toBe(true)
    expect(update.json().config.signups_enabled).toBe(true)

    const history = await db.collection('platform_config_history').find({}).toArray()
    expect(history).toHaveLength(1)
    expect(history[0]?.['before'].maintenance_mode).toBe(false)
    expect(history[0]?.['after'].maintenance_mode).toBe(true)

    const entry = await db.collection('operator_audit_log').findOne({ action: 'operator.configuration.update' })
    expect(entry?.['reason']).toBe('Deploying schema migration')
    await app.close()
  })

  it('denies configuration changes to roles without configuration.manage', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    const app = await buildApp()
    const res = await app.inject({ method: 'PUT', url: '/operator/configuration', payload: { maintenance_mode: true, reason: 'Ops should not flip this' } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('records infra cost snapshots and reports latest per service', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    const app = await buildApp()

    const denied = await app.inject({ method: 'POST', url: '/operator/infrastructure/snapshots', payload: { service: 'mongodb', monthly_usd: 10, reason: 'no' } })
    expect(denied.statusCode).toBe(400)

    await app.inject({ method: 'POST', url: '/operator/infrastructure/snapshots', payload: { service: 'MongoDB Atlas', monthly_usd: 57, reason: 'October bill' } })
    await app.inject({ method: 'POST', url: '/operator/infrastructure/snapshots', payload: { service: 'mongodb atlas', monthly_usd: 62, reason: 'November bill' } })
    await app.inject({ method: 'POST', url: '/operator/infrastructure/snapshots', payload: { service: 'Firebase', monthly_usd: 12, reason: 'November bill' } })

    const infra = await app.inject({ method: 'GET', url: '/operator/infrastructure' })
    expect(infra.statusCode).toBe(200)
    // Same service name normalizes to one row — latest wins.
    expect(infra.json().services).toHaveLength(2)
    expect(infra.json().total_monthly_usd).toBe(74)
    expect(infra.json().history).toHaveLength(3)

    const entry = await db.collection('operator_audit_log').findOne({ action: 'operator.infrastructure.record_cost' })
    expect(entry).not.toBeNull()
    await app.close()
  })

  it('reports delivery pipeline state and recent failures', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    await db.collection('delivery_queue').insertMany([
      { tenant_id: 'family-1', insight_id: 'ins-1', channel: 'whatsapp', status: 'sent', created_at: new Date() },
      { tenant_id: 'family-1', insight_id: 'ins-2', channel: 'email', status: 'failed', error: 'smtp bounce', updated_at: new Date() },
      { tenant_id: 'family-1', insight_id: 'ins-3', channel: 'push', status: 'queued', created_at: new Date() },
    ])
    const app = await buildApp()
    const ops = await app.inject({ method: 'GET', url: '/operator/operations' })
    const body = ops.json()
    expect(body.delivery_by_state.sent).toBe(1)
    expect(body.delivery_by_state.failed).toBe(1)
    expect(body.failed_deliveries).toHaveLength(1)
    expect(body.failed_deliveries[0].channel).toBe('email')
    expect(JSON.stringify(body.failed_deliveries)).not.toContain('ins-2')
    await app.close()
  })
})

describe('security monitoring', () => {
  it('surfaces locked accounts and supports audited early unlock', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    await db.collection('users').updateOne(
      { id: 'user-2' },
      { $set: { failed_login_attempts: 5, locked_until: new Date(Date.now() + 10 * 60 * 1000) } },
    )
    const app = await buildApp()

    const sec = await app.inject({ method: 'GET', url: '/operator/security' })
    expect(sec.statusCode).toBe(200)
    expect(sec.json().locked_users).toHaveLength(1)
    expect(sec.json().locked_users[0].id).toBe('user-2')
    expect(sec.json().users_with_failed_logins).toBe(1)

    // users list now carries lockout state
    const list = await app.inject({ method: 'GET', url: '/operator/users?q=family@example.com' })
    expect(list.json().users[0].locked_until).toBeDefined()

    const unlock = await app.inject({ method: 'POST', url: '/operator/users/user-2/unlock', payload: { reason: 'Verified identity via support call' } })
    expect(unlock.statusCode).toBe(200)
    const user = await db.collection('users').findOne({ id: 'user-2' })
    expect(user?.['locked_until']).toBeUndefined()
    expect(user?.['failed_login_attempts']).toBe(0)

    const again = await app.inject({ method: 'POST', url: '/operator/users/user-2/unlock', payload: { reason: 'Already unlocked now' } })
    expect(again.statusCode).toBe(404)

    const entry = await db.collection('operator_audit_log').findOne({ action: 'operator.user.unlock' })
    expect(entry?.['target_id']).toBe('user-2')
    await app.close()
  })

  it('denies unlock to roles without users.manage', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/operator/users/user-2/unlock', payload: { reason: 'Support cannot unlock' } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('aggregates 24h login telemetry — failures by IP, first-seen IPs, event feed', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const now = Date.now()
    await db.collection('login_events').insertMany([
      { email: 'family@example.com', user_id: 'user-2', success: false, reason: 'bad_password', ip: '203.0.113.9', created_at: new Date(now - 3600_000) },
      { email: 'family@example.com', user_id: 'user-2', success: false, reason: 'bad_password', ip: '203.0.113.9', created_at: new Date(now - 3500_000) },
      { email: 'operator@example.com', user_id: 'operator-1', success: true, ip: '198.51.100.4', created_at: new Date(now - 1800_000) },
      // A week-old failure — outside the 24h window, must not be counted.
      { email: 'family@example.com', user_id: 'user-2', success: false, reason: 'bad_password', ip: '203.0.113.9', created_at: new Date(now - 7 * 86400_000) },
    ])
    const app = await buildApp()

    const res = await app.inject({ method: 'GET', url: '/operator/security' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.logins_24h).toEqual({ successful: 1, failed: 2 })
    expect(body.failed_by_ip_24h).toEqual([{ ip: '203.0.113.9', count: 2 }])
    expect(body.new_ip_logins_24h).toEqual([{ email: 'operator@example.com', ip: '198.51.100.4', first_seen: expect.any(String) }])
    expect(body.recent_login_events).toHaveLength(4)
    expect(body.recent_login_events[0].success).toBe(true)
    await app.close()
  })

  it('/operator/me resolves the permission union for the operator roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/operator/me' })
    expect(res.statusCode).toBe(200)
    const { permissions } = res.json()
    expect(permissions).toContain('users.read')
    expect(permissions).toContain('audit.read')
    // Support is read-only — manage perms must not resolve.
    expect(permissions).not.toContain('users.manage')
    expect(permissions).not.toContain('operators.manage')
    await app.close()
  })

  it('keyset-paginates users with next_cursor and no overlap', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    // Controlled timestamps — the two seeded users share created_at ~now.
    const base = Date.now() - 60_000
    await db.collection('users').insertMany(
      [0, 1, 2].map((i) => ({
        id: `page-user-${i}`, tenant_id: 'family-1', email: `page${i}@example.com`, name: `Page ${i}`,
        roles: ['member'], status: 'active', created_at: new Date(base - i * 1000),
      })),
    )
    const app = await buildApp()

    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 10; page++) {
      const url = `/operator/users?q=page${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}&limit=2`
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      seen.push(...body.users.map((u: { id: string }) => u.id))
      cursor = body.next_cursor
      if (!cursor) break
    }
    expect(seen).toEqual(['page-user-0', 'page-user-1', 'page-user-2'])
    expect(new Set(seen).size).toBe(3)
    await app.close()
  })

  it('rejects a malformed cursor', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: `/operator/users?cursor=${Buffer.from('not-a-cursor').toString('base64url')}` })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exports a user bundle without credential material', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/operator/users/user-2/export', payload: { reason: 'GDPR data request ticket #42' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.user.id).toBe('user-2')
    expect(body.user.email).toBe('family@example.com')
    expect(body.user.password_hash).toBeUndefined()
    expect(body.user.salt).toBeUndefined()
    expect(body.tenant.tenant_id).toBe('family-1')
    expect(body.members).toHaveLength(1)
    const audit = await db.collection('operator_audit_log').findOne({ action: 'operator.user.export' })
    expect(audit?.['reason']).toBe('GDPR data request ticket #42')
    await app.close()
  })

  it('erases a user — anonymizes, revokes sessions, tombstones the lead', async () => {
    await db.collection('platform_operators').insertMany([
      { user_id: 'operator-1', status: 'active', roles: ['platform_admin'] },
      { user_id: 'user-2', status: 'active', roles: ['support'] },
    ])
    await db.collection('leads').insertOne({ id: 'lead-1', email: 'family@example.com', name: 'Family User', source: 'readiness_quiz', stage: 'new', created_at: new Date() })
    const app = await buildApp()

    const res = await app.inject({ method: 'POST', url: '/operator/users/user-2/erase', payload: { reason: 'Right-to-erasure request #7' } })
    expect(res.statusCode).toBe(200)
    const user = await db.collection('users').findOne({ id: 'user-2' })
    expect(user?.['status']).toBe('erased')
    expect(user?.['email']).toBe('erased-user-2@erased.invalid')
    expect(user?.['name']).toBe('Erased user')
    expect(user?.['password_hash']).toBeUndefined()
    expect(user?.['sessions_revoked_at']).toBeInstanceOf(Date)
    // Operator privileges die with the account.
    expect(await db.collection('platform_operators').findOne({ user_id: 'user-2' })).toBeNull()
    // The lead is tombstoned, not deleted — suppression survives.
    const lead = await db.collection('leads').findOne({ id: 'lead-1' })
    expect(lead?.['email']).toBe('erased-user-2@erased.invalid')
    expect(lead?.['suppressed']).toBe(true)
    const audit = await db.collection('operator_audit_log').findOne({ action: 'operator.user.erase' })
    expect(audit?.['target_id']).toBe('user-2')

    // Idempotent-ish: a second erase refuses rather than re-scrubbing.
    const again = await app.inject({ method: 'POST', url: '/operator/users/user-2/erase', payload: { reason: 'Duplicate request' } })
    expect(again.statusCode).toBe(409)
    await app.close()
  })

  it('refuses self-erasure and denies erase to read-only roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()
    const self = await app.inject({ method: 'POST', url: '/operator/users/operator-1/erase', payload: { reason: 'Must not be allowed' } })
    expect(self.statusCode).toBe(409)
    await app.close()

    const app2 = await buildApp()
    await db.collection('platform_operators').updateOne({ user_id: 'operator-1' }, { $set: { roles: ['support'] } })
    const denied = await app2.inject({ method: 'POST', url: '/operator/users/user-2/erase', payload: { reason: 'Support cannot erase' } })
    expect(denied.statusCode).toBe(403)
    await app2.close()
  })

  it('returns a support dossier with logins, insights, ledger, cases and audit trail', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await db.collection('login_events').insertMany([
      { user_id: 'user-2', tenant_id: 'family-1', success: true, method: 'password', ip: '10.0.0.1', created_at: yesterday },
      { user_id: 'user-2', tenant_id: 'family-1', success: false, method: 'password', ip: '10.0.0.9', created_at: new Date() },
    ])
    await db.collection('insights').insertMany([
      { tenant_id: 'family-1', state: 'sent' }, { tenant_id: 'family-1', state: 'sent' }, { tenant_id: 'family-1', state: 'dismissed' },
    ])
    await db.collection('support_cases').insertOne({
      id: 'case-1', user_id: 'user-2', tenant_id: 'family-1', subject: 'Billing question', status: 'open',
      messages: [{ id: 'm1', author: 'user', text: 'should not be projected', created_at: new Date() }],
      created_at: new Date(), updated_at: new Date(),
    })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/users/user-2' })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.user.email).toBe('family@example.com')
    expect(body.user.password_hash).toBeUndefined()
    expect(body.tenant.tenant_id).toBe('family-1')
    expect(body.dossier.recent_logins).toHaveLength(2)
    expect(body.dossier.insights).toEqual({ sent: 2, dismissed: 1 })
    expect(body.dossier.support_cases).toHaveLength(1)
    expect(body.dossier.support_cases[0].subject).toBe('Billing question')
    // Message bodies are case content, not account context — the dossier
    // shows metadata only; the inbox owns the thread.
    expect(body.dossier.support_cases[0].messages?.[0]?.text).toBeUndefined()
    expect(body.dossier.ledger_tail).toEqual([])
    expect(body.dossier.audit_trail).toEqual([])
    await app.close()
  })

  it('scores tenant health from operational signals and explains deductions', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await db.collection('tenants').updateOne({ tenant_id: 'family-1' }, { $set: { created_at: old } })
    await db.collection('users').updateOne({ id: 'user-2' }, { $set: { created_at: old } })
    await db.collection('reminders').insertOne({ tenant_id: 'family-1', status: 'failed' })
    await db.collection('users').updateOne({ id: 'user-2' }, { $set: { locked_until: new Date(Date.now() + 60_000) } })
    await db.collection('connector_credentials').insertOne({ tenant_id: 'family-1', connector_id: 'bank', token_expires_at: new Date(Date.now() + 60_000) })
    await db.collection('support_cases').insertOne({
      id: 'case-h', user_id: 'user-2', tenant_id: 'family-1', subject: 'Help', status: 'open', messages: [], created_at: new Date(), updated_at: new Date(),
    })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/tenants' })
    expect(response.statusCode).toBe(200)
    const rows = response.json().tenants as { tenant_id: string; health: { score: number; factors: { label: string; points: number }[] } }[]
    const family = rows.find((t) => t.tenant_id === 'family-1')!
    // 100 - 10 (reminder) - 15 (locked) - 20 (token) - 10 (case) - 25 (stale)
    expect(family.health.score).toBe(20)
    expect(family.health.factors.length).toBe(5)
    expect(family.health.factors.map((f) => f.points).every((p) => p < 0)).toBe(true)
    const clean = rows.find((t) => t.tenant_id === 'operator-tenant')!
    expect(clean.health.score).toBe(100)
    expect(clean.health.factors).toEqual([])

    // Same score surfaces on the single-tenant view.
    const detail = await app.inject({ method: 'GET', url: '/operator/tenants/family-1' })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().health.score).toBe(20)
    await app.close()
  })

  it('reports activation steps and median time-to-first-insight for the signup cohort', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    // user-2 (family-1) signed up now in beforeEach. Give family-1 a
    // profile, a connector, and a first insight ~2h after signup.
    const twoHours = 2 * 60 * 60 * 1000
    await db.collection('family_financial_profile').insertOne({ tenant_id: 'family-1', updated_at: new Date() })
    await db.collection('connector_credentials').insertOne({ tenant_id: 'family-1', connector_id: 'bank', token_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) })
    await db.collection('insights').insertOne({ tenant_id: 'family-1', state: 'sent', created_at: new Date(Date.now() + twoHours) })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/funnel' })
    expect(response.statusCode).toBe(200)
    const activation = response.json().activation
    // operator-tenant also has a cohort signup (operator-1) with no profile,
    // insight or connector — so the cohort is 2 signups, half activating.
    expect(activation.cohort_signups_30d).toBe(2)
    const steps = Object.fromEntries(activation.steps.map((s: { key: string; count: number; pct: number }) => [s.key, s]))
    expect(steps.signed_up.count).toBe(2)
    expect(steps.profile_completed.count).toBe(1)
    expect(steps.first_insight.count).toBe(1)
    expect(steps.connector_connected.count).toBe(1)
    expect(steps.profile_completed.pct).toBe(50)
    // First insight timestamp - user-2 signup timestamp ≈ +2h.
    expect(activation.median_time_to_first_insight_hours).toBeCloseTo(2, 0)
    await app.close()
  })

  it('persists alert triage state with an audit entry per action', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const app = await buildApp()

    const empty = await app.inject({ method: 'GET', url: '/operator/alerts' })
    expect(empty.json().alerts).toEqual([])

    const ack = await app.inject({
      method: 'POST', url: '/operator/alerts/state',
      payload: { dedup_key: 'dead_letters', action: 'ack', title: '2 dead-lettered jobs', severity: 'danger', signal_value: 2 },
    })
    expect(ack.statusCode).toBe(200)
    let doc = await db.collection('operator_alerts').findOne({ dedup_key: 'dead_letters' })
    expect(doc?.['status']).toBe('ack')

    const resolve = await app.inject({
      method: 'POST', url: '/operator/alerts/state',
      payload: { dedup_key: 'dead_letters', action: 'resolve', signal_value: 2 },
    })
    expect(resolve.statusCode).toBe(200)
    doc = await db.collection('operator_alerts').findOne({ dedup_key: 'dead_letters' })
    expect(doc?.['status']).toBe('resolved')
    expect(doc?.['resolved_signal_value']).toBe(2)

    const auditCount = await db.collection('operator_audit_log').countDocuments({ action: { $in: ['operator.alert.ack', 'operator.alert.resolve'] } })
    expect(auditCount).toBe(2)

    // Non-operators can't touch triage state.
    const outsider = await buildApp('user-2')
    const denied = await outsider.inject({ method: 'POST', url: '/operator/alerts/state', payload: { dedup_key: 'x', action: 'resolve' } })
    expect(denied.statusCode).toBe(403)
    await outsider.close()
    await app.close()
  })

  it('schedules, exposes, and clears a maintenance window', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['platform_admin'] })
    const app = await buildApp()
    const window = { starts_at: new Date(Date.now() + 3600_000).toISOString(), ends_at: new Date(Date.now() + 7200_000).toISOString(), message: 'DB maintenance' }
    const set = await app.inject({ method: 'PUT', url: '/operator/configuration', payload: { maintenance_window: window, reason: 'Planned DB upgrade' } })
    expect(set.statusCode).toBe(200)
    expect(set.json().config.maintenance_window.message).toBe('DB maintenance')

    // Backwards window rejected.
    const bad = await app.inject({
      method: 'PUT', url: '/operator/configuration',
      payload: { maintenance_window: { starts_at: window.ends_at, ends_at: window.starts_at, message: 'x' }, reason: 'Bad window' },
    })
    expect(bad.statusCode).toBe(400)

    const cleared = await app.inject({ method: 'PUT', url: '/operator/configuration', payload: { maintenance_window: null, reason: 'Maintenance finished early' } })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().config.maintenance_window).toBeNull()
    await app.close()
  })

  it('serves runbook notes alongside operations health', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    const app = await buildApp()
    const response = await app.inject({ method: 'GET', url: '/operator/operations' })
    expect(response.statusCode).toBe(200)
    const runbooks = response.json().runbooks
    expect(runbooks.dead_letters.safe_to_requeue).toContain('Yes')
    expect(runbooks['metrics-rollup'].what).toContain('metrics_daily')
    await app.close()
  })
})
