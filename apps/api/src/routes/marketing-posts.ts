/**
 * /marketing/posts — the publish half of the marketing engine: draft →
 * approve → publish via Postiz (one API key covers X, LinkedIn, Instagram,
 * Facebook, TikTok, …).
 *
 * Autonomy model — earned trust, from day one. Posting publicly on a
 * channel is an external, effectively-irreversible action, so it sits on
 * the same trust ladder insights do (automation.trust_level_by_workflow),
 * scoped per channel: `marketing_social:<channel>`. A human approving a
 * draft increments that channel's counter (cap AUTO_EXECUTE_TRUST_THRESHOLD,
 * same as insights); once a channel is at threshold AND the tenant has
 * opted in via automation.auto_execute_enabled, a newly-created draft for
 * that channel publishes immediately without a human tap — and a human
 * can always reject a queued draft before then. The counter only moves on
 * human approvals — an auto-publish never feeds the trust it relied on,
 * matching auto-execute-trusted.ts's learning_suppressed posture.
 *
 * dry_run_mode is honored: a simulating tenant's drafts still "publish"
 * (state flips, no Postiz call) so the whole pipeline can be rehearsed —
 * and dry-run human approvals still earn trust, since the human's review
 * of the content is the real signal, not the HTTP dispatch.
 *
 * Operator-only: POSTIZ_API_KEY is one server-global key to the operator's
 * own Postiz workspace, so platform-role permissions protect every route.
 * POSTIZ_API_KEY absent still lets drafts queue for an operator tenant —
 * publishes land in publish_failed, retryable via approve.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { AUTO_EXECUTE_TRUST_THRESHOLD } from '../jobs/auto-execute-trusted.js'
import { requireOperator } from '../operator/operator-auth.js'
import { getPlatformConfig } from '../operator/platform-config.js'
import { postizClientFromEnv, type PostizClient } from '../marketing/postiz-client.js'

export type MarketingPostState = 'draft' | 'approved' | 'published' | 'publish_failed' | 'rejected'

export interface MarketingPostDoc {
  id: string
  tenant_id: string
  channel: string
  integration_id: string
  content: string
  scheduled_at?: Date
  state: MarketingPostState
  auto_published?: boolean
  dry_run?: boolean
  created_by: string
  created_at: Date
  approved_by?: string
  approved_at?: Date
  published_at?: Date
  publish_error?: string
}

const CreatePostSchema = z.object({
  integration_id: z.string().min(1).max(200),
  channel: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  content: z.string().min(1).max(5000),
  scheduled_at: z.string().datetime().optional(),
})

function trustScope(channel: string): string {
  return `marketing_social:${channel}`
}

interface AutomationSettings {
  auto_execute_enabled?: boolean
  dry_run_mode?: boolean
  trust_level_by_workflow?: Record<string, number>
}

async function getAutomation(db: Db, tenantId: string): Promise<AutomationSettings> {
  const doc = await db.collection('tenant_settings').findOne({ tenant_id: tenantId })
  return (doc?.['automation'] as AutomationSettings | undefined) ?? {}
}

function autoPublishEligible(automation: AutomationSettings, scope: string): boolean {
  return (
    automation.auto_execute_enabled === true &&
    (automation.trust_level_by_workflow?.[scope] ?? 0) >= AUTO_EXECUTE_TRUST_THRESHOLD
  )
}

/** Mirrors the trust increment in insights.ts's approve path — same counter,
 *  same cap, same workflow.trust_upgraded event at the threshold. */
async function incrementTrustScope(db: Db, tenantId: string, scope: string): Promise<void> {
  const current = (await getAutomation(db, tenantId)).trust_level_by_workflow?.[scope] ?? 0
  if (current >= AUTO_EXECUTE_TRUST_THRESHOLD) return
  const next = current + 1
  await db.collection('tenant_settings').updateOne(
    { tenant_id: tenantId },
    { $set: { [`automation.trust_level_by_workflow.${scope}`]: next, updated_at: new Date() } },
    { upsert: true },
  )
  if (next === AUTO_EXECUTE_TRUST_THRESHOLD) {
    await db.collection('system_events').insertOne({
      tenant_id: tenantId,
      type: 'workflow.trust_upgraded',
      workflow_id: scope,
      trust_level: next,
      created_at: new Date(),
    })
  }
}

/**
 * Dispatch one post. Under dry_run the state flips without touching Postiz;
 * a missing client or a failed call lands the post in publish_failed with
 * the error kept on the doc, retryable through the same approve route.
 */
async function publishPost(
  db: Db,
  col: { updateOne: (f: Record<string, unknown>, u: Record<string, unknown>) => Promise<unknown> },
  client: PostizClient | null,
  post: MarketingPostDoc,
  opts: { dryRun: boolean },
): Promise<{ ok: boolean }> {
  // Emergency stop: operator-set global pause. The post stays 'approved'
  // (not publish_failed — nothing is wrong with it) and can be retried
  // through the same approve route once the pause lifts.
  if ((await getPlatformConfig(db)).marketing_paused) {
    await col.updateOne(
      { id: post.id },
      { $set: { publish_error: 'marketing_paused' } },
    )
    return { ok: false }
  }
  const now = new Date()
  if (opts.dryRun) {
    await col.updateOne(
      { id: post.id },
      { $set: { state: 'published', published_at: now, dry_run: true, publish_error: null } },
    )
    return { ok: true }
  }
  if (!client) {
    await col.updateOne(
      { id: post.id },
      { $set: { state: 'publish_failed', publish_error: 'postiz_not_configured' } },
    )
    return { ok: false }
  }
  try {
    const scheduled = post.scheduled_at && post.scheduled_at.getTime() > now.getTime()
    await client.createPost({
      integrationId: post.integration_id,
      content: post.content,
      channel: post.channel,
      type: scheduled ? 'schedule' : 'now',
      date: scheduled ? (post.scheduled_at as Date) : now,
    })
    await col.updateOne(
      { id: post.id },
      { $set: { state: 'published', published_at: new Date(), publish_error: null } },
    )
    return { ok: true }
  } catch (err) {
    await col.updateOne(
      { id: post.id },
      { $set: { state: 'publish_failed', publish_error: String(err).slice(0, 500) } },
    )
    return { ok: false }
  }
}

