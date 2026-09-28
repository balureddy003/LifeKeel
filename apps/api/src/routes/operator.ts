import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { OperatorAuditLogger } from '../operator/operator-audit.js'
import { requireOperator, type PlatformRole } from '../operator/operator-auth.js'
import { sendPasswordResetEmail } from '../auth-email.js'
import { recordLedgerEntry, getLedgerHistory } from '../billing/credit-ledger.js'
import { queueManager } from '../queue/QueueManager.js'
import { WEBHOOK_INGEST_QUEUE } from '../queue/WebhookQueue.js'
import { getPlatformConfig, invalidatePlatformConfigCache, CONFIG_DOC_KEY, type PlatformConfig } from '../operator/platform-config.js'
import { getLoginEventsCollection } from '../db.js'

const QuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  /** Exact tenant match — used by the operator "view this tenant's users"
   *  drill-down, where the fuzzy `q` regex would over-match. */
  tenant: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})

const ReasonSchema = z.object({ reason: z.string().trim().min(5).max(500) })

const PLATFORM_ROLES = ['support', 'marketing_operator', 'finance_operator', 'operations', 'platform_admin', 'super_admin'] as const
const RolesSchema = z.array(z.enum(PLATFORM_ROLES)).min(1).max(PLATFORM_ROLES.length)
const OperatorCreateSchema = z.object({ user_id: z.string().trim().min(1).max(100), roles: RolesSchema, reason: z.string().trim().min(5).max(500) })
const OperatorUpdateSchema = z.object({ roles: RolesSchema, reason: z.string().trim().min(5).max(500) })
const LEAD_STAGES = ['new', 'qualified', 'contacted', 'trial', 'converted', 'lost'] as const
const LeadUpdateSchema = z.object({
  stage: z.enum(LEAD_STAGES).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  reason: z.string().trim().min(5).max(500),
})
const LeadQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.enum(LEAD_STAGES).optional(),
  source: z.string().trim().max(60).optional(),
  suppressed: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
})
const PromotionCreateSchema = z.object({
  code: z.string().trim().min(3).max(40).regex(/^[A-Z0-9_-]+$/i, 'Letters, numbers, dashes and underscores only'),
  grant_credits: z.number().int().min(1).max(10000),
  max_uses: z.number().int().min(0).max(1000000).default(0),
  expires_at: z.string().datetime().optional(),
  reason: z.string().trim().min(5).max(500),
})
// Mirrors the public blog schema in blog.ts, plus meta_description for SEO.
const BLOG_CATEGORIES = ['product', 'tutorial', 'case-study', 'news'] as const
const BlogPostWriteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only'),
  content: z.string().min(1).max(200000),
  excerpt: z.string().trim().min(1).max(500),
  category: z.enum(BLOG_CATEGORIES),
  author: z.string().trim().min(1).max(100),
  cover_image: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  meta_description: z.string().trim().max(300).optional(),
})
const BlogPostCreateSchema = BlogPostWriteSchema.extend({ reason: z.string().trim().min(5).max(500) })
const BlogPostUpdateSchema = BlogPostWriteSchema.partial().extend({ reason: z.string().trim().min(5).max(500) })
const CreditAdjustSchema = z.object({
  amount: z.number().int().min(-10000).max(10000).refine((v) => v !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(5).max(500),
})
const AuditQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  target_type: z.string().trim().max(40).optional(),
  target_id: z.string().trim().max(100).optional(),
  operator_user_id: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

function safeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

export async function registerOperatorRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const audit = new OperatorAuditLogger(db)
  const users = db.collection('users')
  const tenants = db.collection('tenants')

  users.createIndex({ created_at: -1 }).catch(() => {})
  users.createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {})
  // Awaited: the promo create path relies on the unique index for duplicate
  // detection, so it can't race registration.
  await Promise.all([
    db.collection('platform_operators').createIndex({ user_id: 1 }, { unique: true }),
    db.collection('promo_codes').createIndex({ code: 1 }, { unique: true }),
    db.collection('leads').createIndex({ email: 1 }, { unique: true }),
  ]).catch(() => {})

  app.get('/operator/me', { preHandler: requireOperator(db, 'overview.read') }, async (request) => ({
    operator: request.operatorContext,
  }))

  app.get('/operator/overview', { preHandler: requireOperator(db, 'overview.read') }, async () => {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      signupsToday,
      signupsWeek,
      totalTenants,
      activeTenants,
      failedPosts,
      queuedPosts,
      recentEvents,
      leadsByStage,
      signupsBySource,
      signupsPrevWeek,
      leadsWeek,
      leadsPrevWeek,
      activityRows,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ status: { $ne: 'suspended' } }),
      users.countDocuments({ status: 'suspended' }),
      users.countDocuments({ created_at: { $gte: dayAgo } }),
      users.countDocuments({ created_at: { $gte: weekAgo } }),
      tenants.countDocuments({}),
      tenants.countDocuments({ status: { $in: ['active', 'trial'] } }),
      db.collection('marketing_posts').countDocuments({ state: 'publish_failed' }),
      db.collection('marketing_posts').countDocuments({ state: { $in: ['draft', 'approved'] } }),
      db.collection('growth_events').aggregate([
        { $match: { created_at: { $gte: weekAgo } } },
        { $group: { _id: '$event', count: { $sum: 1 } } },
        { $project: { _id: 0, event: '$_id', count: 1 } },
      ]).toArray(),
      db.collection('leads').aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]).toArray(),
      users.aggregate([
        { $match: { created_at: { $gte: weekAgo } } },
        { $group: { _id: { $ifNull: ['$attribution.utm_source', 'direct'] }, count: { $sum: 1 } } },
        { $project: { _id: 0, source: '$_id', count: 1 } },
        { $sort: { count: -1 } },
      ]).toArray(),
      // Week-over-week deltas — the command center's "is it working?" chips.
      users.countDocuments({ created_at: { $gte: new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000), $lt: weekAgo } }),
      db.collection('leads').countDocuments({ created_at: { $gte: weekAgo } }),
      db.collection('leads').countDocuments({ created_at: { $gte: new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000), $lt: weekAgo } }),
      // 30-day daily series per funnel event — powers the KPI sparklines.
      db.collection('growth_events').aggregate([
        { $match: { created_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } }, event: '$event' }, count: { $sum: 1 } } },
        { $project: { _id: 0, day: '$_id.day', event: '$_id.event', count: 1 } },
      ]).toArray(),
    ])

    return {
      generated_at: new Date().toISOString(),
      users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers, signups_today: signupsToday, signups_week: signupsWeek, signups_prev_week: signupsPrevWeek },
      tenants: { total: totalTenants, active: activeTenants },
      marketing: { publish_failed: failedPosts, queued: queuedPosts },
      leads: Object.fromEntries(leadsByStage.map((s) => [s['_id'], s['count']])),
      leads_7d: leadsWeek,
      leads_prev_7d: leadsPrevWeek,
      signups_by_source_7d: Object.fromEntries(signupsBySource.map((s) => [s['source'], s['count']])),
      growth_events_7d: recentEvents,
      activity_30d: activityRows,
    }
  })

  app.get('/operator/users', { preHandler: requireOperator(db, 'users.read') }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
    const { q, status, tenant, limit, offset } = parsed.data
    const filter: Record<string, unknown> = {}
    if (q) {
      const pattern = safeRegex(q)
      filter['$or'] = [{ email: pattern }, { name: pattern }, { tenant_id: pattern }, { id: pattern }]
    }
    if (status) filter['status'] = status
    if (tenant) filter['tenant_id'] = tenant
    const [items, total] = await Promise.all([
      users.find(filter, {
        projection: {
          _id: 0, id: 1, email: 1, name: 1, tenant_id: 1, roles: 1, status: 1,
          email_verified: 1, external_provider: 1, created_at: 1, updated_at: 1,
          failed_login_attempts: 1, locked_until: 1, sessions_revoked_at: 1,
          'attribution.utm_source': 1, 'attribution.utm_campaign': 1,
        },
      }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
      users.countDocuments(filter),
    ])
    return { users: items, total, limit, offset }
  })

  app.get<{ Params: { id: string } }>('/operator/users/:id', { preHandler: requireOperator(db, 'users.read') }, async (request, reply) => {
    const user = await users.findOne(
      { id: request.params.id },
      { projection: { password_hash: 0, salt: 0, password_reset_token: 0, email_verification_token: 0 } },
    )
    if (!user) return reply.status(404).send({ error: 'User not found' })
    const tenant = await tenants.findOne({ tenant_id: user['tenant_id'] }, { projection: { _id: 0 } })
    return { user, tenant }
  })

  app.post<{ Params: { id: string } }>('/operator/users/:id/suspend', { preHandler: requireOperator(db, 'users.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    if (request.params.id === request.operatorContext?.user_id) return reply.status(409).send({ error: 'Operators cannot suspend themselves' })
    const result = await users.updateOne(
      { id: request.params.id, status: { $ne: 'suspended' } },
      { $set: { status: 'suspended', suspended_at: new Date(), updated_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'User not found or already suspended' })
    await audit.log(request, 'operator.user.suspend', 'user', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/operator/users/:id/reactivate', { preHandler: requireOperator(db, 'users.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await users.updateOne(
      { id: request.params.id, status: 'suspended' },
      { $set: { status: 'active', reactivated_at: new Date(), updated_at: new Date() }, $unset: { suspended_at: '' } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'User not found or not suspended' })
    await audit.log(request, 'operator.user.reactivate', 'user', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  app.get('/operator/tenants', { preHandler: requireOperator(db, 'tenants.read') }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
    const { q, status, limit, offset } = parsed.data
    const filter: Record<string, unknown> = {}
    if (q) {
      const pattern = safeRegex(q)
      filter['$or'] = [{ tenant_id: pattern }, { id: pattern }, { name: pattern }]
    }
    if (status) filter['status'] = status
    const [items, total] = await Promise.all([
      tenants.find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
      tenants.countDocuments(filter),
    ])
    const tenantIds = items.map((item) => item['tenant_id'] as string).filter(Boolean)
    const memberCounts = tenantIds.length === 0 ? [] : await users.aggregate([
      { $match: { tenant_id: { $in: tenantIds } } },
      { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
    ]).toArray()
    const counts = new Map(memberCounts.map((item) => [item['_id'] as string, item['count'] as number]))
    return { tenants: items.map((item) => ({ ...item, user_count: counts.get(item['tenant_id'] as string) ?? 0 })), total, limit, offset }
  })

  app.get<{ Params: { id: string } }>('/operator/tenants/:id', { preHandler: requireOperator(db, 'tenants.read') }, async (request, reply) => {
    const tenant = await tenants.findOne({ $or: [{ tenant_id: request.params.id }, { id: request.params.id }] }, { projection: { _id: 0 } })
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
    const members = await users.find(
      { tenant_id: tenant['tenant_id'] },
      { projection: { _id: 0, id: 1, email: 1, name: 1, roles: 1, status: 1, created_at: 1 } },
    ).sort({ created_at: 1 }).toArray()
    return { tenant, members }
  })

  /** Suspending a tenant blocks every request for all of its users — the
   *  auth middleware requires status active|trial. */
  app.post<{ Params: { id: string } }>('/operator/tenants/:id/suspend', { preHandler: requireOperator(db, 'tenants.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await tenants.updateOne(
      { $or: [{ tenant_id: request.params.id }, { id: request.params.id }], status: { $ne: 'suspended' } },
      { $set: { status: 'suspended', suspended_at: new Date(), updated_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Tenant not found or already suspended' })
    await audit.log(request, 'operator.tenant.suspend', 'tenant', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/operator/tenants/:id/reactivate', { preHandler: requireOperator(db, 'tenants.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await tenants.updateOne(
      { $or: [{ tenant_id: request.params.id }, { id: request.params.id }], status: 'suspended' },
      { $set: { status: 'active', reactivated_at: new Date(), updated_at: new Date() }, $unset: { suspended_at: '' } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Tenant not found or not suspended' })
    await audit.log(request, 'operator.tenant.reactivate', 'tenant', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  /** Trigger the standard password-reset email for a user — same token shape
   *  and 1h expiry as the self-service flow. */
  app.post<{ Params: { id: string } }>('/operator/users/:id/password-reset', { preHandler: requireOperator(db, 'users.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const user = await users.findOne({ id: request.params.id })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    const token = randomBytes(32).toString('hex')
    await users.updateOne(
      { id: request.params.id },
      { $set: { password_reset_token: token, password_reset_expires: new Date(Date.now() + 60 * 60 * 1000), updated_at: new Date() } },
    )
    const appUrl = (process.env['AGENT_OAK_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
    await sendPasswordResetEmail(user['email'] as string, user['name'] as string, `${appUrl}/reset-password/confirm?token=${token}`)
    await audit.log(request, 'operator.user.password_reset', 'user', request.params.id, parsed.data.reason)
    return { sent: true }
  })

  /** Kill every outstanding JWT for a user without suspending the account —
   *  stamps sessions_revoked_at, and the auth middleware rejects any token
   *  issued at or before that instant. New logins still work. */
  app.post<{ Params: { id: string } }>('/operator/users/:id/revoke-sessions', { preHandler: requireOperator(db, 'users.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await users.updateOne(
      { id: request.params.id },
      { $set: { sessions_revoked_at: new Date(), updated_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'User not found' })
    await audit.log(request, 'operator.user.revoke_sessions', 'user', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  /** Clear a login lockout early — the lock is a brute-force control, so an
   *  operator lift needs a reason and an audit entry like any other
   *  security-relevant action. */
  app.post<{ Params: { id: string } }>('/operator/users/:id/unlock', { preHandler: requireOperator(db, 'users.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await users.updateOne(
      { id: request.params.id, $or: [{ locked_until: { $gt: new Date() } }, { failed_login_attempts: { $gt: 0 } }] },
      { $set: { failed_login_attempts: 0, updated_at: new Date() }, $unset: { locked_until: '' } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'User not found or not locked' })
    await audit.log(request, 'operator.user.unlock', 'user', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  /** Account security posture: active lockouts, users accumulating failed
   *  attempts, suspensions, session revocations, and 24h login telemetry
   *  (failure hotspots by IP, first-seen IPs, recent event feed). */
  app.get('/operator/security', { preHandler: requireOperator(db, 'users.read') }, async () => {
    const now = new Date()
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const loginEvents = getLoginEventsCollection(db)
    const [locked, withFailures, suspended, revoked7d, failed24h, success24h, failedByIp, newIpLogins, recentEvents] = await Promise.all([
      users.find(
        { locked_until: { $gt: now } },
        { projection: { _id: 0, id: 1, email: 1, tenant_id: 1, failed_login_attempts: 1, locked_until: 1 } },
      ).sort({ locked_until: -1 }).limit(50).toArray(),
      users.countDocuments({ failed_login_attempts: { $gt: 0 } }),
      users.countDocuments({ status: 'suspended' }),
      users.countDocuments({ sessions_revoked_at: { $gte: weekAgo } }),
      loginEvents.countDocuments({ success: false, created_at: { $gte: dayAgo } }),
      loginEvents.countDocuments({ success: true, created_at: { $gte: dayAgo } }),
      // Credential-stuffing signal: which IPs are generating failures.
      loginEvents.aggregate([
        { $match: { success: false, created_at: { $gte: dayAgo } } },
        { $group: { _id: '$ip', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        { $project: { _id: 0, ip: '$_id', count: 1 } },
      ]).toArray(),
      // Account-takeover signal: successful logins from an (email, ip) pair
      // first seen inside the last 24h. Bounded — a brand-new deploy reports
      // every login as "new IP" until the collection accumulates history.
      loginEvents.aggregate([
        { $match: { success: true, email: { $exists: true } } },
        { $group: { _id: { email: '$email', ip: '$ip' }, first_seen: { $min: '$created_at' } } },
        { $match: { first_seen: { $gte: dayAgo } } },
        { $sort: { first_seen: -1 } },
        { $limit: 20 },
        { $project: { _id: 0, email: '$_id.email', ip: '$_id.ip', first_seen: 1 } },
      ]).toArray(),
      loginEvents.find(
        {},
        { projection: { _id: 0, email: 1, success: 1, reason: 1, ip: 1, user_agent: 1, created_at: 1 } },
      ).sort({ created_at: -1 }).limit(15).toArray(),
    ])
    return {
      generated_at: now.toISOString(),
      locked_users: locked,
      users_with_failed_logins: withFailures,
      suspended_users: suspended,
      sessions_revoked_7d: revoked7d,
      logins_24h: { successful: success24h, failed: failed24h },
      failed_by_ip_24h: failedByIp,
      new_ip_logins_24h: newIpLogins,
      recent_login_events: recentEvents,
    }
  })

  // ── Platform operator management (super_admin) ──────────────────────────

  const operators = db.collection('platform_operators')

  app.get('/operator/operators', { preHandler: requireOperator(db, 'operators.manage') }, async () => {
    const docs = await operators.find({}, { projection: { _id: 0 } }).toArray()
    const dbIds = new Set(docs.map((d) => d['user_id'] as string))
    // Env ids with a DB record are governed by that record — listing them
    // under both sections would suggest the env entry still means something.
    const bootstrapIds = (process.env['PLATFORM_OPERATOR_USER_IDS'] ?? '').split(',').map((s) => s.trim()).filter((id) => id && !dbIds.has(id))
    // Break-glass semantics: env ids resolve only while no active DB
    // super_admin exists (see resolveOperator), so mark them dormant here.
    const dbSuperAdminExists = docs.some((d) => d['status'] === 'active' && (d['roles'] as string[] | undefined)?.includes('super_admin'))
    const ids = new Set([...dbIds, ...bootstrapIds])
    const profiles = ids.size === 0 ? [] : await users.find(
      { id: { $in: [...ids] } },
      { projection: { _id: 0, id: 1, email: 1, name: 1, status: 1 } },
    ).toArray()
    const byId = new Map(profiles.map((u) => [u['id'] as string, u]))
    return {
      operators: docs.map((d) => ({ ...d, source: 'database', user: byId.get(d['user_id'] as string) ?? null })),
      bootstrap: bootstrapIds.map((id) => ({ user_id: id, roles: ['super_admin'], status: 'active', source: 'bootstrap', effective: !dbSuperAdminExists, user: byId.get(id) ?? null })),
    }
  })

  app.post('/operator/operators', { preHandler: requireOperator(db, 'operators.manage') }, async (request, reply) => {
    const parsed = OperatorCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid operator', issues: parsed.error.issues })
    const { user_id, roles, reason } = parsed.data
    const user = await users.findOne({ id: user_id }, { projection: { _id: 0, id: 1, email: 1, name: 1 } })
    if (!user) return reply.status(404).send({ error: 'User not found' })
    await operators.updateOne(
      { user_id },
      { $set: { roles, status: 'active', updated_at: new Date() }, $setOnInsert: { user_id, created_at: new Date() } },
      { upsert: true },
    )
    await audit.log(request, 'operator.operator.create', 'operator', user_id, reason, { roles })
    return { ok: true, user }
  })

  app.patch<{ Params: { id: string } }>('/operator/operators/:id', { preHandler: requireOperator(db, 'operators.manage') }, async (request, reply) => {
    const parsed = OperatorUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid roles', issues: parsed.error.issues })
    const targetId = request.params.id
    if (targetId === request.operatorContext?.user_id) return reply.status(409).send({ error: 'Operators cannot change their own roles' })
    const target = await operators.findOne({ user_id: targetId })
    if (!target) return reply.status(404).send({ error: 'Operator not found' })
    if (!await anotherSuperAdminExists(targetId, (target['roles'] as PlatformRole[] | undefined) ?? [])) {
      return reply.status(409).send({ error: 'Cannot remove the last super_admin' })
    }
    await operators.updateOne({ user_id: targetId }, { $set: { roles: parsed.data.roles, updated_at: new Date() } })
    await audit.log(request, 'operator.operator.update_roles', 'operator', targetId, parsed.data.reason, { roles: parsed.data.roles })
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/operator/operators/:id/suspend', { preHandler: requireOperator(db, 'operators.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const targetId = request.params.id
    if (targetId === request.operatorContext?.user_id) return reply.status(409).send({ error: 'Operators cannot suspend themselves' })
    const target = await operators.findOne({ user_id: targetId })
    if (!target) return reply.status(404).send({ error: 'Operator not found' })
    if (!await anotherSuperAdminExists(targetId, (target['roles'] as PlatformRole[] | undefined) ?? [])) {
      return reply.status(409).send({ error: 'Cannot suspend the last super_admin' })
    }
    await operators.updateOne({ user_id: targetId }, { $set: { status: 'suspended', updated_at: new Date() } })
    await audit.log(request, 'operator.operator.suspend', 'operator', targetId, parsed.data.reason)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/operator/operators/:id/reactivate', { preHandler: requireOperator(db, 'operators.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await operators.updateOne(
      { user_id: request.params.id, status: 'suspended' },
      { $set: { status: 'active', updated_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Operator not found or not suspended' })
    await audit.log(request, 'operator.operator.reactivate', 'operator', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  /** True when demoting/suspending `targetId` still leaves an active
   *  super_admin — counting DB operators plus the env bootstrap. */
  async function anotherSuperAdminExists(targetId: string, targetRoles: PlatformRole[]): Promise<boolean> {
    if (!targetRoles.includes('super_admin')) return true
    const others = await operators.countDocuments({ user_id: { $ne: targetId }, status: 'active', roles: 'super_admin' })
    if (others > 0) return true
    return (process.env['PLATFORM_OPERATOR_USER_IDS'] ?? '').split(',').map((s) => s.trim()).filter((id) => id && id !== targetId).length > 0
  }

  // ── Leads ───────────────────────────────────────────────────────────────

  const leads = db.collection('leads')

  app.get('/operator/leads', { preHandler: requireOperator(db, 'leads.read') }, async (request, reply) => {
    const parsed = LeadQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
    const { q, stage, source, suppressed, limit, offset } = parsed.data
    const filter: Record<string, unknown> = {}
    if (q) {
      const pattern = safeRegex(q)
      filter['$or'] = [{ email: pattern }, { name: pattern }, { id: pattern }]
    }
    if (stage) filter['stage'] = stage
    if (source) filter['source'] = source
    if (suppressed) filter['suppressed'] = suppressed === 'true'
    const [items, total, stageCounts, sourceCounts] = await Promise.all([
      leads.find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
      leads.countDocuments(filter),
      leads.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]).toArray(),
      leads.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]).toArray(),
    ])
    return {
      leads: items,
      total,
      limit,
      offset,
      stages: Object.fromEntries(stageCounts.map((s) => [s['_id'], s['count']])),
      sources: Object.fromEntries(sourceCounts.map((s) => [s['_id'], s['count']])),
    }
  })

  /** Stage moves and notes share one endpoint; reason is required either way
   *  and the change is audited. */
  app.patch<{ Params: { id: string } }>('/operator/leads/:id', { preHandler: requireOperator(db, 'leads.manage') }, async (request, reply) => {
    const parsed = LeadUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
    const { stage, note, reason } = parsed.data
    if (stage === undefined && note === undefined) {
      return reply.status(400).send({ error: 'Provide a stage, a note, or both' })
    }
    const lead = await leads.findOne({ id: request.params.id })
    if (!lead) return reply.status(404).send({ error: 'Lead not found' })

    const update: Record<string, unknown> = { $set: { updated_at: new Date() } }
    if (stage !== undefined) (update['$set'] as Record<string, unknown>)['stage'] = stage
    if (note !== undefined) {
      update['$push'] = {
        notes: {
          text: note,
          author_id: request.operatorContext?.user_id,
          created_at: new Date(),
        },
      }
    }
    await leads.updateOne({ id: request.params.id }, update)
    if (stage !== undefined) {
      await audit.log(request, 'operator.lead.update_stage', 'lead', request.params.id, reason, {
        from: lead['stage'], to: stage,
      })
    }
    if (note !== undefined) {
      await audit.log(request, 'operator.lead.add_note', 'lead', request.params.id, reason)
    }
    const updated = await leads.findOne({ id: request.params.id }, { projection: { _id: 0 } })
    return { lead: updated }
  })

  /** Suppression is the operator-side unsubscribe/do-not-contact flag. It is
   *  never cleared by re-capture — the public /leads upsert doesn't touch it. */
  app.post<{ Params: { id: string } }>('/operator/leads/:id/suppress', { preHandler: requireOperator(db, 'leads.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await leads.updateOne(
      { id: request.params.id, suppressed: { $ne: true } },
      { $set: { suppressed: true, suppressed_at: new Date(), updated_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Lead not found or already suppressed' })
    await audit.log(request, 'operator.lead.suppress', 'lead', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  /** Full lead record for the detail drawer — includes consent,
   *  attribution, and the notes timeline. */
  app.get<{ Params: { id: string } }>('/operator/leads/:id', { preHandler: requireOperator(db, 'leads.read') }, async (request, reply) => {
    const lead = await leads.findOne({ id: request.params.id }, { projection: { _id: 0 } })
    if (!lead) return reply.status(404).send({ error: 'Lead not found' })
    return { lead }
  })

  // ── Growth funnel ───────────────────────────────────────────────────────

  /** Lead → signup → activated → paying over a rolling 30d window.
   *  "Activated" = the tenant has at least one insight (the product did
   *  something for them). "Paying" = plan not free/trial. Per-source rows
   *  join users' attribution to leads' source where both exist. */
  app.get('/operator/funnel', { preHandler: requireOperator(db, 'overview.read') }, async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [leadStages, leadSources, signupSources, signups30d, leads30d, activated, paying] = await Promise.all([
      leads.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]).toArray(),
      leads.aggregate([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]).toArray(),
      users.aggregate([
        { $match: { created_at: { $gte: since } } },
        { $group: { _id: { $ifNull: ['$attribution.utm_source', 'direct'] }, count: { $sum: 1 } } },
      ]).toArray(),
      users.countDocuments({ created_at: { $gte: since } }),
      leads.countDocuments({ created_at: { $gte: since } }),
      db.collection('insights').distinct('tenant_id'),
      tenants.countDocuments({ plan: { $exists: true, $nin: ['free', 'trial'] } }),
    ])
    const sources = new Map<string, { source: string; leads: number; signups: number }>()
    for (const s of leadSources) {
      const key = (s['_id'] as string) ?? 'unknown'
      sources.set(key, { source: key, leads: s['count'] as number, signups: 0 })
    }
    for (const s of signupSources) {
      const key = (s['_id'] as string) ?? 'direct'
      const row = sources.get(key) ?? { source: key, leads: 0, signups: 0 }
      row.signups = s['count'] as number
      sources.set(key, row)
    }
    return {
      window_days: 30,
      totals: {
        leads_30d: leads30d,
        signups_30d: signups30d,
        activated_tenants: activated.length,
        paying_tenants: paying,
      },
      leads_by_stage: Object.fromEntries(leadStages.map((s) => [s['_id'], s['count']])),
      by_source: [...sources.values()].sort((a, b) => b.signups - a.signups),
    }
  })

  // ── Promotions ──────────────────────────────────────────────────────────
  // Doc shape matches the redemption path in billing/promo-codes.ts:
  // { code, grant_credits, max_uses, used_count, active, expires_at?, created_at }.

  const promotions = db.collection('promo_codes')
  const redemptions = db.collection('promo_redemptions')

  app.get('/operator/promotions', { preHandler: requireOperator(db, 'promotions.read') }, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
    const { q, limit, offset } = parsed.data
    const filter: Record<string, unknown> = q ? { code: safeRegex(q) } : {}
    const [items, total] = await Promise.all([
      promotions.find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
      promotions.countDocuments(filter),
    ])
    return { promotions: items, total, limit, offset }
  })

  app.get<{ Params: { code: string } }>('/operator/promotions/:code/redemptions', { preHandler: requireOperator(db, 'promotions.read') }, async (request, reply) => {
    const code = request.params.code.trim().toUpperCase()
    const promo = await promotions.findOne({ code }, { projection: { _id: 0 } })
    if (!promo) return reply.status(404).send({ error: 'Promotion not found' })
    const items = await redemptions.find({ code }, { projection: { _id: 0 } }).sort({ redeemed_at: -1 }).limit(200).toArray()
    return { promotion: promo, redemptions: items }
  })

  app.post('/operator/promotions', { preHandler: requireOperator(db, 'promotions.manage') }, async (request, reply) => {
    const parsed = PromotionCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid promotion', issues: parsed.error.issues })
    const { code, grant_credits, max_uses, expires_at, reason } = parsed.data
    const normalized = code.toUpperCase()
    try {
      await promotions.insertOne({
        code: normalized,
        grant_credits,
        max_uses,
        used_count: 0,
        active: true,
        ...(expires_at ? { expires_at: new Date(expires_at) } : {}),
        created_by: request.operatorContext?.user_id,
        created_at: new Date(),
      })
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return reply.status(409).send({ error: 'A promotion with that code already exists' })
      }
      throw err
    }
    await audit.log(request, 'operator.promotion.create', 'promotion', normalized, reason, { grant_credits, max_uses })
    return { ok: true, code: normalized }
  })

  app.post<{ Params: { code: string } }>('/operator/promotions/:code/deactivate', { preHandler: requireOperator(db, 'promotions.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const code = request.params.code.trim().toUpperCase()
    const result = await promotions.updateOne({ code, active: true }, { $set: { active: false, deactivated_at: new Date() } })
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Promotion not found or already inactive' })
    await audit.log(request, 'operator.promotion.deactivate', 'promotion', code, parsed.data.reason)
    return { ok: true }
  })

  app.post<{ Params: { code: string } }>('/operator/promotions/:code/reactivate', { preHandler: requireOperator(db, 'promotions.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const code = request.params.code.trim().toUpperCase()
    const result = await promotions.updateOne({ code, active: false }, { $set: { active: true }, $unset: { deactivated_at: '' } })
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Promotion not found or already active' })
    await audit.log(request, 'operator.promotion.reactivate', 'promotion', code, parsed.data.reason)
    return { ok: true }
  })

  // ── Blog / SEO content ──────────────────────────────────────────────────
  // Operator-managed replacement for the parked admin-key write surface in
  // blog.ts — same collection, same doc shape, but permissioned, reasoned,
  // and audited. Public GETs stay untouched.

  const blogPosts = db.collection('blog_posts')
  await blogPosts.createIndex({ slug: 1 }, { unique: true }).catch(() => {})

  app.get('/operator/blog/posts', { preHandler: requireOperator(db, 'marketing.read') }, async () => {
    const posts = await blogPosts
      .find({}, { projection: { _id: 0, content: 0 } })
      .sort({ created_at: -1 })
      .limit(200)
      .toArray()
    return { posts }
  })

  app.get<{ Params: { id: string } }>('/operator/blog/posts/:id', { preHandler: requireOperator(db, 'marketing.read') }, async (request, reply) => {
    const post = await blogPosts.findOne({ id: request.params.id }, { projection: { _id: 0 } })
    if (!post) return reply.status(404).send({ error: 'Post not found' })
    return { post }
  })

  app.post('/operator/blog/posts', { preHandler: requireOperator(db, 'marketing.manage') }, async (request, reply) => {
    const parsed = BlogPostCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid post', issues: parsed.error.issues })
    const { reason, ...data } = parsed.data
    const now = new Date()
    const post = {
      id: randomBytes(8).toString('hex'),
      ...data,
      published: false,
      created_by: request.operatorContext?.user_id,
      created_at: now,
      updated_at: now,
    }
    try {
      await blogPosts.insertOne(post)
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return reply.status(409).send({ error: 'A post with that slug already exists' })
      }
      throw err
    }
    await audit.log(request, 'operator.blog.create', 'blog_post', post.id, reason, { slug: post.slug, title: post.title })
    return { post }
  })

  app.patch<{ Params: { id: string } }>('/operator/blog/posts/:id', { preHandler: requireOperator(db, 'marketing.manage') }, async (request, reply) => {
    const parsed = BlogPostUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
    const { reason, ...data } = parsed.data
    if (Object.keys(data).length === 0) return reply.status(400).send({ error: 'Nothing to update' })
    const result = await blogPosts.updateOne({ id: request.params.id }, { $set: { ...data, updated_at: new Date() } })
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Post not found' })
    await audit.log(request, 'operator.blog.update', 'blog_post', request.params.id, reason, { fields: Object.keys(data) })
    const post = await blogPosts.findOne({ id: request.params.id }, { projection: { _id: 0 } })
    return { post }
  })

  app.post<{ Params: { id: string } }>('/operator/blog/posts/:id/publish', { preHandler: requireOperator(db, 'marketing.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await blogPosts.updateOne(
      { id: request.params.id, published: { $ne: true } },
      { $set: { published: true, published_at: new Date(), updated_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Post not found or already published' })
    await audit.log(request, 'operator.blog.publish', 'blog_post', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  app.post<{ Params: { id: string } }>('/operator/blog/posts/:id/unpublish', { preHandler: requireOperator(db, 'marketing.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await blogPosts.updateOne(
      { id: request.params.id, published: true },
      { $set: { published: false, updated_at: new Date() }, $unset: { published_at: '' } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Post not found or not published' })
    await audit.log(request, 'operator.blog.unpublish', 'blog_post', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  // ── Billing ─────────────────────────────────────────────────────────────
  // Read-mostly: plan/status distribution, credit exposure, Stripe webhook
  // intake. The only mutation is a bounded, ledger-recorded credit
  // adjustment — Stripe remains authoritative for subscriptions.

  app.get('/operator/billing', { preHandler: requireOperator(db, 'billing.read') }, async () => {
    const [byPlan, byStatus, stripeLinked, lowCredit, creditsOutstanding, recentWebhooks, recentAdjustments] = await Promise.all([
      tenants.aggregate([{ $group: { _id: { $ifNull: ['$plan', 'unknown'] }, count: { $sum: 1 } } }]).toArray(),
      tenants.aggregate([{ $group: { _id: { $ifNull: ['$status', 'unknown'] }, count: { $sum: 1 } } }]).toArray(),
      tenants.countDocuments({ stripe_customer_id: { $exists: true, $ne: null } }),
      // LOW_CREDIT_THRESHOLD in billing-constants is 3 — unlimited plans
      // (MAX_SAFE_INTEGER) can't match $lte so they're naturally excluded.
      tenants.countDocuments({ 'billing.credits_balance': { $lte: 3 } }),
      tenants.aggregate([
        { $group: { _id: null, total: { $sum: { $cond: [{ $eq: ['$billing.credits_balance', Number.MAX_SAFE_INTEGER] }, 0, { $ifNull: ['$billing.credits_balance', 0] }] } } } },
      ]).toArray(),
      db.collection('stripe_webhook_events').find({}, { projection: { _id: 0 } }).sort({ processed_at: -1 }).limit(20).toArray(),
      db.collection('credit_ledger').find({ type: 'admin_adjustment' }, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(10).toArray(),
    ])
    return {
      generated_at: new Date().toISOString(),
      tenants_by_plan: Object.fromEntries(byPlan.map((p) => [p['_id'], p['count']])),
      tenants_by_status: Object.fromEntries(byStatus.map((s) => [s['_id'], s['count']])),
      stripe_linked_tenants: stripeLinked,
      low_credit_tenants: lowCredit,
      credits_outstanding: Number(creditsOutstanding[0]?.['total'] ?? 0),
      recent_webhooks: recentWebhooks,
      recent_adjustments: recentAdjustments,
    }
  })

  app.get<{ Params: { id: string } }>('/operator/billing/tenants/:id', { preHandler: requireOperator(db, 'billing.read') }, async (request, reply) => {
    const tenant = await tenants.findOne(
      { $or: [{ tenant_id: request.params.id }, { id: request.params.id }] },
      { projection: { _id: 0, tenant_id: 1, name: 1, plan: 1, status: 1, billing: 1, stripe_customer_id: 1, stripe_subscription_id: 1, created_at: 1 } },
    )
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
    const ledger = await getLedgerHistory(db, { tenantId: tenant['tenant_id'] as string, limit: 50 })
    return { tenant, ledger: ledger.entries, ledger_has_more: ledger.has_more }
  })

  /** Manual credit adjustment. Bounded (±10k), never takes the balance
   *  negative, always ledgered (when billing v2 is on) and audited. */
  app.post<{ Params: { id: string } }>('/operator/billing/tenants/:id/adjust-credits', { preHandler: requireOperator(db, 'billing.manage') }, async (request, reply) => {
    const parsed = CreditAdjustSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid adjustment', issues: parsed.error.issues })
    const { amount, reason } = parsed.data

    const tenant = await tenants.findOne({ $or: [{ tenant_id: request.params.id }, { id: request.params.id }] })
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
    const tenantId = tenant['tenant_id'] as string
    if (tenant['billing']?.['credits_balance'] === Number.MAX_SAFE_INTEGER) {
      return reply.status(409).send({ error: 'Unlimited plan — balance adjustments do not apply' })
    }

    // Negative adjustments claim atomically against the balance so the
    // result can never go below zero (same shape as the C2 charge guard).
    const filter: Record<string, unknown> = amount < 0
      ? { tenant_id: tenantId, 'billing.credits_balance': { $gte: -amount } }
      : { tenant_id: tenantId }
    const updated = await tenants.findOneAndUpdate(
      filter,
      { $inc: { 'billing.credits_balance': amount }, $set: { updated_at: new Date() } },
      { returnDocument: 'after' },
    )
    if (!updated) return reply.status(409).send({ error: 'Insufficient credit balance for this adjustment' })

    // Ledger entry must follow the balance mutation so balance_after is
    // correct. No-ops when BILLING_V2_ENABLED is off (documented fallback).
    await recordLedgerEntry(db, {
      tenantId,
      type: 'admin_adjustment',
      amount,
      reference: `operator:${request.operatorContext?.user_id ?? 'unknown'}`,
      reason,
      actor: request.operatorContext?.user_id ?? 'unknown',
    }).catch(() => {})
    await audit.log(request, 'operator.billing.adjust_credits', 'tenant', tenantId, reason, { amount })

    return { ok: true, credits_balance: updated['billing']?.['credits_balance'] }
  })

  // ── Operator audit + operations health ──────────────────────────────────

  app.get('/operator/audit', { preHandler: requireOperator(db, 'audit.read') }, async (request, reply) => {
    const parsed = AuditQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
    const { action, target_type, target_id, operator_user_id, limit, offset } = parsed.data
    const filter: Record<string, unknown> = {}
    if (action) filter['action'] = action
    if (target_type) filter['target_type'] = target_type
    if (target_id) filter['target_id'] = target_id
    if (operator_user_id) filter['operator_user_id'] = operator_user_id
    const col = db.collection('operator_audit_log')
    const [items, total] = await Promise.all([
      col.find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
      col.countDocuments(filter),
    ])
    return { entries: items, total, limit, offset }
  })

  /** Read-only operational health: process, datastore, job leases,
   *  per-state pipeline counts, reminder delivery, connector credentials,
   *  and Redis queue depth. External provider metrics are out of scope. */
  app.get('/operator/operations', { preHandler: requireOperator(db, 'operations.read') }, async () => {
    const pingStart = Date.now()
    let mongoOk = true
    try { await db.command({ ping: 1 }) } catch { mongoOk = false }
    const mongoPingMs = Date.now() - pingStart

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    // A 'sending' reminder claim older than STALE_CLAIM_MS (10min, same
    // value as policy-renewal-reminders.ts) means the worker crashed
    // mid-dispatch — the next run recovers it, but it should be visible.
    const staleClaimCutoff = new Date(Date.now() - 10 * 60 * 1000)
    const tokenExpiryHorizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    const [
      insightsByState, postsByState, cronLocks, events24h, pendingDocs,
      remindersByState, failedReminders, staleClaims,
      connectorsById, expiringTokens, connectorList, failedPosts, queueStats,
      deliveryByState, failedDeliveries,
    ] = await Promise.all([
      db.collection('insights').aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }]).toArray(),
      db.collection('marketing_posts').aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }]).toArray(),
      db.collection('cron_locks').find({}, { projection: { _id: 0 } }).limit(50).toArray(),
      db.collection('growth_events').countDocuments({ created_at: { $gte: dayAgo } }),
      db.collection('documents').countDocuments({ status: { $in: ['pending', 'processing'] } }),
      db.collection('reminders').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
      db.collection('reminders').find(
        { status: 'failed' },
        { projection: { _id: 0, id: 1, tenant_id: 1, due_at: 1, attempts: 1, last_error: 1, 'policy.type': 1, 'policy.provider': 1 } },
      ).sort({ updated_at: -1 }).limit(20).toArray(),
      db.collection('reminders').countDocuments({ status: 'sending', updated_at: { $lt: staleClaimCutoff } }),
      db.collection('connector_credentials').aggregate([
        { $group: { _id: '$connector_id', count: { $sum: 1 } } },
        { $project: { _id: 0, connector_id: '$_id', count: 1 } },
      ]).toArray(),
      db.collection('connector_credentials').countDocuments({ token_expires_at: { $lt: tokenExpiryHorizon } }),
      // Operator-visible connector inventory — metadata only, never the
      // encrypted credential fields.
      db.collection('connector_credentials').find(
        {},
        { projection: { _id: 0, tenant_id: 1, connector_id: 1, auth_type: 1, token_expires_at: 1, created_at: 1 } },
      ).sort({ created_at: -1 }).limit(50).toArray(),
      db.collection('marketing_posts').find(
        { state: 'publish_failed' },
        { projection: { _id: 0, id: 1, channel: 1, publish_error: 1, updated_at: 1 } },
      ).sort({ updated_at: -1 }).limit(10).toArray(),
      queueManager.inspect(WEBHOOK_INGEST_QUEUE),
      // Outbound delivery pipeline (WhatsApp/SMS/email/push escalations) —
      // status counts plus recent failures. insight bodies stay out of the
      // projection; operators get the channel and error only.
      db.collection('delivery_queue').aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
      db.collection('delivery_queue').find(
        { status: 'failed' },
        { projection: { _id: 0, insight_id: 0, target: 0 } },
      ).sort({ updated_at: -1 }).limit(10).toArray(),
    ])

    const now = new Date()
    return {
      generated_at: now.toISOString(),
      process: { uptime_seconds: Math.round(process.uptime()), rss_bytes: process.memoryUsage().rss },
      mongo: { ok: mongoOk, ping_ms: mongoPingMs },
      insights_by_state: Object.fromEntries(insightsByState.map((i) => [i['_id'], i['count']])),
      marketing_posts_by_state: Object.fromEntries(postsByState.map((i) => [i['_id'], i['count']])),
      cron_locks: cronLocks.map((lock) => ({
        ...lock,
        // An expired-but-present lock doc means the holder crashed without
        // releasing — the lock self-heals on next acquire, but it's a
        // signal that a job died mid-run.
        stale: lock['expires_at'] instanceof Date && lock['expires_at'] < now,
      })),
      reminders_by_state: Object.fromEntries(remindersByState.map((i) => [i['_id'], i['count']])),
      failed_reminders: failedReminders,
      stale_reminder_claims: staleClaims,
      connectors: {
        by_connector: Object.fromEntries(connectorsById.map((c) => [c['connector_id'], c['count']])),
        // Credential values never leave the API — only the count of tokens
        // expiring within 7 days, so an operator knows to expect reconnects.
        expiring_tokens_7d: expiringTokens,
        list: connectorList,
      },
      delivery_by_state: Object.fromEntries(deliveryByState.map((i) => [i['_id'], i['count']])),
      failed_deliveries: failedDeliveries,
      failed_posts: failedPosts,
      queue: queueStats ? { available: true as const, ...queueStats } : { available: false as const },
      growth_events_24h: events24h,
      documents_pending: pendingDocs,
    }
  })

  /** Manual retry of a failed reminder delivery — resets it to 'scheduled'
   *  with zeroed attempts so the next dispatcher run takes a fresh shot.
   *  Audited like every other operator mutation. */
  app.post<{ Params: { id: string } }>('/operator/reminders/:id/retry', { preHandler: requireOperator(db, 'operations.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    const result = await db.collection('reminders').updateOne(
      { id: request.params.id, status: 'failed' },
      { $set: { status: 'scheduled', attempts: 0, next_attempt_at: new Date(), updated_at: new Date() }, $unset: { last_error: '' } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'Reminder not found or not failed' })
    await audit.log(request, 'operator.reminder.retry', 'reminder', request.params.id, parsed.data.reason)
    return { ok: true }
  })

  /** Requeue a dead-lettered job. The queue name is whitelisted so this
   *  endpoint can't reach arbitrary Redis keys; attempts reset to 0. */
  const REQUEUEABLE_QUEUES = new Set([WEBHOOK_INGEST_QUEUE])
  app.post<{ Params: { queue: string; jobId: string } }>('/operator/queues/:queue/dead/:jobId/requeue', { preHandler: requireOperator(db, 'operations.manage') }, async (request, reply) => {
    const parsed = ReasonSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
    if (!REQUEUEABLE_QUEUES.has(request.params.queue)) return reply.status(404).send({ error: 'Unknown queue' })
    if (!queueManager.isAvailable()) return reply.status(503).send({ error: 'Queue backend unavailable — jobs run inline with no durable backlog' })
    const moved = await queueManager.requeueDead(request.params.queue, request.params.jobId)
    if (!moved) return reply.status(404).send({ error: 'Job not found in dead letter' })
    await audit.log(request, 'operator.queue.requeue_dead', 'queue_job', `${request.params.queue}/${request.params.jobId}`, parsed.data.reason)
    return { ok: true }
  })

  /** Revoke a tenant's connector credential — deletes the stored (encrypted)
   *  credential so syncs stop and the family must re-authorize. Destructive
   *  for the tenant's data feed; audited like other operator mutations. */
  app.post<{ Params: { connectorId: string; tenantId: string } }>(
    '/operator/connectors/:connectorId/tenants/:tenantId/revoke',
    { preHandler: requireOperator(db, 'operations.manage') },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await db.collection('connector_credentials').deleteOne({
        connector_id: request.params.connectorId,
        tenant_id: request.params.tenantId,
      })
      if (result.deletedCount === 0) return reply.status(404).send({ error: 'Connector credential not found' })
      await audit.log(request, 'operator.connector.revoke', 'connector', `${request.params.tenantId}/${request.params.connectorId}`, parsed.data.reason)
      return { ok: true }
    },
  )

  // ── Platform configuration ──────────────────────────────────────────────
  // Typed global switches (see operator/platform-config.ts). Reads are
  // configuration.read; every write is reasoned, audited, and kept in
  // platform_config_history.

  const configCol = db.collection('platform_config')
  const configHistory = db.collection('platform_config_history')

  app.get('/operator/configuration', { preHandler: requireOperator(db, 'configuration.read') }, async () => {
    const [config, history] = await Promise.all([
      getPlatformConfig(db),
      configHistory.find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(20).toArray(),
    ])
    return { config, history }
  })

  const ConfigUpdateSchema = z.object({
    maintenance_mode: z.boolean().optional(),
    signups_enabled: z.boolean().optional(),
    marketing_paused: z.boolean().optional(),
    reason: z.string().min(5).max(500),
  })

  app.put('/operator/configuration', { preHandler: requireOperator(db, 'configuration.manage') }, async (request, reply) => {
    const parsed = ConfigUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid configuration', issues: parsed.error.issues })
    const { reason, ...changes } = parsed.data
    if (Object.keys(changes).length === 0) return reply.status(400).send({ error: 'No changes provided' })

    const before = await getPlatformConfig(db)
    const next: PlatformConfig = {
      maintenance_mode: changes.maintenance_mode ?? before.maintenance_mode,
      signups_enabled: changes.signups_enabled ?? before.signups_enabled,
      marketing_paused: changes.marketing_paused ?? before.marketing_paused,
    }
    const changedKeys = (Object.keys(changes) as (keyof PlatformConfig)[]).filter((k) => changes[k] !== before[k])
    if (changedKeys.length === 0) return reply.status(400).send({ error: 'No effective changes' })

    await configCol.updateOne(
      { key: CONFIG_DOC_KEY },
      { $set: { ...changes, updated_by: request.operatorContext?.user_id, updated_at: new Date() } },
      { upsert: true },
    )
    await configHistory.insertOne({
      changes,
      before,
      after: next,
      changed_by: request.operatorContext?.user_id,
      reason,
      created_at: new Date(),
    })
    invalidatePlatformConfigCache()
    await audit.log(request, 'operator.configuration.update', 'platform_config', CONFIG_DOC_KEY, reason, { changes, before, after: next })
    return { config: next }
  })

  // ── Infrastructure cost snapshots ───────────────────────────────────────
  // Operator-recorded monthly estimates per service. Honest scope: these
  // are entered by hand — provider billing APIs are out of scope until
  // there's a real need. The UI labels them as estimates.

  const costCol = db.collection('infra_cost_snapshots')

  app.get('/operator/infrastructure', { preHandler: requireOperator(db, 'operations.read') }, async () => {
    const snapshots = await costCol.find({}, { projection: { _id: 0 } }).sort({ recorded_at: -1 }).limit(100).toArray()
    const latest = new Map<string, Record<string, unknown>>()
    for (const snap of snapshots) {
      const service = snap['service'] as string
      if (!latest.has(service)) latest.set(service, snap)
    }
    const entries = [...latest.values()]
    return {
      services: entries,
      total_monthly_usd: entries.reduce((sum, s) => sum + ((s['monthly_usd'] as number) ?? 0), 0),
      history: snapshots.slice(0, 30),
    }
  })

  const CostSnapshotSchema = z.object({
    service: z.string().min(1).max(100),
    monthly_usd: z.number().min(0).max(1_000_000),
    note: z.string().max(500).optional(),
    reason: z.string().min(5).max(500),
  })

  app.post('/operator/infrastructure/snapshots', { preHandler: requireOperator(db, 'operations.manage') }, async (request, reply) => {
    const parsed = CostSnapshotSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid snapshot', issues: parsed.error.issues })
    const { service, monthly_usd, note, reason } = parsed.data
    const doc = {
      id: randomUUID(),
      service: service.toLowerCase().trim(),
      monthly_usd,
      ...(note !== undefined ? { note } : {}),
      recorded_by: request.operatorContext?.user_id,
      recorded_at: new Date(),
    }
    await costCol.insertOne(doc)
    await audit.log(request, 'operator.infrastructure.record_cost', 'infra_cost', service, reason, { monthly_usd })
    return { snapshot: { ...doc, _id: undefined } }
  })
}
