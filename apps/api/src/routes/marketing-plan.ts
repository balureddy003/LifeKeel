/**
 * /marketing/plan — the weekly content plan (PRD-210, phase 3).
 *
 *   GET  /marketing/plan?week=YYYY-MM-DD     the week's content items with their per-network drafts
 *   POST /marketing/plan/generate            draft the week from the pillar briefs (Tier 0)
 *   POST /marketing/plan/approve             approve reviewed drafts in one go (Tier 2, human)
 *   POST /marketing/plan/items/:id/skip      drop a content item and reject its drafts
 *
 * Approving a week is a human decision on named posts: each entry carries the hash of the exact text
 * the approver saw, a post whose text changed since is refused, and every post must pass the copy
 * guard and still be in the future. Approval schedules the post; the existing cron sweep dispatches it
 * at its time, and `marketing_paused` still stops that. Generating a plan never publishes anything.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { requireOperator } from '../operator/operator-auth.js'
import { taskLlm } from '../ai/task-gateway.js'
import type { LlmFn } from '@lifekeel/platform'
import { missingImage, plannableChannels } from '../marketing/channels.js'
import { checkCopy, describeViolations } from '../marketing/copy-guard.js'
import {
  contentHash,
  isMonday,
  nextMondayKey,
  planWeek,
  type ContentItemDoc,
} from '../marketing/content-plan.js'
import type { MarketingPostDoc } from './marketing-posts.js'

const CHANNELS = ['x', 'bluesky', 'threads', 'linkedin', 'instagram', 'facebook', 'mastodon']

export interface MarketingPlanOptions {
  operatorTenants?: string[]
  llm?: LlmFn
  now?: () => Date
}

export function registerMarketingPlanRoutes(
  app: FastifyInstance,
  db: Db,
  opts?: MarketingPlanOptions,
): void {
  const items = db.collection<ContentItemDoc>('content_items')
  const posts = db.collection<MarketingPostDoc>('marketing_posts')
  items.createIndex({ tenant_id: 1, week_key: 1, slot: 1 }, { unique: true }).catch(() => {})
  const now = () => opts?.now?.() ?? new Date()
  const llmFor = (tenantId: string) => opts?.llm ?? taskLlm('marketing.social_draft.v1', tenantId)

  const testGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!new Set(opts?.operatorTenants ?? []).has(req.authContext.tenant_id))
      await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')

  async function weekView(tenant_id: string, week: string) {
    const its = await items.find({ tenant_id, week_key: week }).sort({ slot: 1 }).toArray()
    const ids = its.map((i) => i.id)
    const ps = ids.length
      ? await posts.find({ tenant_id, content_item_id: { $in: ids } }).toArray()
      : []
    const { channels: usable, skipped } = await plannableChannels(db, tenant_id)
    return {
      week_key: week,
      available_channels: usable,
      skipped_channels: skipped,
      items: its.map((i) => ({
        ...i,
        posts: ps
          .filter((p) => p.content_item_id === i.id)
          .map((p) => ({
            id: p.id,
            channel: p.channel,
            content: p.content,
            content_hash: contentHash(p.content),
            state: p.state,
            scheduled_at: p.scheduled_at ?? null,
            copy_check: checkCopy(p.content, 'social'),
            needs_image: missingImage(p),
          })),
      })),
    }
  }

  app.get<{ Querystring: { week?: string } }>(
    '/marketing/plan',
    { preHandler: readGate },
    async (req, reply) => {
      const week = req.query.week ?? nextMondayKey(now())
      if (!isMonday(week)) return reply.status(400).send({ error: 'week_must_be_a_monday' })
      return weekView(req.authContext.tenant_id, week)
    },
  )

  app.post('/marketing/plan/generate', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const parsed = z
      .object({
        week_start: z.string(),
        channels: z.array(z.enum(CHANNELS as [string, ...string[]])).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success || !isMonday(parsed.data.week_start))
      return reply.status(400).send({ error: 'week_must_be_a_monday' })
    if (new Date(`${parsed.data.week_start}T23:59:59Z`) < now())
      return reply.status(400).send({ error: 'week_is_in_the_past' })

    const channels = parsed.data.channels ?? (await plannableChannels(db, tenant_id)).channels
    if (channels.length === 0)
      return reply.status(409).send({
        error: 'no_channels',
        message: 'Connect a network, or name the networks to draft for.',
      })

    const result = await planWeek(
      db,
      tenant_id,
      parsed.data.week_start,
      channels,
      llmFor(tenant_id),
      user_id,
    )
    getAuditLogger()?.fromRequest(
      req,
      'marketing.plan_generate',
      'content_plan',
      parsed.data.week_start,
      { ...result, channels },
    )
    return { ...result, ...(await weekView(tenant_id, parsed.data.week_start)) }
  })

  app.post('/marketing/plan/approve', { preHandler: manageGate }, async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const parsed = z
      .object({
        items: z
          .array(z.object({ post_id: z.string(), content_hash: z.string() }))
          .min(1)
          .max(100),
      })
      .safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })

    const results: { post_id: string; ok: boolean; error?: string }[] = []
    for (const { post_id, content_hash: seen } of parsed.data.items) {
      const post = await posts.findOne({
        id: post_id,
        tenant_id,
        state: { $in: ['draft', 'publish_failed'] },
      })
      if (!post || !post.content_item_id) {
        results.push({ post_id, ok: false, error: 'not_a_plan_draft' })
        continue
      }
      if (contentHash(post.content) !== seen) {
        results.push({ post_id, ok: false, error: 'text_changed_since_review' })
        continue
      }
      const check = checkCopy(post.content, 'social')
      if (!check.ok) {
        results.push({
          post_id,
          ok: false,
          error: `copy_guard_failed: ${describeViolations(check)}`,
        })
        continue
      }
      if (missingImage(post)) {
        results.push({ post_id, ok: false, error: 'image_required' })
        continue
      }
      if (!post.scheduled_at || post.scheduled_at.getTime() <= now().getTime()) {
        results.push({ post_id, ok: false, error: 'scheduled_time_has_passed' })
        continue
      }
      const claimed = await posts.updateOne(
        { id: post_id, tenant_id, state: { $in: ['draft', 'publish_failed'] } },
        { $set: { state: 'approved', approved_by: user_id, approved_at: now() } },
      )
      results.push(
        claimed.modifiedCount === 1
          ? { post_id, ok: true }
          : { post_id, ok: false, error: 'already_decided' },
      )
    }
    getAuditLogger()?.fromRequest(req, 'marketing.plan_approve', 'content_plan', 'batch', {
      approved: results.filter((r) => r.ok).map((r) => r.post_id),
      refused: results.filter((r) => !r.ok).length,
    })
    return {
      results,
      approved: results.filter((r) => r.ok).length,
      refused: results.filter((r) => !r.ok).length,
    }
  })

  app.post<{ Params: { id: string } }>(
    '/marketing/plan/items/:id/skip',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const item = await items.findOneAndUpdate(
        { id: req.params.id, tenant_id },
        { $set: { status: 'skipped' } },
      )
      if (!item) return reply.status(404).send({ error: 'Item not found' })
      await posts.updateMany(
        {
          tenant_id,
          content_item_id: req.params.id,
          state: { $in: ['draft', 'approved', 'publish_failed'] },
        },
        { $set: { state: 'rejected', rejected_by: user_id, rejected_at: now() } },
      )
      getAuditLogger()?.fromRequest(req, 'marketing.plan_skip', 'content_item', req.params.id, {})
      return { ok: true }
    },
  )
}
