/**
 * /marketing/bank — the content bank (standing approvals, step 1).
 *
 *   GET  /marketing/bank?status=            entries with their hash, copy check and image state
 *   POST /marketing/bank                    add a candidate by hand
 *   POST /marketing/bank/from-post          copy a plan draft into the bank as a candidate
 *   PATCH /marketing/bank/:id               edit a candidate's text (approved entries are immutable)
 *   POST /marketing/bank/approve            approve candidates by the hash the reviewer saw (Tier 2, human)
 *   POST /marketing/bank/:id/retire         take an entry out of use
 *
 * Approving an entry is a human decision on exact text, the same act as approving a post in the weekly plan.
 * Nothing here schedules or publishes; that is marketing/standing.ts, within limits a human sets.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { requireOperator } from '../operator/operator-auth.js'
import {
  addCandidate,
  approveEntries,
  channelsMissingImage,
  editCandidate,
  ensureBankIndexes,
  listEntries,
  retireEntry,
  templatizeLink,
  type BankEntryDoc,
} from '../marketing/bank.js'
import { contentHash } from '../marketing/content-plan.js'
import { checkCopy } from '../marketing/copy-guard.js'
import type { MarketingPostDoc } from './marketing-posts.js'

const CHANNELS = [
  'x',
  'bluesky',
  'threads',
  'linkedin',
  'instagram',
  'facebook',
  'mastodon',
] as const

const CardSchema = z.object({
  layout: z.enum(['headline', 'myth_fact']),
  headline: z.string().min(1).max(300),
  sub: z.string().max(300).optional(),
})

const NewEntrySchema = z.object({
  content: z.string().min(1).max(5000),
  channels: z.array(z.enum(CHANNELS)).min(1).max(7),
  format: z.string().max(60).nullable().optional(),
  hook: z.string().max(60).nullable().optional(),
  pillar: z.string().max(60).nullable().optional(),
  card: CardSchema.optional(),
  media_url: z.string().url().max(2000).optional(),
  alt_text: z.string().max(500).optional(),
  link_path: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]{0,200}$/)
    .optional(),
  campaign: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,59}$/)
    .optional(),
})

export interface MarketingBankOptions {
  operatorTenants?: string[]
  now?: () => Date
}

export function bankView(e: BankEntryDoc) {
  return {
    id: e.id,
    content: e.content,
    content_hash: contentHash(e.content),
    channels: e.channels,
    format: e.format ?? null,
    hook: e.hook ?? null,
    pillar: e.pillar ?? null,
    status: e.status,
    source: e.source,
    card: e.card ?? null,
    media_url: e.media_url ?? null,
    alt_text: e.alt_text ?? null,
    link_path: e.link_path ?? null,
    campaign: e.campaign ?? null,
    copy_check: checkCopy(e.content, 'social'),
    missing_image_for: channelsMissingImage(e),
    approved_by: e.approved_by ?? null,
    approved_at: e.approved_at ?? null,
    expires_at: e.expires_at ?? null,
    last_scheduled_at: e.last_scheduled_at ?? null,
    times_scheduled: e.times_scheduled,
    retired_reason: e.retired_reason ?? null,
    created_at: e.created_at,
  }
}

export function registerMarketingBankRoutes(
  app: FastifyInstance,
  db: Db,
  opts?: MarketingBankOptions,
): void {
  ensureBankIndexes(db)
  const posts = db.collection<MarketingPostDoc>('marketing_posts')
  const now = () => opts?.now?.() ?? new Date()

  const testGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!new Set(opts?.operatorTenants ?? []).has(req.authContext.tenant_id))
      await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')

  app.get<{ Querystring: { status?: string } }>(
    '/marketing/bank',
    { preHandler: readGate },
    async (req, reply) => {
      const status = req.query.status
      if (status && !['candidate', 'approved', 'retired'].includes(status))
        return reply.status(400).send({ error: 'invalid_status' })
      const entries = await listEntries(
        db,
        req.authContext.tenant_id,
        status as BankEntryDoc['status'] | undefined,
      )
      return { entries: entries.map(bankView) }
    },
  )

  app.post('/marketing/bank', { preHandler: manageGate }, async (req, reply) => {
    const parsed = NewEntrySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    const { tenant_id, user_id } = req.authContext
    const entry = await addCandidate(
      db,
      tenant_id,
      user_id,
      { ...parsed.data, source: 'manual' },
      now(),
    )
    getAuditLogger()?.fromRequest(req, 'marketing.bank_add', 'content_bank', entry.id, {
      source: 'manual',
    })
    return reply.status(201).send(bankView(entry))
  })

  app.post('/marketing/bank/from-post', { preHandler: manageGate }, async (req, reply) => {
    const parsed = z.object({ post_id: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' })
    const { tenant_id, user_id } = req.authContext
    const post = await posts.findOne({ id: parsed.data.post_id, tenant_id })
    if (!post || !post.content_item_id) return reply.status(404).send({ error: 'not_a_plan_draft' })
    // The post's own tagged link becomes a token: each scheduled post gets a fresh tag of its own.
    const tpl = templatizeLink(post.content, post.post_tag)
    const entry = await addCandidate(
      db,
      tenant_id,
      user_id,
      {
        content: tpl.content,
        ...(tpl.link_path ? { link_path: tpl.link_path } : {}),
        ...(post.campaign ? { campaign: post.campaign } : {}),
        channels: [post.channel],
        format: post.features?.format ?? null,
        hook: post.features?.hook ?? null,
        pillar: post.features?.pillar ?? post.pillar ?? null,
        brief_id: post.brief_id ?? null,
        ...(post.card ? { card: post.card } : {}),
        ...(!post.card && post.media_url ? { media_url: post.media_url } : {}),
        ...(post.alt_text ? { alt_text: post.alt_text } : {}),
        source: 'plan_draft',
      },
      now(),
    )
    getAuditLogger()?.fromRequest(req, 'marketing.bank_add', 'content_bank', entry.id, {
      source: 'plan_draft',
      post_id: post.id,
    })
    return reply.status(201).send(bankView(entry))
  })

  app.patch<{ Params: { id: string } }>(
    '/marketing/bank/:id',
    { preHandler: manageGate },
    async (req, reply) => {
      const parsed = z.object({ content: z.string().min(1).max(5000) }).safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' })
      const { tenant_id } = req.authContext
      const outcome = await editCandidate(db, tenant_id, req.params.id, parsed.data.content)
      if (outcome === 'not_found') return reply.status(404).send({ error: 'Entry not found' })
      if (outcome === 'not_a_candidate')
        return reply.status(409).send({
          error: 'not_a_candidate',
          message: 'Retire an approved entry and add a new one.',
        })
      getAuditLogger()?.fromRequest(req, 'marketing.bank_edit', 'content_bank', req.params.id, {})
      const [entry] = await listEntries(db, tenant_id).then((all) =>
        all.filter((e) => e.id === req.params.id),
      )
      return entry ? bankView(entry) : { ok: true }
    },
  )

  app.post('/marketing/bank/approve', { preHandler: manageGate }, async (req, reply) => {
    const parsed = z
      .object({
        items: z
          .array(z.object({ id: z.string(), content_hash: z.string() }))
          .min(1)
          .max(100),
      })
      .safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    const { tenant_id, user_id } = req.authContext
    const results = await approveEntries(db, tenant_id, user_id, parsed.data.items, now())
    getAuditLogger()?.fromRequest(req, 'marketing.bank_approve', 'content_bank', 'batch', {
      approved: results.filter((r) => r.ok).map((r) => r.id),
      refused: results.filter((r) => !r.ok).length,
    })
    return {
      results,
      approved: results.filter((r) => r.ok).length,
      refused: results.filter((r) => !r.ok).length,
    }
  })

  app.post<{ Params: { id: string } }>(
    '/marketing/bank/:id/retire',
    { preHandler: manageGate },
    async (req, reply) => {
      const parsed = z
        .object({ reason: z.string().min(1).max(300).optional() })
        .safeParse(req.body ?? {})
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' })
      const { tenant_id, user_id } = req.authContext
      const ok = await retireEntry(
        db,
        tenant_id,
        req.params.id,
        user_id,
        parsed.data.reason ?? 'retired_by_operator',
        now(),
      )
      if (!ok) return reply.status(404).send({ error: 'Entry not found or already retired' })
      getAuditLogger()?.fromRequest(req, 'marketing.bank_retire', 'content_bank', req.params.id, {})
      return { ok: true }
    },
  )
}
