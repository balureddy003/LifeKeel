/**
 * /marketing/posts — the publish half of the marketing engine: draft →
 * approve → publish directly to each channel's own API (X, LinkedIn,
 * Bluesky — see marketing/social-publisher.ts).
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
 * (state flips, no channel call) so the whole pipeline can be rehearsed —
 * and dry-run human approvals still earn trust, since the human's review
 * of the content is the real signal, not the HTTP dispatch.
 *
 * Operator-only: channel credentials are either per-tenant rows in
 * `social_connections` (connected via /marketing/connections, encrypted at
 * rest) or server-global env tokens — platform-role permissions protect
 * every route. No credentials configured still lets drafts queue for an
 * operator tenant — publishes land in publish_failed, retryable via
 * approve.
 *
 * Scheduling is in-house: channels can't hold future posts, so an
 * approved post with a future scheduled_at stays 'approved' until the
 * marketing-publish cron sweep dispatches it when due.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { AUTO_EXECUTE_TRUST_THRESHOLD } from '../jobs/auto-execute-trusted.js'
import { requireOperator } from '../operator/operator-auth.js'
import { getPlatformConfig } from '../operator/platform-config.js'
import {
  socialPublisherFromEnv,
  DbSocialPublisher,
  verifyBlueskyCredentials,
  type SocialPublisher,
  type SocialConnectionDoc,
} from '../marketing/social-publisher.js'
import { encryptIfNeeded, createLlmRouterFromEnv, type LlmFn } from '@agentoak/platform'

export type MarketingPostState = 'draft' | 'approved' | 'publishing' | 'published' | 'publish_failed' | 'rejected'

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
  generated?: 'llm' | 'template'
  source_blog_slug?: string
}

const CreatePostSchema = z.object({
  integration_id: z.string().min(1).max(200),
  channel: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  content: z.string().min(1).max(5000),
  scheduled_at: z.string().datetime().optional(),
})

const GeneratePostSchema = z
  .object({
    integration_id: z.string().min(1).max(200),
    channel: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    topic: z.string().min(1).max(500).optional(),
    blog_slug: z.string().min(1).max(200).optional(),
  })
  .refine((v) => v.topic !== undefined || v.blog_slug !== undefined, {
    message: 'Provide topic or blog_slug',
  })

const ConnectBlueskySchema = z.object({
  handle: z
    .string()
    .min(1)
    .max(253)
    .transform((h) => h.trim().replace(/^@/, '').toLowerCase()),
  app_password: z.string().min(4).max(100),
  service: z.string().url().max(200).optional(),
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
 * Dispatch one post. Under dry_run the state flips without touching any
 * channel; a missing publisher or a failed call lands the post in
 * publish_failed with the error kept on the doc, retryable through the
 * same approve route. A post with a future scheduled_at stays 'approved'
 * — channels can't hold schedules, so the cron sweep dispatches it at
 * due time.
 */
