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
  CONNECTOR_CHANNELS,
  type SocialPublisher,
  type SocialConnectionDoc,
} from '../marketing/social-publisher.js'
import { encryptIfNeeded, type LlmFn } from '@lifekeel/platform'
import { taskLlm } from '../ai/task-gateway.js'
import { ConnectorActionExecutor } from '@lifekeel/workflows'

export type MarketingPostState =
  'draft' | 'approved' | 'publishing' | 'published' | 'publish_failed' | 'rejected'

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
  /** UTM campaign tag — 'lifekeel_social' for ungrouped posts; named campaigns
   *  let the operator split performance by push. */
  campaign?: string
  source_blog_slug?: string
  /** Image URL for media-capable channels. Instagram REQUIRES it (its API
   *  has no text-only post); Facebook uses it as an attached photo. */
  media_url?: string
  external_id?: string
  external_url?: string
  metrics?: { likes?: number; reposts?: number; replies?: number }
  metrics_at?: Date
}

/** Campaign tags ride inside utm_campaign — slug-safe chars only. */
const CampaignSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/)

const UpdatePostSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
  // ISO datetime, empty string, or null — the latter two clear the schedule.
  scheduled_at: z.string().datetime().or(z.literal('')).nullable().optional(),
  media_url: z.string().url().max(2000).or(z.literal('')).nullable().optional(),
})

const CreatePostSchema = z.object({
  integration_id: z.string().min(1).max(200),
  channel: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  content: z.string().min(1).max(5000),
  scheduled_at: z.string().datetime().optional(),
  campaign: CampaignSchema.optional(),
  media_url: z.string().url().max(2000).optional(),
})