export interface MarketingRouteOptions {
  operatorTenants?: string[]
}

export function registerMarketingPostRoutes(
  app: FastifyInstance,
  db: Db,
  postiz?: PostizClient | null,
  opts?: MarketingRouteOptions,
): void {
  const client = postiz === undefined ? postizClientFromEnv() : postiz
  const col = db.collection<MarketingPostDoc>('marketing_posts')
  col.createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {})
  col.createIndex({ id: 1 }, { unique: true }).catch(() => {})

  const testGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const allowed = new Set(opts?.operatorTenants ?? [])
    if (allowed.size === 0) {
      await reply.status(503).send({ error: 'marketing_not_configured' })
      return
    }
    if (!allowed.has(req.authContext.tenant_id)) await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')

  /** GET /marketing/integrations — connected Postiz channels, for the composer. */
  app.get('/marketing/integrations', { preHandler: readGate }, async (_req, reply) => {
    if (!client) return reply.status(503).send({ error: 'postiz_not_configured' })
    const integrations = await client.listIntegrations()
    return { integrations: integrations.map((i) => ({ id: i.id, name: i.name, identifier: i.identifier, disabled: i.disabled === true })) }
  })

  /** GET /marketing/posts — this tenant's queue, newest first. */
  app.get('/marketing/posts', { preHandler: readGate }, async (req) => {
    const { tenant_id } = req.authContext
    const posts = await col.find({ tenant_id }).sort({ created_at: -1 }).limit(100).toArray()
    return { posts }
  })

  /** POST /marketing/posts — create a draft; auto-publishes when the channel
   *  has earned trust and the tenant opted in. */
  app.post('/marketing/posts', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const parsed = CreatePostSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid post', issues: parsed.error.issues })
    }
    const { integration_id, channel, content, scheduled_at } = parsed.data
    const now = new Date()
    const post: MarketingPostDoc = {
      id: randomUUID(),
      tenant_id,
      channel,
      integration_id,
      content,
      ...(scheduled_at ? { scheduled_at: new Date(scheduled_at) } : {}),
      state: 'draft',
      created_by: user_id,
      created_at: now,
    }
    await col.insertOne(post)

    const automation = await getAutomation(db, tenant_id)
    if (autoPublishEligible(automation, trustScope(channel))) {
      // Conditional claim: a human approve/reject landing in this window wins.
      const claimed = (await col.findOneAndUpdate(
        { id: post.id, state: 'draft' },
        { $set: { state: 'approved', approved_at: now, approved_by: 'auto-trust' } },
        { returnDocument: 'after' },
      )) as MarketingPostDoc | null
      if (claimed) {
        const result = await publishPost(db, col, client, claimed, { dryRun: automation.dry_run_mode === true })
        if (result.ok) {
          await col.updateOne({ id: post.id }, { $set: { auto_published: true } })
          getAuditLogger()?.fromRequest(req, 'marketing.post_auto_publish', 'marketing_post', post.id, { channel })
        }
      }
    }

    const saved = await col.findOne({ id: post.id })
    return reply.status(201).send({ post: saved })
  })

  /** POST /marketing/posts/:id/approve — human decision; publishes and earns
   *  channel trust on success. Retries publish_failed posts. */
  app.post<{ Params: { id: string } }>('/marketing/posts/:id/approve', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const claimed = (await col.findOneAndUpdate(
      { id: req.params.id, tenant_id, state: { $in: ['draft', 'publish_failed'] } },
      { $set: { state: 'approved', approved_at: new Date(), approved_by: user_id } },
      { returnDocument: 'after' },
    )) as MarketingPostDoc | null
    if (!claimed) {
      return reply.status(404).send({ error: 'Post not found or already decided' })
    }

    const automation = await getAutomation(db, tenant_id)
    const result = await publishPost(db, col, client, claimed, { dryRun: automation.dry_run_mode === true })
    if (!result.ok) {
      const failed = await col.findOne({ id: claimed.id })
      getAuditLogger()?.fromRequest(req, 'marketing.post_approve', 'marketing_post', claimed.id, {
        channel: claimed.channel,
        outcome: 'publish_failed',
        publish_error: failed?.publish_error,
      })
      return reply.status(502).send({ error: 'Publish failed', post: failed })
    }

    await incrementTrustScope(db, tenant_id, trustScope(claimed.channel))
    getAuditLogger()?.fromRequest(req, 'marketing.post_approve', 'marketing_post', claimed.id, { channel: claimed.channel })
    const post = await col.findOne({ id: claimed.id })
    return { post }
  })

  /** POST /marketing/posts/:id/reject — kill a queued draft. */
  app.post<{ Params: { id: string } }>('/marketing/posts/:id/reject', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const result = (await col.findOneAndUpdate(
      { id: req.params.id, tenant_id, state: { $in: ['draft', 'publish_failed'] } },
      { $set: { state: 'rejected', rejected_by: user_id, rejected_at: new Date() } },
      { returnDocument: 'after' },
    )) as MarketingPostDoc | null
    if (!result) {
      return reply.status(404).send({ error: 'Post not found or already decided' })
    }
    getAuditLogger()?.fromRequest(req, 'marketing.post_reject', 'marketing_post', req.params.id, {})
    return { post: result }
  })
}