async function publishPost(
  db: Db,
  col: { updateOne: (f: Record<string, unknown>, u: Record<string, unknown>) => Promise<unknown> },
  client: SocialPublisher | null,
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
  if (post.scheduled_at && post.scheduled_at.getTime() > now.getTime()) {
    await col.updateOne({ id: post.id }, { $set: { publish_error: null } })
    return { ok: true }
  }
  if (!client) {
    await col.updateOne(
      { id: post.id },
      { $set: { state: 'publish_failed', publish_error: 'publisher_not_configured' } },
    )
    return { ok: false }
  }
  try {
    await client.createPost({
      integrationId: post.integration_id,
      content: post.content,
      channel: post.channel,
      type: 'now',
      date: now,
      tenantId: post.tenant_id,
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

/** Cron sweep — dispatch approved posts whose scheduled_at has come due.
 *  Each doc is claimed 'approved' → 'publishing' before dispatch so two
 *  ticks (or a tick racing an approve) can't double-post. */
export async function publishDueMarketingPosts(
  db: Db,
  client: SocialPublisher | null,
): Promise<number> {
  const col = db.collection<MarketingPostDoc>('marketing_posts')
  const now = new Date()
  const due = (await col
    .find({ state: 'approved' })
    .sort({ scheduled_at: 1 })
    .limit(50)
    .toArray()).filter((p) => !p.scheduled_at || p.scheduled_at.getTime() <= now.getTime())
    .slice(0, 20)
  let dispatched = 0
  for (const post of due) {
    const claimed = await col.findOneAndUpdate(
      { id: post.id, state: 'approved' },
      { $set: { state: 'publishing' } },
    )
    if (!claimed) continue
    // publishPost re-writes state to published/publish_failed on outcome;
    // a pause leaves it 'publishing' — restore 'approved' so the next tick
    // retries instead of stranding it.
    const result = await publishPost(db, col, client, post, { dryRun: false })
    if (!result.ok && (await getPlatformConfig(db)).marketing_paused) {
      await col.updateOne({ id: post.id, state: 'publishing' }, { $set: { state: 'approved' } })
    }
    dispatched += 1
  }
  return dispatched
}

/** Daily cron sweep — queue one AI draft per opted-in tenant for morning
 *  review. Opt-in is tenant_settings.automation.daily_marketing_drafts_enabled
 *  (same Act-layer doc as the other autonomy flags). Requires an active
 *  social connection to know the channel; picks the newest published blog
 *  post the tenant hasn't promoted yet (source_blog_slug dedupe) and skips
 *  the day when everything's been promoted. The draft is always 'draft' —
 *  generated content never skips human review regardless of trust. */
export async function generateDailyMarketingDrafts(db: Db, llm: LlmFn): Promise<number> {
  const postsCol = db.collection<MarketingPostDoc>('marketing_posts')
  const connsCol = db.collection<SocialConnectionDoc>('social_connections')
  const blogsCol = db.collection('blog_posts')
  const optedIn = (await db.collection('tenant_settings').find({}).toArray())
    .filter((d) => (d['automation'] as Record<string, unknown> | undefined)?.['daily_marketing_drafts_enabled'] === true)

  let queued = 0
  for (const s of optedIn) {
    const tenantId = s['tenant_id'] as string
    const conn = await connsCol.findOne({ tenant_id: tenantId, status: 'active' })
    if (!conn) continue
    const usedSlugs = new Set(
      (await postsCol.find({ tenant_id: tenantId }).toArray())
        .map((p) => p.source_blog_slug)
        .filter((x): x is string => Boolean(x)),
    )
    const candidate = (await blogsCol.find({ published: true }).sort({ published_at: -1 }).limit(50).toArray())
      .find((b) => !usedSlugs.has(b['slug'] as string))
    if (!candidate) continue

    const slug = candidate['slug'] as string
    const src = await blogSourceBlock(db, slug, conn.channel)
    if (!src) continue
    const { content, generated } = await draftPostText(llm, conn.channel, src.sourceBlock, src.link)
    const post: MarketingPostDoc = {
      id: randomUUID(),
      tenant_id: tenantId,
      channel: conn.channel,
      integration_id: `${conn.channel}:connection`,
      content,
      state: 'draft',
      generated,
      source_blog_slug: slug,
      created_by: 'daily-generator',
      created_at: new Date(),
    }
    await postsCol.insertOne(post)
    queued += 1
  }
  return queued
}

export interface MarketingRouteOptions {
  operatorTenants?: string[]
  llm?: LlmFn
}

/** Per-channel hard caps — the model is told the limit, then the output is
 *  clamped anyway because LLMs can't count. */
const CHANNEL_CHAR_LIMIT: Record<string, number> = { x: 280, bluesky: 300, linkedin: 3000 }

function clampPost(text: string, limit: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  const window = trimmed.slice(0, limit - 1)
  const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '))
  return `${window.slice(0, cut > limit * 0.6 ? cut : limit - 1).trimEnd()}…`
}

const GENERATE_SYSTEM = `You write short social posts for Agent Oak, a family-finance digital twin.
Rules — these are non-negotiable:
- Informational, educational tone only. Never personalized financial,
  insurance, or investment advice. Never name, rank, or recommend a
  specific provider, policy, or product. No savings promises, no urgency
  or fear tactics.
- Plain text only — no markdown, no hashtags unless the source has them,
  no emojis.
- Return ONLY the post text, nothing else.`

async function blogSourceBlock(db: Db, blogSlug: string, channel: string): Promise<{ sourceBlock: string; link: string } | null> {
  const post = await db.collection('blog_posts').findOne({ slug: blogSlug, published: true })
  if (!post) return null
  const base = (process.env['AGENT_OAK_URL'] ?? '').replace(/\/$/, '')
  // UTM'd so a click → signup lands in users.attribution.utm_source and the
  // operator overview's "signups by source" — the measurable end of the
  // social loop. utm_content carries the slug for per-post reads.
  const link = base
    ? `${base}/blog/${blogSlug}?utm_source=${encodeURIComponent(channel)}&utm_medium=social&utm_campaign=oak_social&utm_content=${encodeURIComponent(blogSlug)}`
    : ''
  return {
    link,
    sourceBlock: `Blog post to promote:\nTitle: ${post['title']}\nSummary: ${post['excerpt']}${link ? `\nLink to include verbatim: ${link}` : ''}`,
  }
}

/** LLM draft with deterministic fallback — shared by the generate route
 *  and the daily cron so both produce identical-quality output. */
async function draftPostText(
  llm: LlmFn,
  channel: string,
  sourceBlock: string,
  link: string,
): Promise<{ content: string; generated: 'llm' | 'template' }> {
  const limit = CHANNEL_CHAR_LIMIT[channel] ?? 2000
  try {
    const raw = await llm(
      GENERATE_SYSTEM,
      `Channel: ${channel} (hard maximum ${limit} characters — stay under it).\n\n${sourceBlock}\n\nWrite one post.`,
      'tier:fast',
    )
    const content = clampPost(raw, limit)
    if (!content) throw new Error('empty generation')
    return { content, generated: 'llm' }
  } catch {
    return {
      generated: 'template',
      content: clampPost(`${sourceBlock.split('\n').slice(1).join('\n')}${link ? `\n\n${link}` : ''}`, limit),
    }
  }
}

export function registerMarketingPostRoutes(
  app: FastifyInstance,
  db: Db,
  publisher?: SocialPublisher | null,
  opts?: MarketingRouteOptions,
): void {
  const client = publisher === undefined ? new DbSocialPublisher(db, socialPublisherFromEnv()) : publisher
  const col = db.collection<MarketingPostDoc>('marketing_posts')
  const connectionsCol = db.collection<SocialConnectionDoc>('social_connections')
  col.createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {})
  col.createIndex({ id: 1 }, { unique: true }).catch(() => {})
  connectionsCol.createIndex({ tenant_id: 1, channel: 1 }, { unique: true }).catch(() => {})

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
  const llm = opts?.llm ?? createLlmRouterFromEnv()

  /** GET /marketing/integrations — channels the composer can target: this
   *  tenant's stored connections plus any env-configured channels. */
  app.get('/marketing/integrations', { preHandler: readGate }, async (req, reply) => {
    if (!client) return reply.status(503).send({ error: 'publisher_not_configured' })
    const integrations = await client.listIntegrations(req.authContext.tenant_id)
    return { integrations: integrations.map((i) => ({ id: i.id, name: i.name, identifier: i.identifier, disabled: i.disabled === true, source: i.source })) }
  })

  /** GET /marketing/connections — this tenant's stored channel credentials,
   *  minus the credentials themselves. */
  app.get('/marketing/connections', { preHandler: readGate }, async (req) => {
    const conns = await connectionsCol.find({ tenant_id: req.authContext.tenant_id }).toArray()
    return {
      connections: conns.map(({ credentials: _credentials, ...rest }) => rest),
    }
  })

  /** POST /marketing/connections/bluesky — verify the app password against
   *  bsky.social before storing it (encrypted). A bad password is rejected
   *  here rather than discovered on the first failed publish. */
  app.post('/marketing/connections/bluesky', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const parsed = ConnectBlueskySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid connection', issues: parsed.error.issues })
    }
    const { handle, app_password, service } = parsed.data
    let did: string
    try {
      did = (await verifyBlueskyCredentials(handle, app_password, service)).did
    } catch (err) {
      return reply.status(502).send({ error: `bluesky_auth_failed: ${String(err).slice(0, 200)}` })
    }
    const now = new Date()
    await connectionsCol.updateOne(
      { tenant_id, channel: 'bluesky' },
      {
        $set: {
          handle,
          credentials: { app_password: encryptIfNeeded(app_password)! },
          service: service ?? 'https://bsky.social',
          did,
          status: 'active',
          last_error: null,
          connected_by: user_id,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    )
    getAuditLogger()?.fromRequest(req, 'marketing.connection_connect', 'social_connection', `bluesky:${tenant_id}`, {
      channel: 'bluesky',
      handle,
    })
    return reply.status(201).send({
      connection: { tenant_id, channel: 'bluesky', handle, did, status: 'active', connected_by: user_id, updated_at: now },
    })
  })

  /** DELETE /marketing/connections/:channel — drop a stored connection. Env
   *  channels aren't affected; publishes fall back to them if present. */
  app.delete<{ Params: { channel: string } }>(
    '/marketing/connections/:channel',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const result = await connectionsCol.deleteOne({ tenant_id, channel: req.params.channel })
      if (!result.deletedCount) return reply.status(404).send({ error: 'No such connection' })
      getAuditLogger()?.fromRequest(req, 'marketing.connection_disconnect', 'social_connection', `${req.params.channel}:${tenant_id}`, {})
      return { ok: true }
    },
  )

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

  /** POST /marketing/posts/generate — LLM-drafted post from a blog post or
   *  free topic. Deliberately always lands 'draft': AI-authored content
   *  gets human eyes regardless of the channel's earned trust (the trust
   *  ladder gates human-drafted posts; generated content sits one tier
   *  lower). Falls back to a deterministic template when no LLM provider
   *  is configured — the feature stays usable, marked generated:template. */
  app.post('/marketing/posts/generate', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const parsed = GeneratePostSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    }
    const { integration_id, channel, topic, blog_slug } = parsed.data

    let sourceBlock: string
    let link = ''
    if (blog_slug) {
      const src = await blogSourceBlock(db, blog_slug, channel)
      if (!src) return reply.status(404).send({ error: 'Blog post not found' })
      sourceBlock = src.sourceBlock
      link = src.link
    } else {
      sourceBlock = `Topic: ${topic}`
    }

    const { content, generated } = await draftPostText(llm, channel, sourceBlock, link)

    const now = new Date()
    const post: MarketingPostDoc = {
      id: randomUUID(),
      tenant_id,
      channel,
      integration_id,
      content,
      state: 'draft',
      generated,
      ...(blog_slug ? { source_blog_slug: blog_slug } : {}),
      created_by: user_id,
      created_at: now,
    }
    await col.insertOne(post)
    getAuditLogger()?.fromRequest(req, 'marketing.post_generate', 'marketing_post', post.id, { channel, generated })
    return reply.status(201).send({ post })
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