const GeneratePostSchema = z
  .object({
    integration_id: z.string().min(1).max(200),
    channel: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
    topic: z.string().min(1).max(500).optional(),
    blog_slug: z.string().min(1).max(200).optional(),
    campaign: CampaignSchema.optional(),
    /** Preview mode: return 1–3 draft variants without persisting — the
     *  operator picks one into the composer, which then creates normally. */
    preview: z.boolean().optional(),
    count: z.number().int().min(1).max(3).optional(),
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
  await db
    .collection('tenant_settings')
    .updateOne(
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
    await col.updateOne({ id: post.id }, { $set: { publish_error: 'marketing_paused' } })
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
    const result = (await client.createPost({
      integrationId: post.integration_id,
      content: post.content,
      channel: post.channel,
      type: 'now',
      date: now,
      tenantId: post.tenant_id,
      ...(post.media_url ? { mediaUrl: post.media_url } : {}),
    })) as { external_id?: string; url?: string } | undefined
    await col.updateOne(
      { id: post.id },
      {
        $set: {
          state: 'published',
          published_at: new Date(),
          publish_error: null,
          ...(result?.external_id ? { external_id: result.external_id } : {}),
          ...(result?.url ? { external_url: result.url } : {}),
        },
      },
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
  const due = (await col.find({ state: 'approved' }).sort({ scheduled_at: 1 }).limit(50).toArray())
    .filter((p) => !p.scheduled_at || p.scheduled_at.getTime() <= now.getTime())
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
export async function generateDailyMarketingDrafts(
  db: Db,
  llmFor: (tenantId: string) => LlmFn,
): Promise<number> {
  const postsCol = db.collection<MarketingPostDoc>('marketing_posts')
  const connsCol = db.collection<SocialConnectionDoc>('social_connections')
  const blogsCol = db.collection('blog_posts')
  const optedIn = (await db.collection('tenant_settings').find({}).toArray()).filter(
    (d) =>
      (d['automation'] as Record<string, unknown> | undefined)?.[
        'daily_marketing_drafts_enabled'
      ] === true,
  )

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
    const candidate = (
      await blogsCol.find({ published: true }).sort({ published_at: -1 }).limit(50).toArray()
    ).find((b) => !usedSlugs.has(b['slug'] as string))
    if (!candidate) continue

    const slug = candidate['slug'] as string
    const src = await blogSourceBlock(db, slug, conn.channel)
    if (!src) continue
    const learning = await learningContextBlock(db, tenantId, conn.channel)
    const { content, generated } = await draftPostText(
      llmFor(tenantId),
      conn.channel,
      src.sourceBlock,
      src.link,
      learning,
    )
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

/** Generate one review-gated draft promoting a blog post on a tenant's
 *  channel — extracted so the autopilot proposal-approve path produces
 *  the same 'draft' state as the daily sweep and the generate route.
 *  Returns null when the blog post is gone or the channel has no active
 *  connection. Generated content still never skips human review. */
export async function draftBlogPromoPost(
  db: Db,
  llmFor: (tenantId: string) => LlmFn,
  tenantId: string,
  blogSlug: string,
  channel: string,
  createdBy = 'autopilot-approve',
): Promise<MarketingPostDoc | null> {
  const src = await blogSourceBlock(db, blogSlug, channel)
  if (!src) return null
  const learning = await learningContextBlock(db, tenantId, channel)
  const { content, generated } = await draftPostText(
    llmFor(tenantId),
    channel,
    src.sourceBlock,
    src.link,
    learning,
  )
  const post: MarketingPostDoc = {
    id: randomUUID(),
    tenant_id: tenantId,
    channel,
    integration_id: `${channel}:connection`,
    content,
    campaign: 'lifekeel_social',
    state: 'draft',
    generated,
    source_blog_slug: blogSlug,
    created_by: createdBy,
    created_at: new Date(),
  }
  await db.collection<MarketingPostDoc>('marketing_posts').insertOne(post)
  return post
}

export interface MarketingPerformanceRow {
  slug: string
  title?: string
  views: number
  cta_clicks: number
  signups: number
  leads: number
}

/** GET /marketing/performance — closes the loop numerically: per promoted
 *  blog post, blog_view/blog_cta_click growth events joined against
 *  signups and leads attributed utm_medium=social (content=slug,
 *  campaign=named push).
 *  Channel rollups come from event meta.utm_source (captured since the
 *  UTM'd links shipped) and signup attribution. Aggregate counts only —
 *  no user-level data crosses this read. */
export async function marketingPerformance(db: Db): Promise<{
  posts: MarketingPerformanceRow[]
  channels: { channel: string; views: number; signups: number }[]
  campaigns: { campaign: string; views: number; signups: number; leads: number }[]
  totals: { views: number; cta_clicks: number; signups: number; leads: number }
  /** "What works" — trait-level engagement analysis over measured posts.
   *  Providers don't expose impressions, so engagement is normalized
   *  against the account's own median (x=1.0) rather than per-impression:
   *  a 2.1x multiplier reads "posts with this trait got ~2x the median
   *  engagement for this account". Honest comparative signal, never an
   *  absolute rate. */
  insights: {
    measured_posts: number
    unmeasured_channels: string[]
    rows: { label: string; measured: number; engagement_x: number }[]
    top_post?: { channel: string; excerpt: string; engagement: number }
  }
}> {
  const events = await db.collection('growth_events').find({}).toArray()
  const users = await db.collection('users').find({}).toArray()
  const leads = await db.collection('leads').find({}).toArray()
  const blogs = await db.collection('blog_posts').find({}).toArray()
  const publishedPosts = await db
    .collection<MarketingPostDoc>('marketing_posts')
    .find(
      { state: 'published' },
      {
        projection: {
          _id: 0,
          channel: 1,
          content: 1,
          metrics: 1,
          metrics_at: 1,
          source_blog_slug: 1,
          external_url: 1,
        },
      },
    )
    .toArray()
  const titleBy = new Map(blogs.map((b) => [b['slug'] as string, b['title'] as string]))

  const slugOf = (path: unknown) => /^\/blog\/([^/?#]+)/.exec(String(path ?? ''))?.[1]
  const rows = new Map<string, MarketingPerformanceRow>()
  const row = (slug: string) => {
    let r = rows.get(slug)
    if (!r) {
      r = { slug, views: 0, cta_clicks: 0, signups: 0, leads: 0 }
      rows.set(slug, r)
    }
    return r
  }
  const channelViews = new Map<string, number>()
  const channelSignups = new Map<string, number>()
  const channelCtas = new Map<string, number>()
  const channelLeads = new Map<string, number>()
  const campaignViews = new Map<string, number>()
  const campaignSignups = new Map<string, number>()
  const campaignLeads = new Map<string, number>()
  // utm_medium=social marks our generated/published links — any campaign
  // name under it counts; other mediums (ads, email) stay excluded.
  const isSocial = (a: Record<string, string> | undefined) => a?.['utm_medium'] === 'social'
  const campOf = (a: Record<string, string> | undefined) => a?.['utm_campaign'] || 'lifekeel_social'

  for (const e of events) {
    const slug = slugOf(e['path'])
    if (!slug) continue
    if (e['event'] === 'blog_view') {
      row(slug).views += 1
      const meta = e['meta'] as Record<string, unknown> | undefined
      const src = meta?.['utm_source']
      if (typeof src === 'string') channelViews.set(src, (channelViews.get(src) ?? 0) + 1)
      const camp = meta?.['utm_campaign']
      if (typeof camp === 'string') campaignViews.set(camp, (campaignViews.get(camp) ?? 0) + 1)
    } else if (e['event'] === 'blog_cta_click') {
      row(slug).cta_clicks += 1
      const meta = e['meta'] as Record<string, unknown> | undefined
      const src = meta?.['utm_source']
      if (typeof src === 'string') channelCtas.set(src, (channelCtas.get(src) ?? 0) + 1)
    }
  }
  for (const u of users) {
    const a = u['attribution'] as Record<string, string> | undefined
    if (!isSocial(a)) continue
    const slug = a!['utm_content']
    if (slug) row(slug).signups += 1
    const src = a!['utm_source']
    if (src) channelSignups.set(src, (channelSignups.get(src) ?? 0) + 1)
    campaignSignups.set(campOf(a), (campaignSignups.get(campOf(a)) ?? 0) + 1)
  }
  for (const l of leads) {
    const a = l['attribution'] as Record<string, string> | undefined
    if (!isSocial(a)) continue
    const slug = a!['utm_content']
    if (slug) row(slug).leads += 1
    campaignLeads.set(campOf(a), (campaignLeads.get(campOf(a)) ?? 0) + 1)
    const src = a!['utm_source']
    if (src) channelLeads.set(src, (channelLeads.get(src) ?? 0) + 1)
  }

  const posts = [...rows.values()]
    .map((r) => ({ ...r, title: titleBy.get(r.slug) }))
    .sort((a, b) => b.signups - a.signups || b.views - a.views)
  const channels = [
    ...new Set([
      ...channelViews.keys(),
      ...channelSignups.keys(),
      ...channelCtas.keys(),
      ...channelLeads.keys(),
    ]),
  ]
    .map((c) => ({
      channel: c,
      views: channelViews.get(c) ?? 0,
      cta_clicks: channelCtas.get(c) ?? 0,
      leads: channelLeads.get(c) ?? 0,
      signups: channelSignups.get(c) ?? 0,
    }))
    .sort((a, b) => b.signups - a.signups || b.views - a.views)
  const campaigns = [
    ...new Set([...campaignViews.keys(), ...campaignSignups.keys(), ...campaignLeads.keys()]),
  ]
    .map((c) => ({
      campaign: c,
      views: campaignViews.get(c) ?? 0,
      signups: campaignSignups.get(c) ?? 0,
      leads: campaignLeads.get(c) ?? 0,
    }))
    .sort((a, b) => b.signups - a.signups || b.views - a.views)
  const totals = posts.reduce(
    (t, r) => ({
      views: t.views + r.views,
      cta_clicks: t.cta_clicks + r.cta_clicks,
      signups: t.signups + r.signups,
      leads: t.leads + r.leads,
    }),
    { views: 0, cta_clicks: 0, signups: 0, leads: 0 },
  )

  // ── "What works" — engagement normalized against the account median ──
  const engagement = (p: MarketingPostDoc) => {
    const m = p.metrics ?? {}
    return (m.likes ?? 0) + (m.reposts ?? 0) * 3 + (m.replies ?? 0) * 2
  }
  const measured = publishedPosts.filter((p) => p.metrics_at)
  const unmeasuredChannels = [
    ...new Set(publishedPosts.filter((p) => !p.metrics_at).map((p) => p.channel)),
  ].sort()
  const medianOf = (nums: number[]) => {
    if (nums.length === 0) return 0
    const s = [...nums].sort((a, b) => a - b)
    return s.length % 2 === 1
      ? s[Math.floor(s.length / 2)]!
      : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
  }
  const accountMedian = medianOf(measured.map(engagement))
  const traits: { label: string; match: (p: MarketingPostDoc) => boolean }[] = [
    { label: 'Asks a question', match: (p) => p.content.includes('?') },
    { label: 'Shares a number or stat', match: (p) => /\d/.test(p.content) },
    { label: 'Promotes a blog post', match: (p) => Boolean(p.source_blog_slug) },
    { label: 'Short (under 160 chars)', match: (p) => p.content.length < 160 },
    { label: 'Long (240+ chars)', match: (p) => p.content.length >= 240 },
  ]
  const insightRows = traits
    .map((t) => {
      const inBucket = measured.filter(t.match)
      if (inBucket.length < 3) return null // too thin to mean anything
      const x =
        accountMedian === 0
          ? null
          : Math.round((medianOf(inBucket.map(engagement)) / accountMedian) * 10) / 10
      if (x === null || (x > 0.75 && x < 1.33)) return null // no signal either way
      return { label: t.label, measured: inBucket.length, engagement_x: x }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.engagement_x - a.engagement_x)
  const top =
    measured.length === 0
      ? undefined
      : [...measured].sort((a, b) => engagement(b) - engagement(a))[0]
  const insights = {
    measured_posts: measured.length,
    unmeasured_channels: unmeasuredChannels,
    rows: insightRows,
    ...(top
      ? {
          top_post: {
            channel: top.channel,
            excerpt: top.content.replace(/\s+/g, ' ').trim().slice(0, 140),
            engagement: engagement(top),
          },
        }
      : {}),
  }
  return { posts, channels, campaigns, totals, insights }
}

/** Engagement sweep — poll channel APIs for like/repost/reply counts on
 *  published posts from the last 14 days. Bluesky's app.bsky.feed.getPosts
 *  is public (no auth) and batches 25 at:// uris per call. X posts are
 *  read per-tenant through the connector executor — the OAuth token we
 *  hold already carries tweet.read, and getPostsById returns
 *  public_metrics. LinkedIn's read APIs need elevated scopes we don't
 *  hold — its posts simply keep metrics unset rather than fake zeros. */
export async function pollMarketingEngagement(db: Db): Promise<number> {
  const col = db.collection<MarketingPostDoc>('marketing_posts')
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const published = (await col.find({ state: 'published' }).toArray())
    .filter(
      (p) =>
        p.external_id &&
        !p.dry_run &&
        (!p.published_at || p.published_at.getTime() >= cutoff.getTime()),
    )
    .slice(0, 200)

  const bsky = published.filter(
    (p) => p.channel === 'bluesky' && p.external_id!.startsWith('at://'),
  )
  let updated = 0
  for (let i = 0; i < bsky.length; i += 25) {
    const chunk = bsky.slice(i, i + 25)
    const params = chunk.map((p) => `uris=${encodeURIComponent(p.external_id!)}`).join('&')
    const res = await fetch(`https://bsky.social/xrpc/app.bsky.feed.getPosts?${params}`)
    if (!res.ok) break // transient — the next tick retries
    const data = (await res.json()) as {
      posts?: { uri: string; likeCount?: number; repostCount?: number; replyCount?: number }[]
    }
    const byUri = new Map((data.posts ?? []).map((p) => [p.uri, p]))
    for (const post of chunk) {
      const rec = byUri.get(post.external_id!)
      if (!rec) continue
      await col.updateOne(
        { id: post.id },
        {
          $set: {
            metrics: {
              likes: rec.likeCount ?? 0,
              reposts: rec.repostCount ?? 0,
              replies: rec.replyCount ?? 0,
            },
            metrics_at: new Date(),
          },
        },
      )
      updated += 1
    }
  }

  // X — GET /2/tweets/{id}?tweet.fields=public_metrics via the connector
  // executor (handles token decrypt + refresh). One call per post;
  // tenants with needs_reauth or a failed read keep their last metrics.
  const xPosts = published.filter((p) => p.channel === 'x' && !p.external_id!.startsWith('at://'))
  if (xPosts.length) {
    const exec = new ConnectorActionExecutor(db)
    const hasCred = new Map<string, boolean>()
    for (const post of xPosts) {
      let ok = hasCred.get(post.tenant_id)
      if (ok === undefined) {
        const cred = await db
          .collection<Record<string, unknown>>('connector_credentials')
          .findOne({ tenant_id: post.tenant_id, connector_id: 'twitter_x' })
        ok = !!cred && cred['needs_reauth'] !== true
        hasCred.set(post.tenant_id, ok)
      }
      if (!ok) continue
      try {
        const res = await exec.execute(post.tenant_id, 'twitter_x', 'getPostsById', {
          post_id: post.external_id,
        })
        const m = (
          res.body as {
            data?: {
              public_metrics?: { like_count?: number; repost_count?: number; reply_count?: number }
            }
          } | null
        )?.data?.public_metrics
        if (!res.ok || !m) continue
        await col.updateOne(
          { id: post.id },
          {
            $set: {
              metrics: {
                likes: m.like_count ?? 0,
                reposts: m.repost_count ?? 0,
                replies: m.reply_count ?? 0,
              },
              metrics_at: new Date(),
            },
          },
        )
        updated += 1
      } catch {
        // transient — the next hourly tick retries
      }
    }
  }

  // Facebook Pages — GET /{post_id}?fields=likes.summary(true),comments.
  // summary(true),shares under the stored page token.
  const fbPosts = published.filter((p) => p.channel === 'facebook')
  if (fbPosts.length)
    updated += await pollViaExecutor(db, col, fbPosts, 'facebook_pages', 'get_post', (body) => {
      const b = body as {
        likes?: { summary?: { total_count?: number } }
        comments?: { summary?: { total_count?: number } }
        shares?: { count?: number }
      } | null
      if (!b) return null
      return {
        likes: b.likes?.summary?.total_count ?? 0,
        reposts: b.shares?.count ?? 0,
        replies: b.comments?.summary?.total_count ?? 0,
      }
    })

  // Instagram — like/comment counts are plain fields on the media object.
  const igPosts = published.filter((p) => p.channel === 'instagram')
  if (igPosts.length)
    updated += await pollViaExecutor(
      db,
      col,
      igPosts,
      'instagram_business',
      'get_media',
      (body) => {
        const b = body as { like_count?: number; comments_count?: number } | null
        if (!b) return null
        return { likes: b.like_count ?? 0, replies: b.comments_count ?? 0 }
      },
    )

  // Threads — insights endpoint returns a metric list, not flat fields.
  const threadPosts = published.filter((p) => p.channel === 'threads')
  if (threadPosts.length)
    updated += await pollViaExecutor(
      db,
      col,
      threadPosts,
      'threads',
      'get_media_insights',
      (body) => {
        const data = (body as { data?: { name?: string; values?: { value?: number }[] }[] } | null)
          ?.data
        if (!data) return null
        const metric = (name: string) => data.find((d) => d.name === name)?.values?.[0]?.value ?? 0
        return {
          likes: metric('likes'),
          reposts: metric('reposts') + metric('quotes'),
          replies: metric('replies'),
        }
      },
    )

  // Mastodon — the status object carries counts; env-token read.
  const mastoPosts = published.filter((p) => p.channel === 'mastodon')
  const mastoInstance = process.env['MASTODON_INSTANCE_URL']?.replace(/\/$/, '')
  const mastoToken = process.env['MASTODON_ACCESS_TOKEN']
  if (mastoPosts.length && mastoInstance && mastoToken) {
    for (const post of mastoPosts) {
      try {
        const res = await fetch(`${mastoInstance}/api/v1/statuses/${post.external_id}`, {
          headers: { Authorization: `Bearer ${mastoToken}` },
        })
        if (!res.ok) continue
        const s = (await res.json()) as {
          favourites_count?: number
          reblogs_count?: number
          replies_count?: number
        }
        await col.updateOne(
          { id: post.id },
          {
            $set: {
              metrics: {
                likes: s.favourites_count ?? 0,
                reposts: s.reblogs_count ?? 0,
                replies: s.replies_count ?? 0,
              },
              metrics_at: new Date(),
            },
          },
        )
        updated += 1
      } catch {
        // transient — the next hourly tick retries
      }
    }
  }
  return updated
}

/** Shared per-tenant engagement read for OAuth-connected channels — skips
 *  tenants with missing/reauth'd creds, decodes each provider's response
 *  shape into the common {likes, reposts, replies} form. */
async function pollViaExecutor(
  db: Db,
  col: { updateOne: (f: Record<string, unknown>, u: Record<string, unknown>) => Promise<unknown> },
  posts: MarketingPostDoc[],
  connectorId: string,
  actionId: string,
  decode: (body: unknown) => { likes?: number; reposts?: number; replies?: number } | null,
): Promise<number> {
  const exec = new ConnectorActionExecutor(db)
  const hasCred = new Map<string, boolean>()
  let updated = 0
  for (const post of posts) {
    let ok = hasCred.get(post.tenant_id)
    if (ok === undefined) {
      const cred = await db
        .collection<Record<string, unknown>>('connector_credentials')
        .findOne({ tenant_id: post.tenant_id, connector_id: connectorId })
      ok = !!cred && cred['needs_reauth'] !== true
      hasCred.set(post.tenant_id, ok)
    }
    if (!ok) continue
    try {
      const paramKey = connectorId === 'facebook_pages' ? 'post_id' : 'media_id'
      const res = await exec.execute(post.tenant_id, connectorId, actionId, {
        [paramKey]: post.external_id,
      })
      const metrics = res.ok ? decode(res.body) : null
      if (!metrics) continue
      await col.updateOne({ id: post.id }, { $set: { metrics, metrics_at: new Date() } })
      updated += 1
    } catch {
      // transient — the next hourly tick retries
    }
  }
  return updated
}

export interface MarketingRouteOptions {
  operatorTenants?: string[]
  llm?: LlmFn
}

/** Per-channel hard caps — the model is told the limit, then the output is
 *  clamped anyway because LLMs can't count. */
const CHANNEL_CHAR_LIMIT: Record<string, number> = {
  x: 280,
  bluesky: 300,
  threads: 500,
  linkedin: 3000,
  instagram: 2200,
  facebook: 5000,
  mastodon: 500,
}

/** reserve: characters held back for an appended link — the clamp must
 *  never eat the CTA URL, an unlinked draft converts nobody. */
function clampPost(text: string, limit: number, reserve = 0): string {
  const trimmed = text.trim()
  const cap = limit - reserve
  if (trimmed.length <= cap) return trimmed
  const window = trimmed.slice(0, cap - 1)
  const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf(' '))
  return `${window.slice(0, cut > cap * 0.6 ? cut : cap - 1).trimEnd()}…`
}

const GENERATE_SYSTEM = `You write social posts for LifeKeel — a free tool that shows a family
in two minutes how ready their finances are for the unexpected (illness,
job loss, a death in the family), plus plain-English education on the
gaps it finds.

Voice: sharp, warm, concrete — a thoughtful person sharing something
genuinely useful, not a brand account broadcasting. Open with a hook:
a hard question, a "what would happen if…", or a surprising everyday
fact. Short lines. End by inviting the reader to try the free check.

Rules — these are non-negotiable:
- Informational, educational tone only. Never personalized financial,
  insurance, or investment advice. Never name, rank, or recommend a
  specific provider, policy, or product. No savings promises, no
  manufactured urgency or fear-baiting.
- Only use facts and numbers that appear in the source material —
  never invent statistics.
- Plain text only — no markdown. At most two hashtags; at most one
  emoji, never in the hook.
- When a link is provided, include it verbatim on its own line at
  the end.
- When a WINNER/FLOP performance section is provided, use it as the
  style bar: match the winners' hooks and structure, avoid whatever
  the flops did — but never reuse their exact wording.
- Return ONLY the post text, nothing else.`

/** UTM'd site link — clicks land in users.attribution.utm_source so the
 *  operator funnel can attribute signups back to the channel/post. */
function siteLink(
  channel: string,
  path: string,
  contentTag: string,
  campaign = 'lifekeel_social',
): string {
  const base = (process.env['LIFEKEEL_URL'] ?? '').replace(/\/$/, '')
  return base
    ? `${base}${path}?utm_source=${encodeURIComponent(channel)}&utm_medium=social&utm_campaign=${encodeURIComponent(campaign)}&utm_content=${encodeURIComponent(contentTag)}`
    : ''
}

async function blogSourceBlock(
  db: Db,
  blogSlug: string,
  channel: string,
  campaign = 'lifekeel_social',
): Promise<{ sourceBlock: string; link: string } | null> {
  const post = await db.collection('blog_posts').findOne({ slug: blogSlug, published: true })
  if (!post) return null
  // utm_content carries the slug for per-post reads.
  const link = siteLink(channel, `/blog/${blogSlug}`, blogSlug, campaign)
  return {
    link,
    sourceBlock: `Blog post to promote:\nTitle: ${post['title']}\nSummary: ${post['excerpt']}${link ? `\nLink to include verbatim: ${link}` : ''}`,
  }
}

/** The learning loop's prompt side — what this tenant's audience actually
 *  responded to. Published posts are scored on polled engagement plus the
 *  signups/leads their promoted slug attributed (utm_content carries it);
 *  the top and bottom ends are quoted back to the model as style signal.
 *  Strictly tenant-scoped — nobody else's winners leak into a prompt.
 *  Returns '' when the sample is too thin for "learning" to mean anything,
 *  so a brand-new tenant generates exactly as before. */
async function learningContextBlock(db: Db, tenantId: string, channel: string): Promise<string> {
  const published = await db
    .collection<MarketingPostDoc>('marketing_posts')
    .find({ tenant_id: tenantId, state: 'published' })
    .toArray()
  if (published.length < 2) return ''

  // Conversions join back through the slug the post promoted.
  const conversionsBySlug = new Map<string, number>()
  const bump = (slug: unknown, n = 1) => {
    if (typeof slug === 'string' && slug)
      conversionsBySlug.set(slug, (conversionsBySlug.get(slug) ?? 0) + n)
  }
  for (const u of await db.collection('users').find({}).toArray()) {
    const a = u['attribution'] as Record<string, string> | undefined
    if (a?.['utm_medium'] === 'social') bump(a['utm_content'])
  }
  for (const l of await db.collection('leads').find({}).toArray()) {
    const a = l['attribution'] as Record<string, string> | undefined
    if (a?.['utm_medium'] === 'social') bump(a['utm_content'])
  }

  const scored = published.map((p) => {
    const m = p.metrics ?? {}
    const conversions = p.source_blog_slug ? (conversionsBySlug.get(p.source_blog_slug) ?? 0) : 0
    // Conversions outweigh vanity metrics by a wide margin — a signup is
    // the actual goal; a like is directional signal at best.
    const score = conversions * 10 + (m.reposts ?? 0) * 3 + (m.replies ?? 0) * 2 + (m.likes ?? 0)
    return { p, score, conversions }
  })

  // Same-channel winners first — platform conventions differ, then fill
  // with cross-channel signal if the channel itself is thin.
  const winners = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  const channelWinners = winners.filter((s) => s.p.channel === channel).slice(0, 3)
  const otherWinners = winners
    .filter((s) => s.p.channel !== channel)
    .slice(0, Math.max(0, 3 - channelWinners.length))
  const flops = scored
    .filter((s) => s.score === 0 && s.p.metrics_at) // only "measured and flat", never unmeasured
    .slice(0, 2)

  const top = [...channelWinners, ...otherWinners]
  if (top.length === 0 && flops.length === 0) return ''

  const excerpt = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140)
  const lines: string[] = [
    'What has performed for THIS account before — study the winners for structure and tone (never copy wording):',
  ]
  for (const { p, conversions } of top) {
    const m = p.metrics ?? {}
    const stats = [
      `${m.likes ?? 0} likes`,
      `${m.reposts ?? 0} reposts`,
      `${m.replies ?? 0} replies`,
      conversions > 0 ? `${conversions} signups/leads` : null,
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(`WINNER [${p.channel}]: "${excerpt(p.content)}" → ${stats}`)
  }
  for (const { p } of flops) {
    lines.push(
      `FLOP [${p.channel}]: "${excerpt(p.content)}" → no measured response — avoid this angle/style`,
    )
  }
  return lines.join('\n')
}

/** LLM draft with deterministic fallback — shared by the generate route
 *  and the daily cron so both produce identical-quality output. */
async function draftPostText(
  llm: LlmFn,
  channel: string,
  sourceBlock: string,
  link: string,
  learning = '',
): Promise<{ content: string; generated: 'llm' | 'template' }> {
  const limit = CHANNEL_CHAR_LIMIT[channel] ?? 2000
  try {
    const raw = await llm(
      GENERATE_SYSTEM,
      `Channel: ${channel} (hard maximum ${limit} characters — stay under it).\n\n${sourceBlock}${learning ? `\n\n${learning}` : ''}\n\nWrite one post.`,
      'tier:fast',
    )
    const content = finishPost(raw, limit, link)
    if (!content) throw new Error('empty generation')
    return { content, generated: 'llm' }
  } catch {
    const body = clampPost(
      sourceBlock.split('\n').slice(1).join('\n'),
      limit,
      link ? link.length + 2 : 0,
    )
    return { generated: 'template', content: `${body}${link ? `\n\n${link}` : ''}` }
  }
}

/** Re-append the CTA link with its room reserved when the model dropped
 *  it — an unlinked draft has no funnel and no attribution. */
function finishPost(raw: string, limit: number, link: string): string {
  return link && !raw.includes(link)
    ? `${clampPost(raw, limit, link.length + 2)}\n\n${link}`
    : clampPost(raw, limit)
}

/** Preview variants for the composer — one LLM call asks for N takes
 *  separated by '---' lines so the picker stays cheap. Nothing is
 *  persisted; the operator picks a variant, edits it, and queues via
 *  the normal create route where review/trust rules live. */
export async function draftPostVariants(
  llm: LlmFn,
  channel: string,
  sourceBlock: string,
  link: string,
  count: number,
  learning = '',
): Promise<string[]> {
  const limit = CHANNEL_CHAR_LIMIT[channel] ?? 2000
  const tail = learning ? `\n\n${learning}` : ''
  if (count <= 1) {
    const raw = await llm(
      GENERATE_SYSTEM,
      `Channel: ${channel} (hard maximum ${limit} characters — stay under it).\n\n${sourceBlock}${tail}\n\nWrite one post.`,
      'tier:fast',
    )
    return [finishPost(raw, limit, link)].filter(Boolean)
  }
  const raw = await llm(
    GENERATE_SYSTEM,
    `Channel: ${channel} (hard maximum ${limit} characters each — stay under it).\n\n${sourceBlock}${tail}\n\nWrite ${count} meaningfully different variants — vary the hook, angle, and CTA phrasing. Separate variants with a line containing only ---`,
    'tier:fast',
  )
  const drafts = raw
    .split(/\n\s*---+\s*\n/)
    .map((p) => finishPost(p, limit, link))
    .filter(Boolean)
    .slice(0, count)
  if (drafts.length) return drafts
  const single = finishPost(raw, limit, link)
  return single ? [single] : []
}

export function registerMarketingPostRoutes(
  app: FastifyInstance,
  db: Db,
  publisher?: SocialPublisher | null,
  opts?: MarketingRouteOptions,
): void {
  const client =
    publisher === undefined ? new DbSocialPublisher(db, socialPublisherFromEnv()) : publisher
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
    if (!allowed.has(req.authContext.tenant_id))
      await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')
  // Governed per-tenant fn (intent 01); opts.llm remains the test seam.
  const llmFor = (tenantId: string) => opts?.llm ?? taskLlm('marketing.social_draft.v1', tenantId)

  /** GET /marketing/integrations — channels the composer can target: this
   *  tenant's stored connections plus any env-configured channels. */
  app.get('/marketing/integrations', { preHandler: readGate }, async (req, reply) => {
    if (!client) return reply.status(503).send({ error: 'publisher_not_configured' })
    const integrations = await client.listIntegrations(req.authContext.tenant_id)
    return {
      integrations: integrations.map((i) => ({
        id: i.id,
        name: i.name,
        identifier: i.identifier,
        disabled: i.disabled === true,
        source: i.source,
      })),
    }
  })

  /** GET /marketing/connections — this tenant's stored channel credentials,
   *  minus the credentials themselves. OAuth-connected channels (X,
   *  Facebook, LinkedIn, Threads, Instagram) live in connector_credentials —
   *  the OAuth connect flow is under /connectors, not /marketing — so each
   *  row is projected into the same shape here for a single list. */
  app.get('/marketing/connections', { preHandler: readGate }, async (req) => {
    const tenantId = req.authContext.tenant_id
    const [conns, creds] = await Promise.all([
      connectionsCol.find({ tenant_id: tenantId }).toArray(),
      db
        .collection<Record<string, unknown>>('connector_credentials')
        .find({ tenant_id: tenantId, connector_id: { $in: Object.values(CONNECTOR_CHANNELS) } })
        .toArray(),
    ])
    const channelByConnector = new Map(
      Object.entries(CONNECTOR_CHANNELS).map(([channel, connector]) => [connector, channel]),
    )
    return {
      connections: [
        ...conns.map(({ credentials: _credentials, ...rest }) => rest),
        ...creds.map((cred) => {
          const channel =
            channelByConnector.get(cred['connector_id'] as string) ?? cred['connector_id']
          const extra = cred['extra'] as Record<string, string> | undefined
          const needsReauth = cred['needs_reauth'] === true
          return {
            tenant_id: tenantId,
            channel,
            handle:
              extra?.['username'] ??
              extra?.['page_name'] ??
              extra?.['name'] ??
              extra?.['ig_username'] ??
              '',
            status: needsReauth ? 'error' : 'active',
            last_error: needsReauth ? `${channel} token expired — reconnect` : null,
            connected_by: 'oauth',
            updated_at: cred['updated_at'],
          }
        }),
      ],
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
    getAuditLogger()?.fromRequest(
      req,
      'marketing.connection_connect',
      'social_connection',
      `bluesky:${tenant_id}`,
      {
        channel: 'bluesky',
        handle,
      },
    )
    return reply.status(201).send({
      connection: {
        tenant_id,
        channel: 'bluesky',
        handle,
        did,
        status: 'active',
        connected_by: user_id,
        updated_at: now,
      },
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
      let deleted = result.deletedCount ?? 0
      // OAuth-connected rows live in connector_credentials (the generic
      // OAuth flow), not social_connections — disconnect removes them too.
      const connectorId = CONNECTOR_CHANNELS[req.params.channel]
      if (connectorId) {
        const credRes = await db
          .collection('connector_credentials')
          .deleteOne({ tenant_id, connector_id: connectorId })
        deleted += credRes.deletedCount ?? 0
      }
      if (!deleted) return reply.status(404).send({ error: 'No such connection' })
      getAuditLogger()?.fromRequest(
        req,
        'marketing.connection_disconnect',
        'social_connection',
        `${req.params.channel}:${tenant_id}`,
        {},
      )
      return { ok: true }
    },
  )

  /** GET /marketing/performance — promoted-post funnel rollup. */
  app.get('/marketing/performance', { preHandler: readGate }, async () => marketingPerformance(db))

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
    const { integration_id, channel, content, scheduled_at, campaign, media_url } = parsed.data
    if (channel === 'instagram' && !media_url) {
      return reply.status(400).send({ error: 'Instagram requires an image — provide media_url' })
    }
    const now = new Date()
    const post: MarketingPostDoc = {
      id: randomUUID(),
      tenant_id,
      channel,
      integration_id,
      content,
      campaign: campaign ?? 'lifekeel_social',
      ...(scheduled_at ? { scheduled_at: new Date(scheduled_at) } : {}),
      ...(media_url ? { media_url } : {}),
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
        const result = await publishPost(db, col, client, claimed, {
          dryRun: automation.dry_run_mode === true,
        })
        if (result.ok) {
          await col.updateOne({ id: post.id }, { $set: { auto_published: true } })
          getAuditLogger()?.fromRequest(
            req,
            'marketing.post_auto_publish',
            'marketing_post',
            post.id,
            { channel },
          )
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
    const { integration_id, channel, topic, blog_slug, campaign, preview, count } = parsed.data
    const camp = campaign ?? 'lifekeel_social'

    let sourceBlock: string
    let link = ''
    if (blog_slug) {
      const src = await blogSourceBlock(db, blog_slug, channel, camp)
      if (!src) return reply.status(404).send({ error: 'Blog post not found' })
      sourceBlock = src.sourceBlock
      link = src.link
    } else {
      // Free-topic drafts still need a funnel — link the readiness check.
      link = siteLink(channel, '/readiness', 'topic', camp)
      sourceBlock = `Topic: ${topic}${link ? `\nLink to include verbatim: ${link}` : ''}`
    }

    // The learning loop: quote this tenant's measured winners/flops back to
    // the model so each generation round is informed by what actually moved
    // views, engagement, and signups — not just by the source material.
    const learning = await learningContextBlock(db, tenant_id, channel)

    if (preview) {
      try {
        const drafts = await draftPostVariants(
          llmFor(tenant_id),
          channel,
          sourceBlock,
          link,
          count ?? 3,
          learning,
        )
        return { drafts }
      } catch {
        // Same deterministic fallback as the persisted path.
        const { content } = await draftPostText(
          async () => {
            throw new Error('fallback')
          },
          channel,
          sourceBlock,
          link,
        )
        return { drafts: [content] }
      }
    }

    const { content, generated } = await draftPostText(
      llmFor(tenant_id),
      channel,
      sourceBlock,
      link,
      learning,
    )

    const now = new Date()
    const post: MarketingPostDoc = {
      id: randomUUID(),
      tenant_id,
      channel,
      integration_id,
      content,
      campaign: camp,
      state: 'draft',
      generated,
      ...(blog_slug ? { source_blog_slug: blog_slug } : {}),
      created_by: user_id,
      created_at: now,
    }
    await col.insertOne(post)
    getAuditLogger()?.fromRequest(req, 'marketing.post_generate', 'marketing_post', post.id, {
      channel,
      generated,
    })
    return reply.status(201).send({ post })
  })

  /** PATCH /marketing/posts/:id — edit a pending post's content or
   *  schedule. Only 'draft' and 'publish_failed' are editable — 'approved'
   *  is already claimed for dispatch, so rescheduling there would race the
   *  sweep; cancel it (reject) and edit from draft instead. */
  app.patch<{ Params: { id: string } }>(
    '/marketing/posts/:id',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const parsed = UpdatePostSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid update', issues: parsed.error.issues })
      }
      const { content, scheduled_at, media_url } = parsed.data
      const set: Record<string, unknown> = {}
      const unset: Record<string, ''> = {}
      if (content !== undefined) set['content'] = content
      if (scheduled_at) set['scheduled_at'] = new Date(scheduled_at)
      else if (scheduled_at !== undefined) unset['scheduled_at'] = ''
      if (media_url) set['media_url'] = media_url
      else if (media_url !== undefined) unset['media_url'] = ''
      if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
        return reply.status(400).send({ error: 'Nothing to update' })
      }
      const post = (await col.findOneAndUpdate(
        { id: req.params.id, tenant_id, state: { $in: ['draft', 'publish_failed'] } },
        {
          ...(Object.keys(set).length ? { $set: set } : {}),
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
        { returnDocument: 'after' },
      )) as MarketingPostDoc | null
      if (!post) return reply.status(404).send({ error: 'Post not found or not editable' })
      getAuditLogger()?.fromRequest(req, 'marketing.post_update', 'marketing_post', post.id, {
        channel: post.channel,
        edited: [...Object.keys(set), ...Object.keys(unset)],
      })
      return { post }
    },
  )

  /** POST /marketing/posts/:id/approve — human decision; publishes and earns
   *  channel trust on success. Retries publish_failed posts. */
  app.post<{ Params: { id: string } }>(
    '/marketing/posts/:id/approve',
    { preHandler: manageGate },
    async (req, reply) => {
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
      const result = await publishPost(db, col, client, claimed, {
        dryRun: automation.dry_run_mode === true,
      })
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
      getAuditLogger()?.fromRequest(req, 'marketing.post_approve', 'marketing_post', claimed.id, {
        channel: claimed.channel,
      })
      const post = await col.findOne({ id: claimed.id })
      return { post }
    },
  )

  /** POST /marketing/posts/:id/reject — kill a queued draft. 'approved' is
   *  included so a scheduled post can be pulled before the publish sweep
   *  picks it up; 'publishing' is excluded — a claimed dispatch can't be
   *  unwound. */
  app.post<{ Params: { id: string } }>(
    '/marketing/posts/:id/reject',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const result = (await col.findOneAndUpdate(
        { id: req.params.id, tenant_id, state: { $in: ['draft', 'publish_failed', 'approved'] } },
        { $set: { state: 'rejected', rejected_by: user_id, rejected_at: new Date() } },
        { returnDocument: 'after' },
      )) as MarketingPostDoc | null
      if (!result) {
        return reply.status(404).send({ error: 'Post not found or already decided' })
      }
      getAuditLogger()?.fromRequest(
        req,
        'marketing.post_reject',
        'marketing_post',
        req.params.id,
        {},
      )
      return { post: result }
    },
  )
}
