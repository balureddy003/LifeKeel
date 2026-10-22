import type { FastifyInstance } from 'fastify'
import { ObjectId, type Db } from 'mongodb'
import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { OperatorAuditLogger } from '../operator/operator-audit.js'
import {
  requireOperator,
  resolvePermissions,
  hasOperatorPermission,
  type PlatformRole,
  type OperatorPermission,
} from '../operator/operator-auth.js'
import {
  checkDualApproval,
  ensureDualControlIndexes,
  hashState,
  type DualApprovalDoc,
} from '../operator/dual-control.js'
import { sendPasswordResetEmail } from '../auth-email.js'
import { hashAuthToken } from './auth-users.js'
import { recordLedgerEntry, getLedgerHistory } from '../billing/credit-ledger.js'
import { queueManager } from '../queue/QueueManager.js'
import { WEBHOOK_INGEST_QUEUE } from '../queue/WebhookQueue.js'
import {
  getPlatformConfig,
  invalidatePlatformConfigCache,
  CONFIG_DOC_KEY,
  type PlatformConfig,
} from '../operator/platform-config.js'
import { getLoginEventsCollection } from '../db.js'
import {
  taskLlm,
  taskLlmFor,
  getTaskRegistry,
  getProcessorRegistry,
  resolveServingProcessor,
} from '../ai/task-gateway.js'
import { computeTenantHealth } from '../operator/tenant-health.js'
import { isRollupReady, readDailyRollup } from '../jobs/metrics-rollup.js'
import { getRunbooks } from '../operator/runbooks.js'
import {
  listAutopilotRules,
  getAutopilotRule,
  NEVER_AUTONOMOUS,
  PROPOSAL_HANDLERS,
  type AutopilotActionDoc,
} from '../operator/autopilot.js'
import { runWeeklyDigest } from '../operator/weekly-digest.js'
import {
  campaignsCol,
  resolveAudience,
  queueCampaignSend,
  pauseCampaign,
  resumeCampaign,
  type CampaignDoc,
} from '../marketing/campaigns.js'
import { lifecycleSendsCol } from '../marketing/lifecycle-emails.js'
import { platformUnitEconomics } from '../spend-ledger.js'
import { localModelQueueSummary } from './metrics.js'
import { formatMicroDollars, getAllCircuitBreakers } from '@lifekeel/platform'
import type { SupportCaseDoc, SupportMessage } from './support.js'

const QuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
  /** Exact tenant match — used by the operator "view this tenant's users"
   *  drill-down, where the fuzzy `q` regex would over-match. */
  tenant: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  /** Keyset cursor `<created_at ISO>|<id>` — preferred over offset at scale
   *  (skip(N) scans N docs; a cursor seeks the index directly). */
  cursor: z.string().max(300).optional(),
})

const ReasonSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  /** Dual-control spend token — a confirmed operator_dual_approvals id for
   *  the highest-blast-radius actions (see operator/dual-control.ts). */
  confirmation_id: z.string().trim().max(100).optional(),
})

const PLATFORM_ROLES = [
  'support',
  'marketing_operator',
  'finance_operator',
  'operations',
  'platform_admin',
  'super_admin',
] as const
const RolesSchema = z.array(z.enum(PLATFORM_ROLES)).min(1).max(PLATFORM_ROLES.length)
const OperatorCreateSchema = z.object({
  user_id: z.string().trim().min(1).max(100),
  roles: RolesSchema,
  reason: z.string().trim().min(5).max(500),
  confirmation_id: z.string().trim().max(100).optional(),
})
const OperatorUpdateSchema = z.object({
  roles: RolesSchema,
  reason: z.string().trim().min(5).max(500),
  confirmation_id: z.string().trim().max(100).optional(),
})
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
  cursor: z.string().max(300).optional(),
})
const PromotionCreateSchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i, 'Letters, numbers, dashes and underscores only'),
  grant_credits: z.number().int().min(1).max(10000),
  max_uses: z.number().int().min(0).max(1000000).default(0),
  expires_at: z.string().datetime().optional(),
  reason: z.string().trim().min(5).max(500),
})
// Mirrors the public blog schema in blog.ts, plus meta_description for SEO.
const BLOG_CATEGORIES = ['product', 'tutorial', 'case-study', 'news'] as const
const BlogPostWriteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only'),
  content: z.string().min(1).max(200000),
  excerpt: z.string().trim().min(1).max(500),
  category: z.enum(BLOG_CATEGORIES),
  author: z.string().trim().min(1).max(100),
  cover_image: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  meta_description: z.string().trim().max(300).optional(),
})
const BlogPostCreateSchema = BlogPostWriteSchema.extend({
  reason: z.string().trim().min(5).max(500),
})
const BlogPostUpdateSchema = BlogPostWriteSchema.partial().extend({
  reason: z.string().trim().min(5).max(500),
})
// Segment campaigns — operator-authored email to a filtered cohort. The
// filter is intentionally coarse (plan/trial/profile/lead-stage/source/
// age): precise enough to target, too coarse to single out a person.
const CampaignFilterSchema = z.object({
  audience: z.enum(['users', 'leads', 'both']),
  plans: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  trialing: z.boolean().optional(),
  has_profile: z.boolean().optional(),
  lead_stages: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  utm_sources: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  created_within_days: z.number().int().min(1).max(3650).optional(),
  min_age_days: z.number().int().min(0).max(3650).optional(),
})
const CampaignCreateSchema = z.object({
  name: z.string().trim().min(3).max(120),
  subject: z.string().trim().min(3).max(200),
  body_text: z.string().trim().min(20).max(10000),
  cta_url: z.string().trim().url().max(500).optional(),
  cta_label: z.string().trim().min(1).max(60).optional(),
  filter: CampaignFilterSchema,
  reason: z.string().trim().min(5).max(500),
})
const CreditAdjustSchema = z.object({
  amount: z
    .number()
    .int()
    .min(-10000)
    .max(10000)
    .refine((v) => v !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(5).max(500),
  confirmation_id: z.string().trim().max(100).optional(),
})
const AuditQuerySchema = z.object({
  action: z.string().trim().max(80).optional(),
  target_type: z.string().trim().max(40).optional(),
  target_id: z.string().trim().max(100).optional(),
  operator_user_id: z.string().trim().max(100).optional(),
  /** operator (default): the operator_audit_log console trail.
   *  all: union with the product audit_log — an operator investigating a
   *  user/tenant sees both operator actions and family-side product events
   *  (insight approvals, connector changes, auth events) on the target in
   *  one feed, tagged source: 'operator' | 'product'. */
  source: z.enum(['operator', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().max(300).optional(),
})
const SupportQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['open', 'answered', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().max(300).optional(),
})
const SupportMessageWriteSchema = z.object({ text: z.string().trim().min(1).max(4000) })

function safeRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
}

/** Keyset pagination for `created_at:-1` sorts — the cursor encodes the last
 *  row's (created_at, id) pair; the next page seeks past it via the index.
 *  The id tiebreak keeps ordering stable when rows share a timestamp. */
function decodeCursor(
  cursor: string | undefined,
): { created_at: Date; id: string } | null | undefined {
  if (!cursor) return undefined
  const raw = Buffer.from(cursor, 'base64url').toString('utf8')
  const sep = raw.lastIndexOf('|')
  if (sep <= 0) return null
  const created = new Date(raw.slice(0, sep))
  const id = raw.slice(sep + 1)
  if (Number.isNaN(created.getTime()) || !id) return null
  return { created_at: created, id }
}

function encodeCursor(
  item: Record<string, unknown>,
  idField: string,
  dateField = 'created_at',
): string | undefined {
  const created = item[dateField]
  const id = item[idField]
  if (!(created instanceof Date) || typeof id !== 'string' || !id) return undefined
  return Buffer.from(`${created.toISOString()}|${id}`).toString('base64url')
}

function cursorFilter(
  cursor: { created_at: Date; id: string },
  idField: string,
  dateField = 'created_at',
): Record<string, unknown> {
  return {
    $or: [
      { [dateField]: { $lt: cursor.created_at } },
      { [dateField]: cursor.created_at, [idField]: { $lt: cursor.id } },
    ],
  }
}

export async function registerOperatorRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const audit = new OperatorAuditLogger(db)
  const users = db.collection('users')
  const tenants = db.collection('tenants')

  users.createIndex({ created_at: -1 }).catch(() => {})
  users.createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {})
  // Operator search hits these — at scale a regex scan over unindexed
  // fields is a full collection scan.
  // Must match getUsersCollection() in auth-users.ts exactly (unique): both
  // get the auto name email_1, and differing options make a fresh database
  // fail with an index-name conflict.
  users.createIndex({ email: 1 }, { unique: true }).catch(() => {})
  users.createIndex({ name: 1 }).catch(() => {})
  tenants.createIndex({ name: 1 }).catch(() => {})
  db.collection('leads')
    .createIndex({ created_at: -1 })
    .catch(() => {})
  db.collection('operator_audit_log')
    .createIndex({ created_at: -1 })
    .catch(() => {})
  ensureDualControlIndexes(db).catch(() => {})
  // Support inbox: status-filtered, updated_at-ordered.
  db.collection('support_cases')
    .createIndex({ status: 1, updated_at: -1 })
    .catch(() => {})
  // Operator alert triage state — one doc per signal's dedup_key.
  db.collection('operator_alerts')
    .createIndex({ dedup_key: 1 }, { unique: true })
    .catch(() => {})
  // Daily metric rollups: metric+day-range reads; _id is already unique.
  db.collection('metrics_daily')
    .createIndex({ metric: 1, day: -1 })
    .catch(() => {})
  // Awaited: the promo create path relies on the unique index for duplicate
  // detection, so it can't race registration.
  await Promise.all([
    db.collection('platform_operators').createIndex({ user_id: 1 }, { unique: true }),
    db.collection('promo_codes').createIndex({ code: 1 }, { unique: true }),
    db.collection('leads').createIndex({ email: 1 }, { unique: true }),
  ]).catch(() => {})

  app.get('/operator/me', { preHandler: requireOperator(db, 'overview.read') }, async (request) => {
    const operator = request.operatorContext
    return {
      operator,
      permissions: operator ? resolvePermissions(operator.roles) : [],
    }
  })

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
      openCases,
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
      db
        .collection('growth_events')
        .aggregate([
          { $match: { created_at: { $gte: weekAgo } } },
          { $group: { _id: '$event', count: { $sum: 1 } } },
          { $project: { _id: 0, event: '$_id', count: 1 } },
        ])
        .toArray(),
      db
        .collection('leads')
        .aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }])
        .toArray(),
      users
        .aggregate([
          { $match: { created_at: { $gte: weekAgo } } },
          {
            $group: { _id: { $ifNull: ['$attribution.utm_source', 'direct'] }, count: { $sum: 1 } },
          },
          { $project: { _id: 0, source: '$_id', count: 1 } },
          { $sort: { count: -1 } },
        ])
        .toArray(),
      // Week-over-week deltas — the command center's "is it working?" chips.
      users.countDocuments({
        created_at: { $gte: new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000), $lt: weekAgo },
      }),
      db.collection('leads').countDocuments({ created_at: { $gte: weekAgo } }),
      db.collection('leads').countDocuments({
        created_at: { $gte: new Date(weekAgo.getTime() - 7 * 24 * 60 * 60 * 1000), $lt: weekAgo },
      }),
      // 30-day daily series per funnel event — powers the KPI sparklines.
      // Reads metrics_daily rollups once the hourly job has backfilled;
      // falls back to the raw scan until then (fresh envs, pre-backfill).
      isRollupReady(db).then(async (ready) => {
        if (ready) {
          const rows = await readDailyRollup(db, 'growth_event', 30)
          return rows.map((r) => ({ day: r.day, event: r.dim, count: r.count }))
        }
        return db
          .collection('growth_events')
          .aggregate([
            { $match: { created_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
            {
              $group: {
                _id: {
                  day: { $dateToString: { format: '%Y-%m-%d', date: '$created_at' } },
                  event: '$event',
                },
                count: { $sum: 1 },
              },
            },
            { $project: { _id: 0, day: '$_id.day', event: '$_id.event', count: 1 } },
          ])
          .toArray()
      }),
      db.collection('support_cases').countDocuments({ status: 'open' }),
    ])

    return {
      generated_at: new Date().toISOString(),
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        signups_today: signupsToday,
        signups_week: signupsWeek,
        signups_prev_week: signupsPrevWeek,
      },
      tenants: { total: totalTenants, active: activeTenants },
      marketing: { publish_failed: failedPosts, queued: queuedPosts },
      leads: Object.fromEntries(leadsByStage.map((s) => [s['_id'], s['count']])),
      leads_7d: leadsWeek,
      leads_prev_7d: leadsPrevWeek,
      signups_by_source_7d: Object.fromEntries(
        signupsBySource.map((s) => [s['source'], s['count']]),
      ),
      growth_events_7d: recentEvents,
      activity_30d: activityRows,
      support: { open: openCases },
    }
  })

  app.get(
    '/operator/users',
    { preHandler: requireOperator(db, 'users.read') },
    async (request, reply) => {
      const parsed = QuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { q, status, tenant, limit, offset, cursor } = parsed.data
      const filter: Record<string, unknown> = {}
      if (q) {
        const pattern = safeRegex(q)
        filter['$or'] = [
          { email: pattern },
          { name: pattern },
          { tenant_id: pattern },
          { id: pattern },
        ]
      }
      if (status) filter['status'] = status
      if (tenant) filter['tenant_id'] = tenant
      const decoded = decodeCursor(cursor)
      if (decoded === null) return reply.status(400).send({ error: 'Invalid cursor' })
      // $and, not assign: the search regex above already owns filter.$or —
      // overwriting it would silently drop the search on page 2+.
      if (decoded) filter['$and'] = [cursorFilter(decoded, 'id')]
      const [items, total] = await Promise.all([
        users
          .find(filter, {
            projection: {
              _id: 0,
              id: 1,
              email: 1,
              name: 1,
              tenant_id: 1,
              roles: 1,
              status: 1,
              email_verified: 1,
              external_provider: 1,
              created_at: 1,
              updated_at: 1,
              failed_login_attempts: 1,
              locked_until: 1,
              sessions_revoked_at: 1,
              'attribution.utm_source': 1,
              'attribution.utm_campaign': 1,
            },
          })
          .sort({ created_at: -1, id: -1 })
          .skip(decoded ? 0 : offset)
          .limit(limit)
          .toArray(),
        // Cursor pages skip the count — counting a filtered 1M-row collection
        // per page turn is exactly the cost keyset pagination exists to avoid.
        decoded ? Promise.resolve(undefined) : users.countDocuments(filter),
      ])
      const nextCursor =
        items.length === limit
          ? encodeCursor(items[items.length - 1] as Record<string, unknown>, 'id')
          : undefined
      return {
        users: items,
        total,
        limit,
        offset,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      }
    },
  )

  /** One-screen support dossier — identity, workspace, security posture,
   *  insight activity, billing ledger tail, open support cases, and the
   *  operator actions already taken on this account. The goal: a support
   *  ticket resolves without opening four other pages or the database. */
  app.get<{ Params: { id: string } }>(
    '/operator/users/:id',
    { preHandler: requireOperator(db, 'users.read') },
    async (request, reply) => {
      const user = await users.findOne(
        { id: request.params.id },
        {
          projection: {
            password_hash: 0,
            salt: 0,
            password_reset_token: 0,
            email_verification_token: 0,
          },
        },
      )
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const tenantId = user['tenant_id'] as string
      const [tenant, recentLogins, insightCounts, ledger, userCases, userAudit] = await Promise.all(
        [
          tenants.findOne({ tenant_id: tenantId }, { projection: { _id: 0 } }),
          getLoginEventsCollection(db)
            .find({ user_id: user['id'] }, { projection: { _id: 0 } })
            .sort({ created_at: -1 })
            .limit(10)
            .toArray(),
          db
            .collection('insights')
            .aggregate([
              { $match: { tenant_id: tenantId } },
              { $group: { _id: '$state', count: { $sum: 1 } } },
            ])
            .toArray(),
          getLedgerHistory(db, { tenantId, limit: 10 }),
          db
            .collection('support_cases')
            .find({ user_id: user['id'] }, { projection: { _id: 0, 'messages.text': 0 } })
            .sort({ updated_at: -1 })
            .limit(10)
            .toArray(),
          db
            .collection('operator_audit_log')
            .find({ target_type: 'user', target_id: user['id'] }, { projection: { _id: 0 } })
            .sort({ created_at: -1 })
            .limit(10)
            .toArray(),
        ],
      )
      return {
        user,
        tenant,
        dossier: {
          recent_logins: recentLogins,
          insights: Object.fromEntries(insightCounts.map((i) => [i['_id'], i['count']])),
          ledger_tail: ledger.entries,
          support_cases: userCases,
          audit_trail: userAudit,
        },
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/suspend',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      if (request.params.id === request.operatorContext?.user_id)
        return reply.status(409).send({ error: 'Operators cannot suspend themselves' })
      const before = await users.findOne({ id: request.params.id })
      if (!before) return reply.status(404).send({ error: 'User not found or already suspended' })
      const result = await users.updateOne(
        { id: request.params.id, status: { $ne: 'suspended' } },
        { $set: { status: 'suspended', suspended_at: new Date(), updated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'User not found or already suspended' })
      const after = await users.findOne({ id: request.params.id })
      await audit.log(
        request,
        'operator.user.suspend',
        'user',
        request.params.id,
        parsed.data.reason,
        undefined,
        { before, after },
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/reactivate',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await users.updateOne(
        { id: request.params.id, status: 'suspended' },
        {
          $set: { status: 'active', reactivated_at: new Date(), updated_at: new Date() },
          $unset: { suspended_at: '' },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'User not found or not suspended' })
      await audit.log(
        request,
        'operator.user.reactivate',
        'user',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  app.get(
    '/operator/tenants',
    { preHandler: requireOperator(db, 'tenants.read') },
    async (request, reply) => {
      const parsed = QuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { q, status, limit, offset, cursor } = parsed.data
      const filter: Record<string, unknown> = {}
      if (q) {
        const pattern = safeRegex(q)
        filter['$or'] = [{ tenant_id: pattern }, { id: pattern }, { name: pattern }]
      }
      if (status) filter['status'] = status
      const decoded = decodeCursor(cursor)
      if (decoded === null) return reply.status(400).send({ error: 'Invalid cursor' })
      if (decoded) filter['$and'] = [cursorFilter(decoded, 'tenant_id')]
      const [items, total] = await Promise.all([
        tenants
          .find(filter, { projection: { _id: 0 } })
          .sort({ created_at: -1, tenant_id: -1 })
          .skip(decoded ? 0 : offset)
          .limit(limit)
          .toArray(),
        decoded ? Promise.resolve(undefined) : tenants.countDocuments(filter),
      ])
      const tenantIds = items.map((item) => item['tenant_id'] as string).filter(Boolean)
      const memberCounts =
        tenantIds.length === 0
          ? []
          : await users
              .aggregate([
                { $match: { tenant_id: { $in: tenantIds } } },
                { $group: { _id: '$tenant_id', count: { $sum: 1 } } },
              ])
              .toArray()
      const counts = new Map(
        memberCounts.map((item) => [item['_id'] as string, item['count'] as number]),
      )
      const health = await computeTenantHealth(db, tenantIds)
      const nextCursor =
        items.length === limit ? encodeCursor(items[items.length - 1], 'tenant_id') : undefined
      return {
        tenants: items.map((item) => ({
          ...item,
          user_count: counts.get(item['tenant_id'] as string) ?? 0,
          health: health.get(item['tenant_id'] as string) ?? { score: 100, factors: [] },
        })),
        total,
        limit,
        offset,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/operator/tenants/:id',
    { preHandler: requireOperator(db, 'tenants.read') },
    async (request, reply) => {
      const tenant = await tenants.findOne(
        { $or: [{ tenant_id: request.params.id }, { id: request.params.id }] },
        { projection: { _id: 0 } },
      )
      if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
      const [members, health] = await Promise.all([
        users
          .find(
            { tenant_id: tenant['tenant_id'] },
            {
              projection: { _id: 0, id: 1, email: 1, name: 1, roles: 1, status: 1, created_at: 1 },
            },
          )
          .sort({ created_at: 1 })
          .toArray(),
        computeTenantHealth(db, [tenant['tenant_id'] as string]),
      ])
      return {
        tenant,
        members,
        health: health.get(tenant['tenant_id'] as string) ?? { score: 100, factors: [] },
      }
    },
  )

  /** Suspending a tenant blocks every request for all of its users — the
   *  auth middleware requires status active|trial. */
  app.post<{ Params: { id: string } }>(
    '/operator/tenants/:id/suspend',
    { preHandler: requireOperator(db, 'tenants.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      // Whole-tenant kill switch — four-eyes.
      const gate = await checkDualApproval(db, audit, request, {
        action: 'operator.tenant.suspend',
        targetType: 'tenant',
        targetId: request.params.id,
        payload: { reason: parsed.data.reason },
        permission: 'tenants.manage',
        reason: parsed.data.reason,
      })
      if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)
      const before = await tenants.findOne({
        $or: [{ tenant_id: request.params.id }, { id: request.params.id }],
      })
      const result = await tenants.updateOne(
        {
          $or: [{ tenant_id: request.params.id }, { id: request.params.id }],
          status: { $ne: 'suspended' },
        },
        { $set: { status: 'suspended', suspended_at: new Date(), updated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Tenant not found or already suspended' })
      const after = await tenants.findOne({
        $or: [{ tenant_id: request.params.id }, { id: request.params.id }],
      })
      await audit.log(
        request,
        'operator.tenant.suspend',
        'tenant',
        request.params.id,
        parsed.data.reason,
        undefined,
        { before, after },
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/tenants/:id/reactivate',
    { preHandler: requireOperator(db, 'tenants.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await tenants.updateOne(
        { $or: [{ tenant_id: request.params.id }, { id: request.params.id }], status: 'suspended' },
        {
          $set: { status: 'active', reactivated_at: new Date(), updated_at: new Date() },
          $unset: { suspended_at: '' },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Tenant not found or not suspended' })
      await audit.log(
        request,
        'operator.tenant.reactivate',
        'tenant',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** Trigger the standard password-reset email for a user — same token shape
   *  and 1h expiry as the self-service flow. */
  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/password-reset',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const user = await users.findOne({ id: request.params.id })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const token = randomBytes(32).toString('hex')
      await users.updateOne(
        { id: request.params.id },
        {
          $set: {
            password_reset_token_hash: hashAuthToken(token),
            password_reset_expires: new Date(Date.now() + 60 * 60 * 1000),
            updated_at: new Date(),
          },
          $unset: { password_reset_token: '' },
        },
      )
      const appUrl = (process.env['LIFEKEEL_URL'] ?? 'http://localhost:3002').replace(/\/$/, '')
      await sendPasswordResetEmail(
        user['email'] as string,
        user['name'] as string,
        `${appUrl}/reset-password/confirm#token=${token}`,
      )
      await audit.log(
        request,
        'operator.user.password_reset',
        'user',
        request.params.id,
        parsed.data.reason,
      )
      return { sent: true }
    },
  )

  /** Kill every outstanding JWT for a user without suspending the account —
   *  stamps sessions_revoked_at, and the auth middleware rejects any token
   *  issued at or before that instant. New logins still work. */
  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/revoke-sessions',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await users.updateOne(
        { id: request.params.id },
        { $set: { sessions_revoked_at: new Date(), updated_at: new Date() } },
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'User not found' })
      await audit.log(
        request,
        'operator.user.revoke_sessions',
        'user',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** Clear a login lockout early — the lock is a brute-force control, so an
   *  operator lift needs a reason and an audit entry like any other
   *  security-relevant action. */
  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/unlock',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await users.updateOne(
        {
          id: request.params.id,
          $or: [{ locked_until: { $gt: new Date() } }, { failed_login_attempts: { $gt: 0 } }],
        },
        {
          $set: { failed_login_attempts: 0, updated_at: new Date() },
          $unset: { locked_until: '' },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'User not found or not locked' })
      await audit.log(
        request,
        'operator.user.unlock',
        'user',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** MFA lockout recovery — clears TOTP enrollment so the user can sign in
   *  with email+password and re-enroll. This is the recovery path for a
   *  lost authenticator AND lost recovery codes; it must only run after
   *  out-of-band identity verification (see SECURITY.md's MFA section —
   *  the reason field carries the verification reference, e.g. support
   *  ticket id). Also revokes sessions so a stolen session can't linger
   *  past the reset. */
  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/mfa-disable',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await users.updateOne(
        { id: request.params.id, mfa_enabled: true },
        {
          $set: { mfa_enabled: false, sessions_revoked_at: new Date(), updated_at: new Date() },
          $unset: { mfa_secret: '', mfa_pending_secret: '', mfa_recovery_hashes: '' },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'User not found or MFA not enabled' })
      await audit.log(
        request,
        'operator.user.mfa_disable',
        'user',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** Data-subject export — everything we hold on a user, bundled as one
   *  JSON document for GDPR/DSAR requests. POST (not GET) so the reason is
   *  captured and audited like every other privileged read of this size.
   *  users.read suffices: the bundle contains nothing the read endpoints
   *  don't already expose, just assembled — and the audit entry records it. */
  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/export',
    { preHandler: requireOperator(db, 'users.read', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const user = await users.findOne(
        { id: request.params.id },
        {
          projection: {
            password_hash: 0,
            salt: 0,
            password_reset_token: 0,
            email_verification_token: 0,
          },
        },
      )
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const tenantId = user['tenant_id'] as string | undefined
      const email = user['email'] as string | undefined
      const [tenant, members, leadDocs, userAudit] = await Promise.all([
        tenantId
          ? tenants.findOne({ tenant_id: tenantId }, { projection: { _id: 0 } })
          : Promise.resolve(null),
        tenantId
          ? users
              .find(
                { tenant_id: tenantId },
                {
                  projection: {
                    _id: 0,
                    id: 1,
                    email: 1,
                    name: 1,
                    roles: 1,
                    status: 1,
                    created_at: 1,
                  },
                },
              )
              .toArray()
          : Promise.resolve([]),
        email
          ? db
              .collection('leads')
              .find({ email: String(email).toLowerCase() }, { projection: { _id: 0 } })
              .toArray()
          : Promise.resolve([]),
        db
          .collection('operator_audit_log')
          .find({ target_type: 'user', target_id: request.params.id }, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .limit(200)
          .toArray(),
      ])
      await audit.log(
        request,
        'operator.user.export',
        'user',
        request.params.id,
        parsed.data.reason,
      )
      return {
        exported_at: new Date().toISOString(),
        requested_by: request.operatorContext?.user_id,
        reason: parsed.data.reason,
        user,
        tenant,
        members,
        leads: leadDocs,
        operator_actions_on_record: userAudit,
      }
    },
  )

  /** Erasure — anonymizes the account in place (keeps the id for referential
   *  integrity across audit/ledger rows), clears every credential so login
   *  is impossible, revokes sessions, and tombstones the matching lead
   *  record. Irreversible by design — hence users.manage + reason + audit,
   *  and it's deliberately not exposed to any autopilot path. */
  app.post<{ Params: { id: string } }>(
    '/operator/users/:id/erase',
    { preHandler: requireOperator(db, 'users.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      if (request.params.id === request.operatorContext?.user_id) {
        return reply.status(409).send({ error: 'Operators cannot erase themselves' })
      }
      const user = await users.findOne({ id: request.params.id })
      if (!user) return reply.status(404).send({ error: 'User not found' })
      if (user['status'] === 'erased')
        return reply.status(409).send({ error: 'User already erased' })
      // Irreversible PII destruction — a second operator must confirm.
      const gate = await checkDualApproval(db, audit, request, {
        action: 'operator.user.erase',
        targetType: 'user',
        targetId: request.params.id,
        // Hash the semantic fields only — confirmation_id is the spend
        // ticket itself, not part of what was approved.
        payload: { reason: parsed.data.reason },
        permission: 'users.manage',
        reason: parsed.data.reason,
      })
      if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)
      const now = new Date()
      const oldEmail = user['email'] as string | undefined
      await users.updateOne(
        { id: request.params.id },
        {
          $set: {
            status: 'erased',
            email: `erased-${request.params.id}@erased.invalid`,
            name: 'Erased user',
            sessions_revoked_at: now,
            erased_at: now,
            updated_at: now,
          },
          $unset: {
            password_hash: '',
            salt: '',
            avatar_color: '',
            attribution: '',
            external_id: '',
            external_provider: '',
            email_verified: '',
            email_verification_token: '',
            email_verification_expires: '',
            password_reset_token: '',
            password_reset_expires: '',
            locked_until: '',
            failed_login_attempts: '',
          },
        },
      )
      if (oldEmail) {
        await db.collection('leads').updateOne(
          { email: oldEmail.toLowerCase() },
          {
            $set: {
              email: `erased-${request.params.id}@erased.invalid`,
              suppressed: true,
              updated_at: now,
            },
            $unset: { name: '', attribution: '' },
          },
        )
      }
      // If the erased user held operator privileges, drop the record too —
      // a tombstone account must retain no privileged surface.
      await db.collection('platform_operators').deleteOne({ user_id: request.params.id })
      const erasedUser = await users.findOne({ id: request.params.id })
      await audit.log(
        request,
        'operator.user.erase',
        'user',
        request.params.id,
        parsed.data.reason,
        undefined,
        { before: user, after: erasedUser },
      )
      return { ok: true }
    },
  )

  /** Account security posture: active lockouts, users accumulating failed
   *  attempts, suspensions, session revocations, and 24h login telemetry
   *  (failure hotspots by IP, first-seen IPs, recent event feed). */
  app.get('/operator/security', { preHandler: requireOperator(db, 'users.read') }, async () => {
    const now = new Date()
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const loginEvents = getLoginEventsCollection(db)
    const [
      locked,
      withFailures,
      suspended,
      revoked7d,
      failed24h,
      success24h,
      failedByIp,
      newIpLogins,
      recentEvents,
    ] = await Promise.all([
      users
        .find(
          { locked_until: { $gt: now } },
          {
            projection: {
              _id: 0,
              id: 1,
              email: 1,
              tenant_id: 1,
              failed_login_attempts: 1,
              locked_until: 1,
            },
          },
        )
        .sort({ locked_until: -1 })
        .limit(50)
        .toArray(),
      users.countDocuments({ failed_login_attempts: { $gt: 0 } }),
      users.countDocuments({ status: 'suspended' }),
      users.countDocuments({ sessions_revoked_at: { $gte: weekAgo } }),
      loginEvents.countDocuments({ success: false, created_at: { $gte: dayAgo } }),
      loginEvents.countDocuments({ success: true, created_at: { $gte: dayAgo } }),
      // Credential-stuffing signal: which IPs are generating failures.
      loginEvents
        .aggregate([
          { $match: { success: false, created_at: { $gte: dayAgo } } },
          { $group: { _id: '$ip', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 5 },
          { $project: { _id: 0, ip: '$_id', count: 1 } },
        ])
        .toArray(),
      // Account-takeover signal: successful logins from an (email, ip) pair
      // first seen inside the last 24h. Bounded — a brand-new deploy reports
      // every login as "new IP" until the collection accumulates history.
      loginEvents
        .aggregate([
          { $match: { success: true, email: { $exists: true } } },
          { $group: { _id: { email: '$email', ip: '$ip' }, first_seen: { $min: '$created_at' } } },
          { $match: { first_seen: { $gte: dayAgo } } },
          { $sort: { first_seen: -1 } },
          { $limit: 20 },
          { $project: { _id: 0, email: '$_id.email', ip: '$_id.ip', first_seen: 1 } },
        ])
        .toArray(),
      loginEvents
        .find(
          {},
          {
            projection: {
              _id: 0,
              email: 1,
              success: 1,
              reason: 1,
              ip: 1,
              user_agent: 1,
              created_at: 1,
            },
          },
        )
        .sort({ created_at: -1 })
        .limit(15)
        .toArray(),
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

  app.get(
    '/operator/operators',
    { preHandler: requireOperator(db, 'operators.manage') },
    async () => {
      const docs = await operators.find({}, { projection: { _id: 0 } }).toArray()
      const dbIds = new Set(docs.map((d) => d['user_id'] as string))
      // Env ids with a DB record are governed by that record — listing them
      // under both sections would suggest the env entry still means something.
      const bootstrapIds = (process.env['PLATFORM_OPERATOR_USER_IDS'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((id) => id && !dbIds.has(id))
      // Break-glass semantics: env ids resolve only while no active DB
      // super_admin exists (see resolveOperator), so mark them dormant here.
      const dbSuperAdminExists = docs.some(
        (d) =>
          d['status'] === 'active' && (d['roles'] as string[] | undefined)?.includes('super_admin'),
      )
      const ids = new Set([...dbIds, ...bootstrapIds])
      const profiles =
        ids.size === 0
          ? []
          : await users
              .find(
                { id: { $in: [...ids] } },
                { projection: { _id: 0, id: 1, email: 1, name: 1, status: 1 } },
              )
              .toArray()
      const byId = new Map(profiles.map((u) => [u['id'] as string, u]))
      return {
        operators: docs.map((d) => ({
          ...d,
          source: 'database',
          user: byId.get(d['user_id'] as string) ?? null,
        })),
        bootstrap: bootstrapIds.map((id) => ({
          user_id: id,
          roles: ['super_admin'],
          status: 'active',
          source: 'bootstrap',
          effective: !dbSuperAdminExists,
          user: byId.get(id) ?? null,
        })),
      }
    },
  )

  app.post(
    '/operator/operators',
    { preHandler: requireOperator(db, 'operators.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = OperatorCreateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid operator', issues: parsed.error.issues })
      const { user_id, roles, reason } = parsed.data
      const user = await users.findOne(
        { id: user_id },
        { projection: { _id: 0, id: 1, email: 1, name: 1 } },
      )
      if (!user) return reply.status(404).send({ error: 'User not found' })
      // Granting platform privilege — four-eyes.
      const gate = await checkDualApproval(db, audit, request, {
        action: 'operator.operator.create',
        targetType: 'operator',
        targetId: user_id,
        payload: { user_id, roles, reason },
        permission: 'operators.manage',
        reason,
      })
      if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)
      const before = await operators.findOne({ user_id })
      await operators.updateOne(
        { user_id },
        {
          $set: { roles, status: 'active', updated_at: new Date() },
          $setOnInsert: { user_id, created_at: new Date() },
        },
        { upsert: true },
      )
      const after = await operators.findOne({ user_id })
      await audit.log(
        request,
        'operator.operator.create',
        'operator',
        user_id,
        reason,
        { roles },
        { before, after },
      )
      return { ok: true, user }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/operator/operators/:id',
    { preHandler: requireOperator(db, 'operators.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = OperatorUpdateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid roles', issues: parsed.error.issues })
      const targetId = request.params.id
      if (targetId === request.operatorContext?.user_id)
        return reply.status(409).send({ error: 'Operators cannot change their own roles' })
      const target = await operators.findOne({ user_id: targetId })
      if (!target) return reply.status(404).send({ error: 'Operator not found' })
      if (
        !(await anotherSuperAdminExists(
          targetId,
          (target['roles'] as PlatformRole[] | undefined) ?? [],
        ))
      ) {
        return reply.status(409).send({ error: 'Cannot remove the last super_admin' })
      }
      // Privilege change — four-eyes.
      const gate = await checkDualApproval(db, audit, request, {
        action: 'operator.operator.update_roles',
        targetType: 'operator',
        targetId,
        payload: { roles: parsed.data.roles, reason: parsed.data.reason },
        permission: 'operators.manage',
        reason: parsed.data.reason,
      })
      if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)
      await operators.updateOne(
        { user_id: targetId },
        { $set: { roles: parsed.data.roles, updated_at: new Date() } },
      )
      const after = await operators.findOne({ user_id: targetId })
      await audit.log(
        request,
        'operator.operator.update_roles',
        'operator',
        targetId,
        parsed.data.reason,
        { roles: parsed.data.roles },
        { before: target, after },
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/operators/:id/suspend',
    { preHandler: requireOperator(db, 'operators.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const targetId = request.params.id
      if (targetId === request.operatorContext?.user_id)
        return reply.status(409).send({ error: 'Operators cannot suspend themselves' })
      const target = await operators.findOne({ user_id: targetId })
      if (!target) return reply.status(404).send({ error: 'Operator not found' })
      if (
        !(await anotherSuperAdminExists(
          targetId,
          (target['roles'] as PlatformRole[] | undefined) ?? [],
        ))
      ) {
        return reply.status(409).send({ error: 'Cannot suspend the last super_admin' })
      }
      await operators.updateOne(
        { user_id: targetId },
        { $set: { status: 'suspended', updated_at: new Date() } },
      )
      const after = await operators.findOne({ user_id: targetId })
      await audit.log(
        request,
        'operator.operator.suspend',
        'operator',
        targetId,
        parsed.data.reason,
        undefined,
        { before: target, after },
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/operators/:id/reactivate',
    { preHandler: requireOperator(db, 'operators.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await operators.updateOne(
        { user_id: request.params.id, status: 'suspended' },
        { $set: { status: 'active', updated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Operator not found or not suspended' })
      await audit.log(
        request,
        'operator.operator.reactivate',
        'operator',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  // ── Dual control (four-eyes) ──────────────────────────────────────────────
  // The highest-blast-radius actions (erase, credit adjust, bulk send,
  // privilege grants, tenant suspend) require a second operator holding the
  // same permission to confirm before the requester can execute — see
  // operator/dual-control.ts for the approval lifecycle.

  const dualApprovals = db.collection<DualApprovalDoc>('operator_dual_approvals')

  app.get(
    '/operator/dual-approvals',
    { preHandler: requireOperator(db, 'overview.read') },
    async (request) => {
      const raw = (request.query as { status?: string })['status'] ?? 'pending'
      const status: DualApprovalDoc['status'] = (
        ['pending', 'confirmed', 'consumed'] as const
      ).includes(raw as DualApprovalDoc['status'])
        ? (raw as DualApprovalDoc['status'])
        : 'pending'
      const docs = await dualApprovals
        .find({ status }, { projection: { _id: 0, payload_hash: 0 } })
        .sort({ created_at: -1 })
        .limit(50)
        .toArray()
      return { approvals: docs }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/dual-approvals/:id/confirm',
    { preHandler: requireOperator(db, 'overview.read', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body ?? { reason: 'confirmed' })
      const reason = parsed.success ? parsed.data.reason : 'confirmed'
      const doc = await dualApprovals.findOne({ id: request.params.id })
      if (!doc || doc.status !== 'pending')
        return reply.status(404).send({ error: 'Approval not found or already resolved' })
      if (doc.expires_at.getTime() < Date.now())
        return reply.status(409).send({ error: 'Approval expired — request a new one' })
      const confirmer = request.operatorContext?.user_id ?? ''
      if (doc.requested_by === confirmer)
        return reply
          .status(403)
          .send({ error: 'A second operator must confirm — self-approval is not allowed' })
      if (!hasOperatorPermission(request.operatorContext?.roles ?? [], doc.required_permission))
        return reply
          .status(403)
          .send({ error: `This approval requires ${doc.required_permission}` })
      // Atomic transition — two racing confirmers can't both land it.
      const claimed = await dualApprovals.updateOne(
        { id: doc.id, status: 'pending' },
        { $set: { status: 'confirmed', confirmed_by: confirmer, confirmed_at: new Date() } },
      )
      if (claimed.modifiedCount === 0)
        return reply.status(409).send({ error: 'Approval already resolved' })
      await audit.log(
        request,
        'operator.dual_control.confirm',
        doc.target_type,
        doc.target_id,
        reason,
        { approval_id: doc.id, action: doc.action, requested_by: doc.requested_by },
      )
      return { ok: true }
    },
  )

  /** True when demoting/suspending `targetId` still leaves an active
   *  super_admin — counting DB operators plus the env bootstrap. */
  async function anotherSuperAdminExists(
    targetId: string,
    targetRoles: PlatformRole[],
  ): Promise<boolean> {
    if (!targetRoles.includes('super_admin')) return true
    const others = await operators.countDocuments({
      user_id: { $ne: targetId },
      status: 'active',
      roles: 'super_admin',
    })
    if (others > 0) return true
    return (
      (process.env['PLATFORM_OPERATOR_USER_IDS'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((id) => id && id !== targetId).length > 0
    )
  }

  // ── Leads ───────────────────────────────────────────────────────────────

  const leads = db.collection('leads')

  app.get(
    '/operator/leads',
    { preHandler: requireOperator(db, 'leads.read') },
    async (request, reply) => {
      const parsed = LeadQuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { q, stage, source, suppressed, limit, offset, cursor } = parsed.data
      const filter: Record<string, unknown> = {}
      if (q) {
        const pattern = safeRegex(q)
        filter['$or'] = [{ email: pattern }, { name: pattern }, { id: pattern }]
      }
      if (stage) filter['stage'] = stage
      if (source) filter['source'] = source
      if (suppressed) filter['suppressed'] = suppressed === 'true'
      const decoded = decodeCursor(cursor)
      if (decoded === null) return reply.status(400).send({ error: 'Invalid cursor' })
      // $and, not assign: the search regex above already owns filter.$or —
      // overwriting it would silently drop the search on page 2+.
      if (decoded) filter['$and'] = [cursorFilter(decoded, 'id')]
      const [items, total, stageCounts, sourceCounts] = await Promise.all([
        leads
          .find(filter, { projection: { _id: 0 } })
          .sort({ created_at: -1, id: -1 })
          .skip(decoded ? 0 : offset)
          .limit(limit)
          .toArray(),
        decoded ? Promise.resolve(undefined) : leads.countDocuments(filter),
        leads.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]).toArray(),
        leads.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]).toArray(),
      ])
      const nextCursor =
        items.length === limit ? encodeCursor(items[items.length - 1], 'id') : undefined
      return {
        leads: items,
        total,
        limit,
        offset,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
        stages: Object.fromEntries(stageCounts.map((s) => [s['_id'], s['count']])),
        sources: Object.fromEntries(sourceCounts.map((s) => [s['_id'], s['count']])),
      }
    },
  )

  /** Stage moves and notes share one endpoint; reason is required either way
   *  and the change is audited. */
  app.patch<{ Params: { id: string } }>(
    '/operator/leads/:id',
    { preHandler: requireOperator(db, 'leads.manage') },
    async (request, reply) => {
      const parsed = LeadUpdateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
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
          from: lead['stage'],
          to: stage,
        })
      }
      if (note !== undefined) {
        await audit.log(request, 'operator.lead.add_note', 'lead', request.params.id, reason)
      }
      const updated = await leads.findOne({ id: request.params.id }, { projection: { _id: 0 } })
      return { lead: updated }
    },
  )

  /** Suppression is the operator-side unsubscribe/do-not-contact flag. It is
   *  never cleared by re-capture — the public /leads upsert doesn't touch it. */
  app.post<{ Params: { id: string } }>(
    '/operator/leads/:id/suppress',
    { preHandler: requireOperator(db, 'leads.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await leads.updateOne(
        { id: request.params.id, suppressed: { $ne: true } },
        { $set: { suppressed: true, suppressed_at: new Date(), updated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Lead not found or already suppressed' })
      await audit.log(
        request,
        'operator.lead.suppress',
        'lead',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** Full lead record for the detail drawer — includes consent,
   *  attribution, and the notes timeline. */
  app.get<{ Params: { id: string } }>(
    '/operator/leads/:id',
    { preHandler: requireOperator(db, 'leads.read') },
    async (request, reply) => {
      const lead = await leads.findOne({ id: request.params.id }, { projection: { _id: 0 } })
      if (!lead) return reply.status(404).send({ error: 'Lead not found' })
      return { lead }
    },
  )

  // ── Growth funnel ───────────────────────────────────────────────────────

  /** Lead → signup → activated → paying over a rolling 30d window.
   *  "Activated" = the tenant has at least one insight (the product did
   *  something for them). "Paying" = plan not free/trial. Per-source rows
   *  join users' attribution to leads' source where both exist. */
  app.get('/operator/funnel', { preHandler: requireOperator(db, 'overview.read') }, async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [
      leadStages,
      leadSources,
      signupSources,
      signups30d,
      leads30d,
      activated,
      paying,
      cohortUsers,
    ] = await Promise.all([
      leads.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]).toArray(),
      leads
        .aggregate([
          { $match: { created_at: { $gte: since } } },
          { $group: { _id: '$source', count: { $sum: 1 } } },
        ])
        .toArray(),
      users
        .aggregate([
          { $match: { created_at: { $gte: since } } },
          {
            $group: { _id: { $ifNull: ['$attribution.utm_source', 'direct'] }, count: { $sum: 1 } },
          },
        ])
        .toArray(),
      users.countDocuments({ created_at: { $gte: since } }),
      leads.countDocuments({ created_at: { $gte: since } }),
      db.collection('insights').distinct('tenant_id'),
      tenants.countDocuments({ plan: { $exists: true, $nin: ['free', 'trial'] } }),
      // Activation cohort — tenants of users who signed up inside the window.
      users
        .find(
          { created_at: { $gte: since } },
          { projection: { _id: 0, tenant_id: 1, created_at: 1 } },
        )
        .toArray(),
    ])
    const sources = new Map<
      string,
      { source: string; leads: number; signups: number; paying: number; trialing: number }
    >()
    for (const s of leadSources) {
      const key = (s['_id'] as string) ?? 'unknown'
      sources.set(key, {
        source: key,
        leads: s['count'] as number,
        signups: 0,
        paying: 0,
        trialing: 0,
      })
    }
    for (const s of signupSources) {
      const key = (s['_id'] as string) ?? 'direct'
      const row = sources.get(key) ?? { source: key, leads: 0, signups: 0, paying: 0, trialing: 0 }
      row.signups = s['count'] as number
      sources.set(key, row)
    }

    // Activation steps — measured from persisted tenant state, not client
    // events (anonymous anon_id events can't be joined to tenants anyway):
    // a tenant "set up" when a financial profile exists, "activated" at its
    // first insight, "connected" when a connector credential lands.
    const cohortTenantIds = [...new Set(cohortUsers.map((u) => u['tenant_id'] as string))]
    let activation: Record<string, unknown> = {
      cohort_signups_30d: cohortUsers.length,
      steps: [] as unknown[],
      median_time_to_first_insight_hours: null,
    }
    if (cohortTenantIds.length > 0) {
      const [profileTenants, firstInsights, connectorTenants] = await Promise.all([
        db
          .collection('family_financial_profile')
          .distinct('tenant_id', { tenant_id: { $in: cohortTenantIds } }),
        db
          .collection('insights')
          .aggregate([
            { $match: { tenant_id: { $in: cohortTenantIds } } },
            { $group: { _id: '$tenant_id', first_at: { $min: '$created_at' } } },
          ])
          .toArray(),
        db
          .collection('connector_credentials')
          .distinct('tenant_id', { tenant_id: { $in: cohortTenantIds } }),
      ])
      const profileSet = new Set(profileTenants.map(String))
      const connectorSet = new Set(connectorTenants.map(String))
      const insightSet = new Set(firstInsights.map((i) => String(i['_id'])))

      // Median hours from signup to first insight — the time-to-activate
      // signal that actually decides whether a new family sticks.
      const tenantSignupAt = new Map<string, number>()
      for (const u of cohortUsers) {
        const t = u['tenant_id'] as string
        const at = (u['created_at'] as Date).getTime()
        tenantSignupAt.set(t, Math.min(tenantSignupAt.get(t) ?? Infinity, at))
      }
      const ttis = firstInsights
        .filter((i) => i['first_at'] instanceof Date)
        .map(
          (i) =>
            ((i['first_at'] as Date).getTime() - (tenantSignupAt.get(String(i['_id'])) ?? 0)) /
            3_600_000,
        )
        .filter((h) => h >= 0)
        .sort((a, b) => a - b)
      const median =
        ttis.length === 0
          ? null
          : ttis.length % 2 === 1
            ? ttis[Math.floor(ttis.length / 2)]
            : (ttis[ttis.length / 2 - 1]! + ttis[ttis.length / 2]!) / 2

      const steps = [
        { key: 'signed_up', label: 'Signed up', count: cohortUsers.length },
        { key: 'profile_completed', label: 'Family profile filled', count: profileSet.size },
        { key: 'first_insight', label: 'First insight received', count: insightSet.size },
        { key: 'connector_connected', label: 'Connector linked', count: connectorSet.size },
      ].map((s) => ({
        ...s,
        pct: cohortUsers.length === 0 ? 0 : Math.round((s.count / cohortUsers.length) * 100),
      }))
      activation = {
        cohort_signups_30d: cohortUsers.length,
        steps,
        median_time_to_first_insight_hours: median === null ? null : Math.round(median * 10) / 10,
      }
    }

    // Revenue leg — the funnel's paying end. "Became paying" is the first
    // credit_ledger plan_grant; with billing v2's ledger off it falls back to
    // billing_period_start, which renewals also stamp — in that mode a
    // long-lived payer can look "new" in a 30d window (bounded, noted).
    // Trialing = free-plan tenant whose signup trial is still running —
    // the conversion pipeline sitting between signup and paying.
    const [firstGrants, payingTenantDocs, trialTenantDocs, sourceTenantPairs] = await Promise.all([
      db
        .collection('credit_ledger')
        .aggregate([
          { $match: { type: 'plan_grant' } },
          { $group: { _id: '$tenant_id', first_at: { $min: '$timestamp' } } },
        ])
        .toArray(),
      tenants
        .find(
          { plan: { $exists: true, $nin: ['free', 'trial'] } },
          { projection: { _id: 0, tenant_id: 1, plan: 1, 'billing.billing_period_start': 1 } },
        )
        .toArray(),
      tenants
        .find(
          {
            plan: { $nin: ['starter', 'growth', 'enterprise'] },
            'billing.trial_ends_at': { $gt: new Date() },
            'billing.trial_expired': { $ne: true },
          },
          { projection: { _id: 0, tenant_id: 1 } },
        )
        .toArray(),
      users
        .aggregate([
          {
            $group: {
              _id: { s: { $ifNull: ['$attribution.utm_source', 'direct'] }, t: '$tenant_id' },
            },
          },
        ])
        .toArray(),
    ])

    const grantAt = new Map(firstGrants.map((g) => [String(g['_id']), g['first_at'] as Date]))
    const paidAt = new Map<string, Date>()
    // A tenant that upgraded mid-trial keeps a future trial_ends_at —
    // paying wins over trialing so it doesn't get counted twice.
    const payingIds = new Set(payingTenantDocs.map((t) => String(t['tenant_id'])))
    const trialing = new Set(
      trialTenantDocs.map((t) => String(t['tenant_id'])).filter((id) => !payingIds.has(id)),
    )
    for (const t of payingTenantDocs) {
      const id = String(t['tenant_id'])
      const at =
        grantAt.get(id) ??
        ((t['billing'] as Record<string, unknown> | undefined)?.['billing_period_start'] as
          Date | undefined)
      if (at instanceof Date) paidAt.set(id, at)
    }
    const newPayers = [...paidAt.entries()].filter(([, at]) => at >= since)

    // Median days from signup to first payment, over tenants who converted
    // in-window — how long the free→paid journey actually takes.
    let medianDaysToPaid: number | null = null
    if (newPayers.length > 0) {
      const payerIds = newPayers.map(([id]) => id)
      const firstSignups = await users
        .aggregate([
          { $match: { tenant_id: { $in: payerIds } } },
          { $group: { _id: '$tenant_id', first_at: { $min: '$created_at' } } },
        ])
        .toArray()
      const signupAt = new Map(firstSignups.map((s) => [String(s['_id']), s['first_at'] as Date]))
      const days = newPayers
        .map(([id, at]) => {
          const s = signupAt.get(id)
          return s instanceof Date ? (at.getTime() - s.getTime()) / 86_400_000 : null
        })
        .filter((d): d is number => d !== null && d >= 0)
        .sort((a, b) => a - b)
      medianDaysToPaid =
        days.length === 0
          ? null
          : days.length % 2 === 1
            ? Math.round(days[Math.floor(days.length / 2)]! * 10) / 10
            : Math.round(((days[days.length / 2 - 1]! + days[days.length / 2]!) / 2) * 10) / 10
    }

    // Per-source paying/trialing — joins every user's utm_source to their
    // tenant's current plan, so the channel table answers "which channels
    // pay", not just "which channels sign people up". A tenant with users
    // from mixed sources attributes to the first pair seen.
    const sourceByTenant = new Map<string, string>()
    for (const p of sourceTenantPairs) {
      const key = p['_id'] as { s: string; t: string }
      if (!sourceByTenant.has(String(key.t)))
        sourceByTenant.set(String(key.t), String(key.s ?? 'direct'))
    }
    for (const tenantId of paidAt.keys()) {
      const source = sourceByTenant.get(tenantId) ?? 'direct'
      const row = sources.get(source) ?? { source, leads: 0, signups: 0, paying: 0, trialing: 0 }
      row.paying += 1
      sources.set(source, row)
    }
    for (const tenantId of trialing) {
      const source = sourceByTenant.get(tenantId) ?? 'direct'
      const row = sources.get(source) ?? { source, leads: 0, signups: 0, paying: 0, trialing: 0 }
      row.trialing += 1
      sources.set(source, row)
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
      activation,
      revenue: {
        paying_tenants: payingTenantDocs.length,
        paying_30d: newPayers.length,
        trialing_tenants: trialing.size,
        // Only starter ("Keel Plus") has a real price — £7.99/mo. Dormant
        // growth/enterprise tiers count toward paying totals but not MRR.
        mrr_pence: payingTenantDocs.filter((t) => t['plan'] === 'starter').length * 799,
        currency: 'GBP',
        median_days_to_paid: medianDaysToPaid,
      },
    }
  })

  // ── Referrals ───────────────────────────────────────────────────────────

  /** Referral leaderboard — the growth loop's own funnel, operator-visible:
   *  who has codes, who referred whom, pending vs rewarded. Referral docs
   *  are tenant-keyed (a tenant IS the referring family unit — see
   *  referrals.ts); reward execution lives in rewardReferralIfPending on
   *  the referred tenant's first profile submit, atomic on status. This is
   *  read-only visibility — 25 credits both ways per conversion. */
  app.get('/operator/referrals', { preHandler: requireOperator(db, 'leads.read') }, async () => {
    const [codes, docs] = await Promise.all([
      db
        .collection('referral_codes')
        .find({}, { projection: { _id: 0, tenant_id: 1, code: 1 } })
        .toArray(),
      db
        .collection('referrals')
        .find({}, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .toArray(),
    ])
    const codeBy = new Map(codes.map((c) => [c['tenant_id'] as string, c['code'] as string]))
    const tenantIds = [
      ...new Set([
        ...codes.map((c) => c['tenant_id'] as string),
        ...docs.flatMap((d) => [
          d['referrer_tenant_id'] as string,
          d['referred_tenant_id'] as string,
        ]),
      ]),
    ]
    const tenantNames = new Map<string, string>()
    if (tenantIds.length > 0) {
      for (const t of await tenants
        .find({ tenant_id: { $in: tenantIds } }, { projection: { _id: 0, tenant_id: 1, name: 1 } })
        .toArray()) {
        tenantNames.set(t['tenant_id'] as string, (t['name'] as string) ?? '')
      }
    }

    const byReferrer = new Map<
      string,
      { tenant_id: string; code: string; pending: number; rewarded: number }
    >()
    for (const d of docs) {
      const ref = d['referrer_tenant_id'] as string
      const row = byReferrer.get(ref) ?? {
        tenant_id: ref,
        code: codeBy.get(ref) ?? '',
        pending: 0,
        rewarded: 0,
      }
      if (d['status'] === 'rewarded') row.rewarded += 1
      else if (d['status'] === 'pending') row.pending += 1
      byReferrer.set(ref, row)
    }
    // Codes with zero referrals still appear — an issued code with no
    // conversions is itself a signal (shared vs never-shared).
    for (const c of codes) {
      const t = c['tenant_id'] as string
      if (!byReferrer.has(t))
        byReferrer.set(t, { tenant_id: t, code: c['code'] as string, pending: 0, rewarded: 0 })
    }

    const leaderboard = [...byReferrer.values()]
      .map((r) => ({
        ...r,
        tenant_name: tenantNames.get(r.tenant_id) ?? 'Unknown',
        referrals: r.pending + r.rewarded,
      }))
      .sort((a, b) => b.rewarded - a.rewarded || b.referrals - a.referrals)
      .slice(0, 100)
    const pending = docs.filter((d) => d['status'] === 'pending').length
    const rewarded = docs.filter((d) => d['status'] === 'rewarded').length
    return {
      totals: {
        codes_issued: codes.length,
        referrals: docs.length,
        pending,
        rewarded,
        credits_granted: rewarded * 2 * 25, // both sides get REFERRAL_REWARD_CREDITS
      },
      leaderboard,
      recent: docs.slice(0, 20).map((d) => ({
        referrer_tenant_id: d['referrer_tenant_id'],
        referrer_name: tenantNames.get(d['referrer_tenant_id'] as string) ?? 'Unknown',
        referred_name: tenantNames.get(d['referred_tenant_id'] as string) ?? 'Unknown',
        code: d['code'],
        status: d['status'],
        created_at: d['created_at'],
        rewarded_at: d['rewarded_at'] ?? null,
      })),
    }
  })

  // ── Promotions ──────────────────────────────────────────────────────────
  // Doc shape matches the redemption path in billing/promo-codes.ts:
  // { code, grant_credits, max_uses, used_count, active, expires_at?, created_at }.

  const promotions = db.collection('promo_codes')
  const redemptions = db.collection('promo_redemptions')

  app.get(
    '/operator/promotions',
    { preHandler: requireOperator(db, 'promotions.read') },
    async (request, reply) => {
      const parsed = QuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { q, limit, offset } = parsed.data
      const filter: Record<string, unknown> = q ? { code: safeRegex(q) } : {}
      const [items, total] = await Promise.all([
        promotions
          .find(filter, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .skip(offset)
          .limit(limit)
          .toArray(),
        promotions.countDocuments(filter),
      ])
      return { promotions: items, total, limit, offset }
    },
  )

  app.get<{ Params: { code: string } }>(
    '/operator/promotions/:code/redemptions',
    { preHandler: requireOperator(db, 'promotions.read') },
    async (request, reply) => {
      const code = request.params.code.trim().toUpperCase()
      const promo = await promotions.findOne({ code }, { projection: { _id: 0 } })
      if (!promo) return reply.status(404).send({ error: 'Promotion not found' })
      const items = await redemptions
        .find({ code }, { projection: { _id: 0 } })
        .sort({ redeemed_at: -1 })
        .limit(200)
        .toArray()
      return { promotion: promo, redemptions: items }
    },
  )

  app.post(
    '/operator/promotions',
    { preHandler: requireOperator(db, 'promotions.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = PromotionCreateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid promotion', issues: parsed.error.issues })
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
      await audit.log(request, 'operator.promotion.create', 'promotion', normalized, reason, {
        grant_credits,
        max_uses,
      })
      return { ok: true, code: normalized }
    },
  )

  app.post<{ Params: { code: string } }>(
    '/operator/promotions/:code/deactivate',
    { preHandler: requireOperator(db, 'promotions.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const code = request.params.code.trim().toUpperCase()
      const result = await promotions.updateOne(
        { code, active: true },
        { $set: { active: false, deactivated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Promotion not found or already inactive' })
      await audit.log(
        request,
        'operator.promotion.deactivate',
        'promotion',
        code,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { code: string } }>(
    '/operator/promotions/:code/reactivate',
    { preHandler: requireOperator(db, 'promotions.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const code = request.params.code.trim().toUpperCase()
      const result = await promotions.updateOne(
        { code, active: false },
        { $set: { active: true }, $unset: { deactivated_at: '' } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Promotion not found or already active' })
      await audit.log(
        request,
        'operator.promotion.reactivate',
        'promotion',
        code,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  // ── Blog / SEO content ──────────────────────────────────────────────────
  // Operator-managed replacement for the parked admin-key write surface in
  // blog.ts — same collection, same doc shape, but permissioned, reasoned,
  // and audited. Public GETs stay untouched.

  const blogPosts = db.collection('blog_posts')
  await blogPosts.createIndex({ slug: 1 }, { unique: true }).catch(() => {})

  app.get(
    '/operator/blog/posts',
    { preHandler: requireOperator(db, 'marketing.read') },
    async () => {
      const posts = await blogPosts
        .find({}, { projection: { _id: 0, content: 0 } })
        .sort({ created_at: -1 })
        .limit(200)
        .toArray()
      return { posts }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/operator/blog/posts/:id',
    { preHandler: requireOperator(db, 'marketing.read') },
    async (request, reply) => {
      const post = await blogPosts.findOne({ id: request.params.id }, { projection: { _id: 0 } })
      if (!post) return reply.status(404).send({ error: 'Post not found' })
      return { post }
    },
  )

  app.post(
    '/operator/blog/posts',
    { preHandler: requireOperator(db, 'marketing.manage') },
    async (request, reply) => {
      const parsed = BlogPostCreateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid post', issues: parsed.error.issues })
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
      await audit.log(request, 'operator.blog.create', 'blog_post', post.id, reason, {
        slug: post.slug,
        title: post.title,
      })
      return { post }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/operator/blog/posts/:id',
    { preHandler: requireOperator(db, 'marketing.manage') },
    async (request, reply) => {
      const parsed = BlogPostUpdateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
      const { reason, ...data } = parsed.data
      if (Object.keys(data).length === 0)
        return reply.status(400).send({ error: 'Nothing to update' })
      const result = await blogPosts.updateOne(
        { id: request.params.id },
        { $set: { ...data, updated_at: new Date() } },
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Post not found' })
      await audit.log(request, 'operator.blog.update', 'blog_post', request.params.id, reason, {
        fields: Object.keys(data),
      })
      const post = await blogPosts.findOne({ id: request.params.id }, { projection: { _id: 0 } })
      return { post }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/blog/posts/:id/publish',
    { preHandler: requireOperator(db, 'marketing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await blogPosts.updateOne(
        { id: request.params.id, published: { $ne: true } },
        { $set: { published: true, published_at: new Date(), updated_at: new Date() } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Post not found or already published' })
      await audit.log(
        request,
        'operator.blog.publish',
        'blog_post',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/blog/posts/:id/unpublish',
    { preHandler: requireOperator(db, 'marketing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await blogPosts.updateOne(
        { id: request.params.id, published: true },
        { $set: { published: false, updated_at: new Date() }, $unset: { published_at: '' } },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Post not found or not published' })
      await audit.log(
        request,
        'operator.blog.unpublish',
        'blog_post',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  // ── Segment campaigns ───────────────────────────────────────────────────
  // One-shot targeted email: operator drafts copy, previews the audience,
  // fires the send. The send button is the approval gate — externally-facing
  // communication never fires autonomously (trust model). Consent/opt-out
  // + dedup rails live in marketing/campaigns.ts.

  const campaigns = campaignsCol(db)

  app.get(
    '/operator/campaigns',
    { preHandler: requireOperator(db, 'marketing.read') },
    async () => {
      const list = await campaigns
        .find({}, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .limit(100)
        .toArray()
      // Roll the SendGrid event-webhook engagement up per campaign — the ledger
      // rows carry campaign_id, so opens/clicks/bounces join back exactly.
      const engagement = await lifecycleSendsCol(db)
        .aggregate<{
          _id: string
          opened: number
          clicked: number
          bounced: number
        }>([
          { $match: { campaign_id: { $in: list.map((c) => c.id) } } },
          {
            $group: {
              _id: '$campaign_id',
              opened: { $sum: { $cond: [{ $ifNull: ['$opened_at', false] }, 1, 0] } },
              clicked: { $sum: { $cond: [{ $ifNull: ['$clicked_at', false] }, 1, 0] } },
              bounced: { $sum: { $cond: [{ $ifNull: ['$bounced', false] }, 1, 0] } },
            },
          },
        ])
        .toArray()
      const byId = new Map(engagement.map((e) => [e._id, e]))
      return { campaigns: list.map((c) => ({ ...c, engagement: byId.get(c.id) ?? null })) }
    },
  )

  app.post(
    '/operator/campaigns',
    { preHandler: requireOperator(db, 'marketing.manage') },
    async (request, reply) => {
      const parsed = CampaignCreateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid campaign', issues: parsed.error.issues })
      const { reason, ...data } = parsed.data
      const campaign: CampaignDoc = {
        id: randomBytes(8).toString('hex'),
        ...data,
        status: 'draft',
        created_by: request.operatorContext?.user_id ?? 'unknown',
        created_at: new Date(),
      }
      await campaigns.insertOne(campaign)
      await audit.log(request, 'operator.campaign.create', 'campaign', campaign.id, reason, {
        name: campaign.name,
        audience: campaign.filter.audience,
      })
      const { _id: _omit, ...out } = campaign as CampaignDoc & { _id?: unknown }
      return { campaign: out }
    },
  )

  // Audience count for a filter without creating anything — the "how many
  // people is this?" check before firing.
  app.post(
    '/operator/campaigns/preview',
    { preHandler: requireOperator(db, 'marketing.read') },
    async (request, reply) => {
      const parsed = CampaignFilterSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid filter', issues: parsed.error.issues })
      const recipients = await resolveAudience(db, parsed.data)
      const users = recipients.filter((r) => r.kind === 'user').length
      return { count: recipients.length, users, leads: recipients.length - users }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/campaigns/:id/send',
    { preHandler: requireOperator(db, 'marketing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const campaign = await campaigns.findOne({ id: request.params.id })
      if (!campaign) return reply.status(404).send({ error: 'Campaign not found' })
      if (campaign.status !== 'draft')
        return reply.status(409).send({ error: `Campaign already ${campaign.status}` })
      // Bulk external send — four-eyes.
      const gate = await checkDualApproval(db, audit, request, {
        action: 'operator.campaign.send',
        targetType: 'campaign',
        targetId: request.params.id,
        payload: { reason: parsed.data.reason },
        permission: 'marketing.manage',
        reason: parsed.data.reason,
      })
      if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)
      // Claim the send BEFORE queueing — racing double-clicks get 409 off
      // the status flip, and lifecycle_sends dedup is the second lock anyway.
      // Status moves draft → sending; the send worker flips it to 'sent'
      // when every claimed recipient has settled (B11 durable bulk send).
      const claimed = await campaigns.updateOne(
        { id: campaign.id, status: 'draft' },
        { $set: { status: 'sending' } },
      )
      if (claimed.modifiedCount === 0)
        return reply.status(409).send({ error: `Campaign already ${campaign.status}` })
      try {
        const stats = await queueCampaignSend(db, campaign)
        const after = await campaigns.findOne({ id: campaign.id })
        await audit.log(
          request,
          'operator.campaign.send',
          'campaign',
          campaign.id,
          parsed.data.reason,
          stats,
          { before: campaign, after },
        )
        return { ok: true, stats }
      } catch (err) {
        // Roll the draft back so a transient failure (marketing_paused, DB
        // blip, queue down) doesn't wedge the campaign in a half-queued
        // state it can't leave — pending claims are skipped by a retry's
        // claimSend only if the recipient was already settled.
        await campaigns.updateOne({ id: campaign.id }, { $set: { status: 'draft' } })
        throw err
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/campaigns/:id/pause',
    { preHandler: requireOperator(db, 'marketing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const ok = await pauseCampaign(db, request.params.id)
      if (!ok) return reply.status(409).send({ error: 'Campaign is not in a sending state' })
      await audit.log(
        request,
        'operator.campaign.pause',
        'campaign',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/campaigns/:id/resume',
    { preHandler: requireOperator(db, 'marketing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const exists = await campaigns.findOne(
        { id: request.params.id },
        { projection: { _id: 0, status: 1 } },
      )
      if (!exists) return reply.status(404).send({ error: 'Campaign not found' })
      const requeued = await resumeCampaign(db, request.params.id)
      if (requeued === -1) return reply.status(409).send({ error: `Campaign is ${exists.status}` })
      await audit.log(
        request,
        'operator.campaign.resume',
        'campaign',
        request.params.id,
        parsed.data.reason,
        { requeued },
      )
      return { ok: true, requeued }
    },
  )

  // ── Billing ─────────────────────────────────────────────────────────────
  // Read-mostly: plan/status distribution, credit exposure, Stripe webhook
  // intake. The only mutation is a bounded, ledger-recorded credit
  // adjustment — Stripe remains authoritative for subscriptions.

  app.get('/operator/billing', { preHandler: requireOperator(db, 'billing.read') }, async () => {
    const [
      byPlan,
      byStatus,
      stripeLinked,
      lowCredit,
      creditsOutstanding,
      recentWebhooks,
      recentAdjustments,
      churnReasons,
      churned,
    ] = await Promise.all([
      tenants
        .aggregate([{ $group: { _id: { $ifNull: ['$plan', 'unknown'] }, count: { $sum: 1 } } }])
        .toArray(),
      tenants
        .aggregate([{ $group: { _id: { $ifNull: ['$status', 'unknown'] }, count: { $sum: 1 } } }])
        .toArray(),
      tenants.countDocuments({ stripe_customer_id: { $exists: true, $ne: null } }),
      // LOW_CREDIT_THRESHOLD in billing-constants is 3 — unlimited plans
      // (MAX_SAFE_INTEGER) can't match $lte so they're naturally excluded.
      tenants.countDocuments({ 'billing.credits_balance': { $lte: 3 } }),
      tenants
        .aggregate([
          {
            $group: {
              _id: null,
              total: {
                $sum: {
                  $cond: [
                    { $eq: ['$billing.credits_balance', Number.MAX_SAFE_INTEGER] },
                    0,
                    { $ifNull: ['$billing.credits_balance', 0] },
                  ],
                },
              },
            },
          },
        ])
        .toArray(),
      db
        .collection('stripe_webhook_events')
        .find({}, { projection: { _id: 0 } })
        .sort({ processed_at: -1 })
        .limit(20)
        .toArray(),
      db
        .collection('credit_ledger')
        .find({ type: 'admin_adjustment' }, { projection: { _id: 0 } })
        .sort({ timestamp: -1 })
        .limit(10)
        .toArray(),
      // Churn telemetry — churn_reason comes from Stripe's portal
      // cancellation survey (cancellation_details), churned_at from the
      // subscription.deleted webhook.
      tenants
        .aggregate([
          { $match: { 'billing.churned_at': { $exists: true } } },
          {
            $group: { _id: { $ifNull: ['$billing.churn_reason', 'unstated'] }, count: { $sum: 1 } },
          },
        ])
        .toArray(),
      tenants
        .find(
          { 'billing.churned_at': { $exists: true } },
          {
            projection: {
              _id: 0,
              tenant_id: 1,
              name: 1,
              'billing.churn_reason': 1,
              'billing.churn_feedback': 1,
              'billing.churned_at': 1,
            },
          },
        )
        .sort({ 'billing.churned_at': -1 })
        .limit(20)
        .toArray(),
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
      churn_by_reason: Object.fromEntries(churnReasons.map((r) => [r['_id'], r['count']])),
      recent_churned: churned.map((t) => ({
        tenant_id: t['tenant_id'],
        name: t['name'],
        reason: (t['billing'] as Record<string, unknown> | undefined)?.['churn_reason'] ?? null,
        feedback: (t['billing'] as Record<string, unknown> | undefined)?.['churn_feedback'] ?? null,
        churned_at: (t['billing'] as Record<string, unknown> | undefined)?.['churned_at'] ?? null,
      })),
    }
  })

  // Unit economics (B8): all-service external spend unioned across
  // spend_events + llm_usage, cost per active family, top spenders.
  // Messaging rows are list-price estimates (spend_events.estimated=true)
  // until billed reconciliation lands — flagged P2 in the register.
  app.get<{ Querystring: { days?: string } }>(
    '/operator/unit-economics',
    { preHandler: requireOperator(db, 'billing.read') },
    async (request) => {
      const days = Math.min(Math.max(Number(request.query.days) || 30, 1), 365)
      const econ = await platformUnitEconomics(db, days)
      return {
        ...econ,
        total_spend_display: formatMicroDollars(econ.total_spend_microdollars),
        cost_per_active_family_display: formatMicroDollars(
          econ.cost_per_active_family_microdollars,
        ),
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/operator/billing/tenants/:id',
    { preHandler: requireOperator(db, 'billing.read') },
    async (request, reply) => {
      const tenant = await tenants.findOne(
        { $or: [{ tenant_id: request.params.id }, { id: request.params.id }] },
        {
          projection: {
            _id: 0,
            tenant_id: 1,
            name: 1,
            plan: 1,
            status: 1,
            billing: 1,
            stripe_customer_id: 1,
            stripe_subscription_id: 1,
            created_at: 1,
          },
        },
      )
      if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
      const ledger = await getLedgerHistory(db, {
        tenantId: tenant['tenant_id'] as string,
        limit: 50,
      })
      return { tenant, ledger: ledger.entries, ledger_has_more: ledger.has_more }
    },
  )

  /** Manual credit adjustment. Bounded (±10k), never takes the balance
   *  negative, always ledgered (when billing v2 is on) and audited. */
  app.post<{ Params: { id: string } }>(
    '/operator/billing/tenants/:id/adjust-credits',
    { preHandler: requireOperator(db, 'billing.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = CreditAdjustSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid adjustment', issues: parsed.error.issues })
      const { amount, reason } = parsed.data

      const tenant = await tenants.findOne({
        $or: [{ tenant_id: request.params.id }, { id: request.params.id }],
      })
      if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
      const tenantId = tenant['tenant_id'] as string
      if (tenant['billing']?.['credits_balance'] === Number.MAX_SAFE_INTEGER) {
        return reply
          .status(409)
          .send({ error: 'Unlimited plan — balance adjustments do not apply' })
      }

      // Pre-check the balance before creating an approval request — an
      // adjustment that can never apply shouldn't burn a second operator's
      // review. The atomic $gte claim below still guards the real mutation.
      const currentBalance = (tenant['billing']?.['credits_balance'] as number | undefined) ?? 0
      if (amount < 0 && currentBalance < -amount) {
        return reply.status(409).send({ error: 'Insufficient credit balance for this adjustment' })
      }

      // Money movement — four-eyes. The hash binds the approval to the
      // exact amount+reason, so the confirmation can't be spent on a
      // different adjustment.
      const gate = await checkDualApproval(db, audit, request, {
        action: 'operator.billing.adjust_credits',
        targetType: 'tenant',
        targetId: tenantId,
        payload: { amount, reason },
        permission: 'billing.manage',
        reason,
      })
      if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)

      // Negative adjustments claim atomically against the balance so the
      // result can never go below zero (same shape as the C2 charge guard).
      const filter: Record<string, unknown> =
        amount < 0
          ? { tenant_id: tenantId, 'billing.credits_balance': { $gte: -amount } }
          : { tenant_id: tenantId }
      const updated = await tenants.findOneAndUpdate(
        filter,
        { $inc: { 'billing.credits_balance': amount }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' },
      )
      if (!updated)
        return reply.status(409).send({ error: 'Insufficient credit balance for this adjustment' })

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
      await audit.log(
        request,
        'operator.billing.adjust_credits',
        'tenant',
        tenantId,
        reason,
        { amount },
        { before: tenant, after: updated },
      )

      return { ok: true, credits_balance: updated['billing']?.['credits_balance'] }
    },
  )

  // ── Support inbox ────────────────────────────────────────────────────────
  // Human half of the AI-first support channel. Users hit Keel triage first
  // (POST /support/ask); cases land here only when AI couldn't resolve. The
  // inbox sorts by updated_at — it's a queue, not a log.
  const supportCases = db.collection<SupportCaseDoc>('support_cases')

  app.get(
    '/operator/support',
    { preHandler: requireOperator(db, 'support.read') },
    async (request, reply) => {
      const parsed = SupportQuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { q, status, limit, offset, cursor } = parsed.data
      const filter: Record<string, unknown> = {}
      if (q) {
        const pattern = safeRegex(q)
        filter['$or'] = [{ subject: pattern }, { email: pattern }, { id: pattern }]
      }
      if (status) filter['status'] = status
      const decoded = decodeCursor(cursor)
      if (decoded === null) return reply.status(400).send({ error: 'Invalid cursor' })
      if (decoded) filter['$and'] = [cursorFilter(decoded, 'id', 'updated_at')]
      const [items, total, counts] = await Promise.all([
        supportCases
          .find(filter, { projection: { _id: 0 } })
          .sort({ updated_at: -1, id: -1 })
          .skip(decoded ? 0 : offset)
          .limit(limit)
          .toArray(),
        decoded ? Promise.resolve(undefined) : supportCases.countDocuments(filter),
        supportCases.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
      ])
      const last = items[items.length - 1]
      const nextCursor =
        items.length === limit && last ? encodeCursor(last, 'id', 'updated_at') : undefined
      return {
        cases: items,
        total,
        limit,
        offset,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
        statuses: Object.fromEntries(counts.map((s) => [s['_id'], s['count']])),
      }
    },
  )

  /** Case detail + the account context an operator needs beside the thread
   *  — plan, tenant, member count — so the reply doesn't need a second
   *  page open to know who's asking. */
  app.get<{ Params: { id: string } }>(
    '/operator/support/:id',
    { preHandler: requireOperator(db, 'support.read') },
    async (request, reply) => {
      const doc = await supportCases.findOne({ id: request.params.id }, { projection: { _id: 0 } })
      if (!doc) return reply.status(404).send({ error: 'Case not found' })
      const [user, tenant, memberCount] = await Promise.all([
        users.findOne(
          { id: doc['user_id'] },
          { projection: { _id: 0, id: 1, email: 1, name: 1, status: 1, created_at: 1 } },
        ),
        tenants.findOne(
          { tenant_id: doc['tenant_id'] },
          { projection: { _id: 0, tenant_id: 1, name: 1, plan: 1, status: 1 } },
        ),
        users.countDocuments({ tenant_id: doc['tenant_id'] }),
      ])
      return { case: doc, user, tenant, member_count: memberCount }
    },
  )

  /** Operator reply — the action itself is the reason, so the audit entry
   *  records the case reference rather than demanding a typed reason for
   *  every chat message. */
  app.post<{ Params: { id: string } }>(
    '/operator/support/:id/reply',
    { preHandler: requireOperator(db, 'support.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = SupportMessageWriteSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
      const doc = await supportCases.findOne(
        { id: request.params.id },
        { projection: { subject: 1, user_id: 1 } },
      )
      if (!doc) return reply.status(404).send({ error: 'Case not found' })
      const operator = request.operatorContext
      const now = new Date()
      const operatorUser = await users.findOne(
        { id: operator?.user_id },
        { projection: { name: 1 } },
      )
      const result = await supportCases.updateOne(
        { id: request.params.id },
        {
          $push: {
            messages: {
              id: randomUUID(),
              author: 'operator',
              author_id: operator?.user_id,
              author_name: (operatorUser?.['name'] as string) ?? 'Operator',
              text: parsed.data.text,
              created_at: now,
            } as SupportMessage,
          },
          $set: { status: 'answered', updated_at: now },
        },
      )
      if (result.matchedCount === 0) return reply.status(404).send({ error: 'Case not found' })
      await audit.log(
        request,
        'operator.support.reply',
        'support_case',
        request.params.id,
        `Replied to "${doc['subject']}"`,
      )
      return { ok: true }
    },
  )

  /** AI draft — LLM proposes a reply grounded in the thread + account
   *  context; the operator edits and sends. Never auto-sent: external-facing
   *  text a human hasn't read is a publishing action, not a draft. */
  app.post<{ Params: { id: string } }>(
    '/operator/support/:id/draft',
    { preHandler: requireOperator(db, 'support.manage') },
    async (request, reply) => {
      const doc = await supportCases.findOne({ id: request.params.id }, { projection: { _id: 0 } })
      if (!doc) return reply.status(404).send({ error: 'Case not found' })
      const user = await users.findOne(
        { id: doc['user_id'] },
        { projection: { name: 1, email: 1, status: 1 } },
      )
      const tenant = await tenants.findOne(
        { tenant_id: doc['tenant_id'] },
        { projection: { plan: 1 } },
      )
      const thread = ((doc['messages'] as Array<{ author: string; text: string }>) ?? [])
        .map(
          (m) =>
            `${m.author === 'user' ? 'Customer' : m.author === 'keel' ? 'Keel (AI)' : 'Operator'}: ${m.text}`,
        )
        .join('\n')
      const prompt =
        `Customer: ${(user?.['name'] as string) ?? 'unknown'} (${(user?.['email'] as string) ?? 'no email'}), account status ${(user?.['status'] as string) ?? 'active'}, plan ${(tenant?.['plan'] as string) ?? 'free'}.\n` +
        `Case subject: ${doc['subject']}\n\nThread so far:\n${thread}\n\nDraft a reply for the operator.`
      try {
        const draft = await taskLlm('support.reply_draft.v1', doc['tenant_id'] as string)(
          `You draft support replies for LifeKeel operators. Write a helpful, honest reply to the customer's latest message. Never give financial/investment/insurance/legal advice or recommend specific providers. If the request needs an account change (billing, deletion, reset), say the team will handle it — never promise specifics you can't verify. Plain text, 2–5 sentences, no greeting sign-off boilerplate beyond a name placeholder if needed.`,
          prompt,
        )
        return { draft }
      } catch (err) {
        request.log.warn({ err }, 'Support draft LLM call failed')
        return reply.status(503).send({ error: 'AI drafting unavailable right now' })
      }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/support/:id/resolve',
    { preHandler: requireOperator(db, 'support.manage') },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await supportCases.updateOne(
        { id: request.params.id, status: { $ne: 'resolved' } },
        {
          $set: {
            status: 'resolved',
            resolved_by: request.operatorContext?.user_id,
            resolved_at: new Date(),
            updated_at: new Date(),
          },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Case not found or already resolved' })
      await audit.log(
        request,
        'operator.support.resolve',
        'support_case',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/operator/support/:id/reopen',
    { preHandler: requireOperator(db, 'support.manage') },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await supportCases.updateOne(
        { id: request.params.id, status: 'resolved' },
        {
          $set: { status: 'open', updated_at: new Date() },
          $unset: { resolved_by: '', resolved_at: '' },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Case not found or not resolved' })
      await audit.log(
        request,
        'operator.support.reopen',
        'support_case',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  // ── Alert triage state ──────────────────────────────────────────────────
  // Attention-feed items are computed live each load — this collection only
  // persists the *triage decision* (ack/snooze/resolve) per signal, keyed by
  // dedup_key, so the feed itself needs no cron materializing rows. Resolve
  // records the signal_value it resolved at; if the underlying count grows
  // past that, the client re-surfaces the item — resolved is "I've seen this
  // exact state", not a mute forever.

  const alerts = db.collection('operator_alerts')
  const AlertStateSchema = z.object({
    dedup_key: z.string().min(1).max(120),
    action: z.enum(['ack', 'snooze', 'resolve', 'reopen']),
    title: z.string().max(300).optional(),
    severity: z.enum(['info', 'warning', 'danger']).optional(),
    href: z.string().max(300).optional(),
    signal_value: z.number().int().min(0).optional(),
  })

  app.get('/operator/alerts', { preHandler: requireOperator(db, 'overview.read') }, async () => {
    const docs = await alerts.find({}, { projection: { _id: 0 } }).toArray()
    return { alerts: docs }
  })

  app.post(
    '/operator/alerts/state',
    { preHandler: requireOperator(db, 'overview.read') },
    async (request, reply) => {
      const parsed = AlertStateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues })
      const { dedup_key, action, title, severity, href, signal_value } = parsed.data
      const now = new Date()
      const set: Record<string, unknown> = {
        status:
          action === 'ack'
            ? 'ack'
            : action === 'snooze'
              ? 'snoozed'
              : action === 'resolve'
                ? 'resolved'
                : 'open',
        updated_by: request.operatorContext?.user_id,
        updated_at: now,
        ...(title ? { title } : {}),
        ...(severity ? { severity } : {}),
        ...(href ? { href } : {}),
        ...(signal_value !== undefined ? { signal_value } : {}),
      }
      if (action === 'snooze') set['snoozed_until'] = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      else set['snoozed_until'] = null
      if (action === 'resolve') set['resolved_signal_value'] = signal_value ?? null
      await alerts.updateOne(
        { dedup_key },
        { $set: set, $setOnInsert: { dedup_key, created_at: now } },
        { upsert: true },
      )
      await audit.log(
        request,
        `operator.alert.${action}` as const,
        'alert',
        dedup_key,
        title ?? dedup_key,
      )
      return { ok: true }
    },
  )

  // ── Autopilot ───────────────────────────────────────────────────────────
  // Per-rule toggles over the Tier 0/1 registry in operator/autopilot.ts.
  // Every rule defaults OFF — enabling is a deliberate, audited act. The
  // NEVER_AUTONOMOUS families (erase, publish, credit adjust, operator
  // grants, …) have no registry entry at all: PUT rejects unknown rules,
  // so config can never create autonomy the code didn't design for.

  const autopilotRules = db.collection('autopilot_rules')
  const autopilotActions = db.collection('autopilot_actions')
  const AutopilotUpdateSchema = z.object({
    enabled: z.boolean().optional(),
    max_blast_radius: z.number().int().min(1).max(500).optional(),
    cooldown_minutes: z.number().int().min(5).max(10080).optional(),
    reason: z.string().trim().min(5).max(500),
  })

  app.get(
    '/operator/autopilot',
    { preHandler: requireOperator(db, 'operations.read') },
    async () => {
      const [ruleRows, recent] = await Promise.all([
        listAutopilotRules(db),
        autopilotActions
          .find({}, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .limit(50)
          .toArray(),
      ])
      return { rules: ruleRows, recent_actions: recent, never_autonomous: NEVER_AUTONOMOUS }
    },
  )

  app.put<{ Params: { rule: string } }>(
    '/operator/autopilot/:rule',
    { preHandler: requireOperator(db, 'operations.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = AutopilotUpdateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
      const rule = getAutopilotRule(request.params.rule)
      if (!rule)
        return reply
          .status(404)
          .send({ error: 'Unknown autopilot rule — not in the automatable registry' })
      const { enabled, max_blast_radius, cooldown_minutes, reason } = parsed.data
      if (
        enabled === undefined &&
        max_blast_radius === undefined &&
        cooldown_minutes === undefined
      ) {
        return reply.status(400).send({ error: 'Nothing to update' })
      }
      const set: Record<string, unknown> = {
        updated_by: request.operatorContext?.user_id,
        updated_at: new Date(),
      }
      if (enabled !== undefined) set['enabled'] = enabled
      if (max_blast_radius !== undefined) set['max_blast_radius'] = max_blast_radius
      if (cooldown_minutes !== undefined) set['cooldown_minutes'] = cooldown_minutes
      await autopilotRules.updateOne(
        { rule: rule.id },
        { $set: set, $setOnInsert: { rule: rule.id } },
        { upsert: true },
      )
      await audit.log(request, 'operator.autopilot.update', 'autopilot_rule', rule.id, reason, {
        changes: { enabled, max_blast_radius, cooldown_minutes },
      })
      const updated = await autopilotRules.findOne({ rule: rule.id }, { projection: { _id: 0 } })
      return {
        rule: { ...rule.defaults, ...updated, label: rule.label, description: rule.description },
      }
    },
  )

  app.get(
    '/operator/autopilot/actions',
    { preHandler: requireOperator(db, 'operations.read') },
    async (request, reply) => {
      const parsed = QuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { limit, offset, cursor } = parsed.data
      const decoded = decodeCursor(cursor)
      if (decoded === null) return reply.status(400).send({ error: 'Invalid cursor' })
      const filter: Record<string, unknown> = {}
      if (decoded) filter['$and'] = [cursorFilter(decoded, 'id')]
      const items = await autopilotActions
        .find(filter, { projection: { _id: 0 } })
        .sort({ created_at: -1, id: -1 })
        .limit(limit + 1)
        .toArray()
      const page = items.slice(0, limit)
      const nextCursor =
        items.length > limit ? encodeCursor(page[page.length - 1]!, 'id') : undefined
      return { actions: page, ...(nextCursor ? { next_cursor: nextCursor } : {}) }
    },
  )

  /** Approve a Tier-2 proposal — executes the stored payload server-side
   *  through the same mutation the corresponding manual endpoint performs.
   *  The proposal carries its own required_permission (users.manage for a
   *  suspend, marketing.manage for a draft) — the approving operator's
   *  roles must satisfy it, which is a stricter gate than the route's own
   *  operations.read. */
  app.post<{ Params: { id: string } }>(
    '/operator/autopilot/proposals/:id/approve',
    { preHandler: requireOperator(db, 'operations.read', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const action = await autopilotActions.findOne({ id: request.params.id })
      if (!action || action['status'] !== 'proposed' || !action['proposal']) {
        return reply.status(404).send({ error: 'Proposal not found or already resolved' })
      }
      const proposal = action['proposal'] as NonNullable<AutopilotActionDoc['proposal']>
      const roles = (request.operatorContext?.roles ?? []) as PlatformRole[]
      if (!hasOperatorPermission(roles, proposal.required_permission as OperatorPermission)) {
        return reply
          .status(403)
          .send({ error: `This proposal requires ${proposal.required_permission}` })
      }
      const handler = PROPOSAL_HANDLERS[proposal.kind]
      if (!handler)
        return reply.status(400).send({ error: `Unknown proposal kind: ${proposal.kind}` })

      // Claim first: proposed → approved is atomic, so two racing approvers
      // can't both execute the underlying mutation. A crash mid-handler
      // leaves 'approved' — visible as stuck, never silently re-run.
      const claim = await autopilotActions.updateOne(
        { id: action['id'], status: 'proposed' },
        {
          $set: {
            status: 'approved',
            resolved_by: request.operatorContext?.user_id,
            resolved_at: new Date(),
          },
        },
      )
      if (claim.modifiedCount === 0)
        return reply.status(409).send({ error: 'Proposal already resolved' })

      let result: string
      let finalStatus: 'executed' | 'failed' = 'executed'
      try {
        result = await handler(db, proposal.payload, {
          llmFor: taskLlmFor('marketing.social_draft.v1'),
        })
      } catch (err) {
        finalStatus = 'failed'
        result = String(err).slice(0, 300)
      }
      await autopilotActions.updateOne(
        { id: action['id'] },
        { $set: { status: finalStatus, result } },
      )
      await audit.log(
        request,
        'operator.autopilot.approve',
        'autopilot_action',
        action['id'] as string,
        parsed.data.reason,
        {
          kind: proposal.kind,
          target: action['target_id'],
          status: finalStatus,
          result,
        },
      )
      if (finalStatus === 'failed')
        return reply.status(502).send({ error: `Proposal execution failed: ${result}` })
      return { ok: true, result }
    },
  )

  /** Reject a proposal — the dedup key keeps it from re-appearing; the
   *  rejection reason lands on the ledger row. */
  app.post<{ Params: { id: string } }>(
    '/operator/autopilot/proposals/:id/reject',
    { preHandler: requireOperator(db, 'operations.manage') },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await autopilotActions.updateOne(
        { id: request.params.id, status: 'proposed' },
        {
          $set: {
            status: 'rejected',
            result: parsed.data.reason,
            resolved_by: request.operatorContext?.user_id,
            resolved_at: new Date(),
          },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Proposal not found or already resolved' })
      await audit.log(
        request,
        'operator.autopilot.reject',
        'autopilot_action',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  // ── Weekly digest — the Monday-morning summary the cron persists to
  // operator_digests and posts to ops Slack. POST lets an operator run it
  // now (audited) without waiting for the schedule. ───────────────────────

  const digests = db.collection('operator_digests')

  app.get('/operator/digest', { preHandler: requireOperator(db, 'operations.read') }, async () => {
    const latest = await digests.findOne({}, { projection: { _id: 0 }, sort: { created_at: -1 } })
    return { digest: latest ?? null }
  })

  app.post(
    '/operator/digest/send',
    { preHandler: requireOperator(db, 'operations.manage', { stepUp: true }) },
    async (request) => {
      const digest = await runWeeklyDigest(db)
      await audit.log(
        request,
        'operator.digest.send',
        'digest',
        digest.id,
        'Manual weekly digest generation',
      )
      return { digest }
    },
  )

  // ── Operator audit + operations health ──────────────────────────────────

  app.get(
    '/operator/audit',
    { preHandler: requireOperator(db, 'audit.read') },
    async (request, reply) => {
      const parsed = AuditQuerySchema.safeParse(request.query)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid query', issues: parsed.error.issues })
      const { action, target_type, target_id, operator_user_id, source, limit, offset, cursor } =
        parsed.data
      const filter: Record<string, unknown> = {}
      if (action) filter['action'] = action
      if (target_type) filter['target_type'] = target_type
      if (target_id) filter['target_id'] = target_id
      if (operator_user_id) filter['operator_user_id'] = operator_user_id
      const decoded = decodeCursor(cursor)
      if (decoded === null) return reply.status(400).send({ error: 'Invalid cursor' })
      // Audit rows have no app-level id — the cursor tiebreaks on _id, which
      // is unique and monotone enough for a stable created_at sort.
      if (decoded) {
        if (!ObjectId.isValid(decoded.id))
          return reply.status(400).send({ error: 'Invalid cursor' })
        const oid = new ObjectId(decoded.id)
        filter['$or'] = [
          { created_at: { $lt: decoded.created_at } },
          { created_at: decoded.created_at, _id: { $lt: oid } },
        ]
      }
      const col = db.collection('operator_audit_log')
      const [rawItems, total] = await Promise.all([
        col
          .find(filter)
          .sort({ created_at: -1, _id: -1 })
          .skip(decoded ? 0 : offset)
          .limit(limit)
          .toArray(),
        decoded ? Promise.resolve(undefined) : col.countDocuments(filter),
      ])
      const last = rawItems[rawItems.length - 1]
      const nextCursor =
        rawItems.length === limit && last
          ? encodeCursor({ created_at: last['created_at'], _id: last['_id'].toHexString() }, '_id')
          : undefined
      let items: Record<string, unknown>[] = rawItems.map(({ _id, ...rest }) => ({
        source: 'operator',
        ...rest,
      }))
      // Unified view: fold in product-side audit_log rows that touch the
      // same target (resource_id match) so operator and family actions on
      // the same record are one feed. Offset/cursor stay operator-side;
      // the product slice is a bounded companion read, not a second page.
      if (source === 'all') {
        const productFilter: Record<string, unknown> = {}
        // Operator targets are usually a user id or tenant id — match
        // product rows on either axis.
        if (target_id) productFilter['$or'] = [{ resource_id: target_id }, { tenant_id: target_id }]
        if (action) productFilter['action'] = action
        const productRows = await db
          .collection('audit_log')
          .find(productFilter, { projection: { _id: 0 } })
          .sort({ timestamp: -1 })
          .limit(limit)
          .toArray()
        const normalized = productRows.map((row) => ({
          source: 'product',
          operator_user_id: row['user_id'],
          action: row['action'],
          target_type: row['resource_type'],
          target_id: row['resource_id'],
          tenant_id: row['tenant_id'],
          metadata: row['metadata'],
          ip: row['ip'],
          created_at: row['timestamp'],
        }))
        items = [...items, ...normalized]
          .sort(
            (a, b) =>
              new Date(b['created_at'] as string).getTime() -
              new Date(a['created_at'] as string).getTime(),
          )
          .slice(0, limit * 2)
      }
      return {
        entries: items,
        total,
        limit,
        offset,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      }
    },
  )

  /** Read-only operational health: process, datastore, job leases,
   *  per-state pipeline counts, reminder delivery, connector credentials,
   *  and Redis queue depth. External provider metrics are out of scope. */
  app.get(
    '/operator/operations',
    { preHandler: requireOperator(db, 'operations.read') },
    async () => {
      const pingStart = Date.now()
      let mongoOk = true
      try {
        await db.command({ ping: 1 })
      } catch {
        mongoOk = false
      }
      const mongoPingMs = Date.now() - pingStart

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      // A 'sending' reminder claim older than STALE_CLAIM_MS (10min, same
      // value as policy-renewal-reminders.ts) means the worker crashed
      // mid-dispatch — the next run recovers it, but it should be visible.
      const staleClaimCutoff = new Date(Date.now() - 10 * 60 * 1000)
      const tokenExpiryHorizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      const [
        insightsByState,
        postsByState,
        cronLocks,
        events24h,
        pendingDocs,
        remindersByState,
        failedReminders,
        staleClaims,
        connectorsById,
        expiringTokens,
        connectorList,
        failedPosts,
        queueStats,
        deliveryByState,
        failedDeliveries,
      ] = await Promise.all([
        db
          .collection('insights')
          .aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }])
          .toArray(),
        db
          .collection('marketing_posts')
          .aggregate([{ $group: { _id: '$state', count: { $sum: 1 } } }])
          .toArray(),
        db
          .collection('cron_locks')
          .find({}, { projection: { _id: 0 } })
          .limit(50)
          .toArray(),
        db.collection('growth_events').countDocuments({ created_at: { $gte: dayAgo } }),
        db.collection('documents').countDocuments({ status: { $in: ['pending', 'processing'] } }),
        db
          .collection('reminders')
          .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
          .toArray(),
        db
          .collection('reminders')
          .find(
            { status: 'failed' },
            {
              projection: {
                _id: 0,
                id: 1,
                tenant_id: 1,
                due_at: 1,
                attempts: 1,
                last_error: 1,
                'policy.type': 1,
                'policy.provider': 1,
              },
            },
          )
          .sort({ updated_at: -1 })
          .limit(20)
          .toArray(),
        db
          .collection('reminders')
          .countDocuments({ status: 'sending', updated_at: { $lt: staleClaimCutoff } }),
        db
          .collection('connector_credentials')
          .aggregate([
            { $group: { _id: '$connector_id', count: { $sum: 1 } } },
            { $project: { _id: 0, connector_id: '$_id', count: 1 } },
          ])
          .toArray(),
        db
          .collection('connector_credentials')
          .countDocuments({ token_expires_at: { $lt: tokenExpiryHorizon } }),
        // Operator-visible connector inventory — metadata only, never the
        // encrypted credential fields.
        db
          .collection('connector_credentials')
          .find(
            {},
            {
              projection: {
                _id: 0,
                tenant_id: 1,
                connector_id: 1,
                auth_type: 1,
                token_expires_at: 1,
                created_at: 1,
              },
            },
          )
          .sort({ created_at: -1 })
          .limit(50)
          .toArray(),
        db
          .collection('marketing_posts')
          .find(
            { state: 'publish_failed' },
            { projection: { _id: 0, id: 1, channel: 1, publish_error: 1, updated_at: 1 } },
          )
          .sort({ updated_at: -1 })
          .limit(10)
          .toArray(),
        queueManager.inspect(WEBHOOK_INGEST_QUEUE),
        // Outbound delivery pipeline (WhatsApp/SMS/email/push escalations) —
        // status counts plus recent failures. insight bodies stay out of the
        // projection; operators get the channel and error only.
        db
          .collection('delivery_queue')
          .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
          .toArray(),
        db
          .collection('delivery_queue')
          .find({ status: 'failed' }, { projection: { _id: 0, insight_id: 0, target: 0 } })
          .sort({ updated_at: -1 })
          .limit(10)
          .toArray(),
      ])

      const now = new Date()
      return {
        generated_at: now.toISOString(),
        process: {
          uptime_seconds: Math.round(process.uptime()),
          rss_bytes: process.memoryUsage().rss,
        },
        mongo: { ok: mongoOk, ping_ms: mongoPingMs },
        // Triage notes keyed by alert/queue name — what the signal means and
        // whether retrying it is safe. Loaded from runbooks.yaml at the repo
        // root; empty object if the file is missing or malformed.
        runbooks: getRunbooks(),
        insights_by_state: Object.fromEntries(insightsByState.map((i) => [i['_id'], i['count']])),
        marketing_posts_by_state: Object.fromEntries(
          postsByState.map((i) => [i['_id'], i['count']]),
        ),
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
          by_connector: Object.fromEntries(
            connectorsById.map((c) => [c['connector_id'], c['count']]),
          ),
          // Credential values never leave the API — only the count of tokens
          // expiring within 7 days, so an operator knows to expect reconnects.
          expiring_tokens_7d: expiringTokens,
          list: connectorList,
        },
        delivery_by_state: Object.fromEntries(deliveryByState.map((i) => [i['_id'], i['count']])),
        failed_deliveries: failedDeliveries,
        failed_posts: failedPosts,
        queue: queueStats
          ? { available: true as const, ...queueStats }
          : { available: false as const },
        growth_events_24h: events24h,
        documents_pending: pendingDocs,
      }
    },
  )

  // ── AI gateway health (PRD-217) ────────────────────────────────────────
  // The October Ask Keel outage was invisible because nothing surfaced the
  // model path: every call fell back for days and no operator view noticed.
  // This endpoint is metadata-only by design — task ids, models, outcomes,
  // latencies, costs, registry status. Prompt and completion content never
  // leaves the guarded path, and this surface must never carry it.

  // One metadata row per governed call, written by the gateway's onCall
  // hook. Read pattern: task × time window.
  db.collection('ai_task_calls')
    .createIndex({ task_id: 1, created_at: -1 })
    .catch(() => {})
  db.collection('ai_task_calls')
    .createIndex({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 })
    .catch(() => {})
  db.collection('assistant_answer_routes')
    .createIndex({ day: 1 })
    .catch(() => {})
  db.collection('ai_cascade_funnel')
    .createIndex({ day: 1 })
    .catch(() => {})

  function percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
    return sorted[Math.max(0, idx)]!
  }

  app.get<{ Querystring: { days?: string } }>(
    '/operator/ai-health',
    { preHandler: requireOperator(db, 'operations.read') },
    async (request) => {
      const days = Math.min(30, Math.max(1, Number(request.query.days) || 7))
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      const sinceDay = since.toISOString().slice(0, 10)

      const [callRows, costRows, answerRows, guardRows, funnelRows, config] = await Promise.all([
        db
          .collection('ai_task_calls')
          .aggregate([
            { $match: { created_at: { $gte: since } } },
            {
              $group: {
                _id: '$task_id',
                calls: { $sum: 1 },
                // Calls refused by the operator switch are not provider
                // failures — they get their own count so a deliberately-off
                // task doesn't read as an outage.
                failures: {
                  $sum: {
                    $cond: [
                      { $and: [{ $eq: ['$ok', false] }, { $ne: ['$outcome', 'disabled'] }] },
                      1,
                      0,
                    ],
                  },
                },
                disabled_refusals: {
                  $sum: { $cond: [{ $eq: ['$outcome', 'disabled'] }, 1, 0] },
                },
                latencies: { $push: '$latency_ms' },
                processors: { $addToSet: '$processor' },
              },
            },
          ])
          .toArray(),
        db
          .collection('llm_usage')
          .aggregate([
            { $match: { created_at: { $gte: since } } },
            {
              $group: {
                _id: '$workflow_id',
                cost_microdollars: { $sum: '$cost_microdollars' },
                billed_calls: { $sum: 1 },
              },
            },
          ])
          .toArray(),
        db
          .collection('assistant_answer_routes')
          .aggregate([
            { $match: { day: { $gte: sinceDay } } },
            { $group: { _id: '$route', count: { $sum: '$count' } } },
          ])
          .toArray(),
        db
          .collection('llm_guard_events')
          .aggregate([
            { $match: { persisted_at: { $gte: since } } },
            // Event type + action only — never field_path or content hashes.
            { $group: { _id: { type: '$type', action: '$action' }, count: { $sum: 1 } } },
          ])
          .toArray(),
        db
          .collection('ai_cascade_funnel')
          .aggregate([
            { $match: { day: { $gte: sinceDay } } },
            {
              $group: { _id: { task_id: '$task_id', stage: '$stage' }, count: { $sum: '$count' } },
            },
          ])
          .toArray(),
        getPlatformConfig(db),
      ])

      const callsByTask = new Map(callRows.map((r) => [r['_id'] as string, r]))
      const costByTask = new Map(costRows.map((r) => [r['_id'] as string, r]))
      const breakers = getAllCircuitBreakers()

      // Every registered task appears, including silent ones — a task that
      // exists but never calls is itself signal (e.g. a dead pipeline).
      const tasks = [...getTaskRegistry().values()].map((policy) => {
        const stats = callsByTask.get(policy.task_id)
        const calls = (stats?.['calls'] as number | undefined) ?? 0
        const failures = (stats?.['failures'] as number | undefined) ?? 0
        const disabledRefusals = (stats?.['disabled_refusals'] as number | undefined) ?? 0
        const latencies = ((stats?.['latencies'] as number[] | undefined) ?? [])
          .slice()
          .sort((a, b) => a - b)
        const breakerKey = `task:${policy.task_id}`
        return {
          task_id: policy.task_id,
          data_boundary: policy.data_boundary,
          budget_class: policy.budget_class,
          deadline_ms: policy.deadline_ms,
          primary_model: policy.primary_model,
          serving_processor: resolveServingProcessor(policy),
          breaker_state: breakers.get(breakerKey)?.getState() ?? 'closed',
          disabled: config.ai_disabled_tasks.includes(policy.task_id),
          calls,
          failures,
          disabled_refusals: disabledRefusals,
          failure_rate: calls > 0 ? Math.round((failures / calls) * 1000) / 1000 : 0,
          p50_ms: percentile(latencies, 50),
          p95_ms: percentile(latencies, 95),
          cost_microdollars:
            (costByTask.get(policy.task_id)?.['cost_microdollars'] as number | undefined) ?? 0,
        }
      })

      const answerMix = Object.fromEntries(answerRows.map((r) => [r['_id'], r['count']])) as Record<
        string,
        number
      >
      const answerTotal = Object.values(answerMix).reduce((s, n) => s + n, 0)
      const generatedCount = (answerMix['generated'] as number | undefined) ?? 0

      return {
        generated_at: new Date().toISOString(),
        window_days: days,
        tasks,
        processors: [...getProcessorRegistry().values()].map((e) => ({
          id: e.id,
          name: e.name,
          hosting: e.hosting,
          status: e.status,
          reviewed_at: e.reviewed_at,
          review_due: e.review_due,
          review_lapsed: e.status === 'approved' && Date.parse(e.review_due) < Date.now(),
        })),
        assistant_answer_mix: {
          ...answerMix,
          total: answerTotal,
          // PRD-212's KPI — the share of asks that needed a model call.
          generation_escape_rate:
            answerTotal > 0 ? Math.round((generatedCount / answerTotal) * 1000) / 1000 : null,
        },
        guard_events: guardRows.map((r) => ({
          type: (r['_id'] as { type: string }).type,
          action: (r['_id'] as { action: string }).action,
          count: r['count'],
        })),
        // PRD-215: per-task cascade tier counts (rules / encoder / model).
        // generator_share is the share settled by the model itself — the
        // regression signal the alert job pages on.
        cascade_funnel: funnelRows.map((r) => ({
          task_id: (r['_id'] as { task_id: string }).task_id,
          stage: (r['_id'] as { stage: string }).stage,
          count: r['count'],
        })),
        disabled_tasks: config.ai_disabled_tasks,
        local_model: localModelQueueSummary(),
      }
    },
  )

  // ── AI task runtime switch (PRD-217) ───────────────────────────────────
  // Disable → the gateway refuses the task with TaskDisabledError before any
  // provider is contacted; the caller's existing failure path serves its
  // honest fallback (never a silent swap to another processor). Enable
  // restores it. Both directions are reasoned + audited; tasks whose data
  // must stay on LifeKeel infra (lifekeel_infra_required) additionally need
  // a second operator's confirmation — the same four-eyes gate as tenant
  // suspension.

  const AiTaskStateSchema = z.object({
    enabled: z.boolean(),
    reason: z.string().min(5).max(500),
    confirmation_id: z.string().optional(),
  })

  app.post<{ Params: { taskId: string } }>(
    '/operator/ai-tasks/:taskId/state',
    { preHandler: requireOperator(db, 'operations.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = AiTaskStateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid body', issues: parsed.error.issues })
      const { enabled, reason } = parsed.data
      const policy = getTaskRegistry().get(request.params.taskId)
      if (!policy) return reply.status(404).send({ error: 'Unknown AI task' })

      const before = await getPlatformConfig(db)
      const currentlyDisabled = before.ai_disabled_tasks.includes(policy.task_id)
      if (currentlyDisabled === !enabled)
        return reply
          .status(409)
          .send({ error: `Task is already ${enabled ? 'enabled' : 'disabled'}` })

      const action = enabled ? 'operator.ai_task.enable' : 'operator.ai_task.disable'
      // Disabling OR re-enabling a quarantine-boundary task changes what a
      // family's most sensitive asks can reach — four-eyes either way.
      if (policy.data_boundary === 'lifekeel_infra_required') {
        const gate = await checkDualApproval(db, audit, request, {
          action,
          targetType: 'ai_task',
          targetId: policy.task_id,
          payload: { enabled },
          permission: 'operations.manage',
          reason,
        })
        if (gate.kind !== 'proceed') return reply.status(gate.status).send(gate.body)
      }

      if (enabled) {
        await configCol.updateOne(
          { key: CONFIG_DOC_KEY },
          {
            $pullAll: { ai_disabled_tasks: [policy.task_id] },
            $set: { updated_by: request.operatorContext?.user_id, updated_at: new Date() },
          },
        )
      } else {
        await configCol.updateOne(
          { key: CONFIG_DOC_KEY },
          {
            $addToSet: { ai_disabled_tasks: policy.task_id },
            $set: { updated_by: request.operatorContext?.user_id, updated_at: new Date() },
          },
          { upsert: true },
        )
      }
      await configHistory.insertOne({
        changes: { ai_disabled_tasks: enabled ? 'remove' : 'add' },
        task_id: policy.task_id,
        before: before.ai_disabled_tasks,
        changed_by: request.operatorContext?.user_id,
        reason,
        created_at: new Date(),
      })
      invalidatePlatformConfigCache()
      await audit.log(request, action, 'ai_task', policy.task_id, reason)
      return { ok: true, task_id: policy.task_id, enabled }
    },
  )

  /** Manual retry of a failed reminder delivery — resets it to 'scheduled'
   *  with zeroed attempts so the next dispatcher run takes a fresh shot.
   *  Audited like every other operator mutation. */
  app.post<{ Params: { id: string } }>(
    '/operator/reminders/:id/retry',
    { preHandler: requireOperator(db, 'operations.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await db.collection('reminders').updateOne(
        { id: request.params.id, status: 'failed' },
        {
          $set: {
            status: 'scheduled',
            attempts: 0,
            next_attempt_at: new Date(),
            updated_at: new Date(),
          },
          $unset: { last_error: '' },
        },
      )
      if (result.matchedCount === 0)
        return reply.status(404).send({ error: 'Reminder not found or not failed' })
      await audit.log(
        request,
        'operator.reminder.retry',
        'reminder',
        request.params.id,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** Requeue a dead-lettered job. The queue name is whitelisted so this
   *  endpoint can't reach arbitrary Redis keys; attempts reset to 0. */
  const REQUEUEABLE_QUEUES = new Set([WEBHOOK_INGEST_QUEUE])
  app.post<{ Params: { queue: string; jobId: string } }>(
    '/operator/queues/:queue/dead/:jobId/requeue',
    { preHandler: requireOperator(db, 'operations.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      if (!REQUEUEABLE_QUEUES.has(request.params.queue))
        return reply.status(404).send({ error: 'Unknown queue' })
      if (!queueManager.isAvailable())
        return reply
          .status(503)
          .send({ error: 'Queue backend unavailable — jobs run inline with no durable backlog' })
      const moved = await queueManager.requeueDead(request.params.queue, request.params.jobId)
      if (!moved) return reply.status(404).send({ error: 'Job not found in dead letter' })
      await audit.log(
        request,
        'operator.queue.requeue_dead',
        'queue_job',
        `${request.params.queue}/${request.params.jobId}`,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  /** Revoke a tenant's connector credential — deletes the stored (encrypted)
   *  credential so syncs stop and the family must re-authorize. Destructive
   *  for the tenant's data feed; audited like other operator mutations. */
  app.post<{ Params: { connectorId: string; tenantId: string } }>(
    '/operator/connectors/:connectorId/tenants/:tenantId/revoke',
    { preHandler: requireOperator(db, 'operations.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ReasonSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'A reason of at least 5 characters is required' })
      const result = await db.collection('connector_credentials').deleteOne({
        connector_id: request.params.connectorId,
        tenant_id: request.params.tenantId,
      })
      if (result.deletedCount === 0)
        return reply.status(404).send({ error: 'Connector credential not found' })
      await audit.log(
        request,
        'operator.connector.revoke',
        'connector',
        `${request.params.tenantId}/${request.params.connectorId}`,
        parsed.data.reason,
      )
      return { ok: true }
    },
  )

  // ── Platform configuration ──────────────────────────────────────────────
  // Typed global switches (see operator/platform-config.ts). Reads are
  // configuration.read; every write is reasoned, audited, and kept in
  // platform_config_history.

  const configCol = db.collection<{ key: string } & Partial<PlatformConfig>>('platform_config')
  const configHistory = db.collection('platform_config_history')

  app.get(
    '/operator/configuration',
    { preHandler: requireOperator(db, 'configuration.read') },
    async () => {
      const [config, history] = await Promise.all([
        getPlatformConfig(db),
        configHistory
          .find({}, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .limit(20)
          .toArray(),
      ])
      return { config, history }
    },
  )

  const MaintenanceWindowSchema = z
    .object({
      starts_at: z.string().datetime(),
      ends_at: z.string().datetime(),
      message: z.string().min(1).max(300),
    })
    .refine((w) => new Date(w.ends_at) > new Date(w.starts_at), {
      message: 'ends_at must be after starts_at',
    })

  const ConfigUpdateSchema = z.object({
    maintenance_mode: z.boolean().optional(),
    signups_enabled: z.boolean().optional(),
    marketing_paused: z.boolean().optional(),
    /** null clears a scheduled window; object sets/replaces it. */
    maintenance_window: MaintenanceWindowSchema.nullable().optional(),
    reason: z.string().min(5).max(500),
  })

  app.put(
    '/operator/configuration',
    { preHandler: requireOperator(db, 'configuration.manage', { stepUp: true }) },
    async (request, reply) => {
      const parsed = ConfigUpdateSchema.safeParse(request.body)
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: 'Invalid configuration', issues: parsed.error.issues })
      const { reason, ...changes } = parsed.data
      if (Object.keys(changes).length === 0)
        return reply.status(400).send({ error: 'No changes provided' })

      const before = await getPlatformConfig(db)
      const next: PlatformConfig = {
        maintenance_mode: changes.maintenance_mode ?? before.maintenance_mode,
        signups_enabled: changes.signups_enabled ?? before.signups_enabled,
        marketing_paused: changes.marketing_paused ?? before.marketing_paused,
        maintenance_window:
          changes.maintenance_window === undefined
            ? before.maintenance_window
            : changes.maintenance_window,
        // Never set via the generic config write — only the audited
        // /operator/ai-tasks/:taskId/state route touches it (PRD-217).
        ai_disabled_tasks: before.ai_disabled_tasks,
      }
      const changedKeys = (Object.keys(changes) as (keyof typeof changes)[]).filter(
        (k) => changes[k] !== before[k as keyof PlatformConfig],
      )
      if (changedKeys.length === 0) return reply.status(400).send({ error: 'No effective changes' })

      await configCol.updateOne(
        { key: CONFIG_DOC_KEY },
        {
          $set: {
            ...changes,
            updated_by: request.operatorContext?.user_id,
            updated_at: new Date(),
          },
        },
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
      await audit.log(
        request,
        'operator.configuration.update',
        'platform_config',
        CONFIG_DOC_KEY,
        reason,
        { changes, before, after: next },
      )
      return { config: next }
    },
  )

  // ── Infrastructure cost snapshots ───────────────────────────────────────
  // Operator-recorded monthly estimates per service. Honest scope: these
  // are entered by hand — provider billing APIs are out of scope until
  // there's a real need. The UI labels them as estimates.

  const costCol = db.collection('infra_cost_snapshots')

  app.get(
    '/operator/infrastructure',
    { preHandler: requireOperator(db, 'operations.read') },
    async () => {
      const snapshots = await costCol
        .find({}, { projection: { _id: 0 } })
        .sort({ recorded_at: -1 })
        .limit(100)
        .toArray()
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
    },
  )

  const CostSnapshotSchema = z.object({
    service: z.string().min(1).max(100),
    monthly_usd: z.number().min(0).max(1_000_000),
    note: z.string().max(500).optional(),
    reason: z.string().min(5).max(500),
  })

  app.post(
    '/operator/infrastructure/snapshots',
    { preHandler: requireOperator(db, 'operations.manage') },
    async (request, reply) => {
      const parsed = CostSnapshotSchema.safeParse(request.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid snapshot', issues: parsed.error.issues })
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
      await audit.log(
        request,
        'operator.infrastructure.record_cost',
        'infra_cost',
        service,
        reason,
        { monthly_usd },
      )
      return { snapshot: { ...doc, _id: undefined } }
    },
  )
}
