/**
 * /marketing/profiles — the profiles half of the marketing engine (PRD-210, phase 2).
 *
 *   GET  /marketing/profiles                    desired text, last read-back and drift, per network
 *   PUT  /marketing/profiles/:channel           edit the desired text (limits and the copy guard apply)
 *   PUT  /marketing/profiles/:channel/checklist tick a manual setup step
 *   POST /marketing/profiles/:channel/check     read the live profile and compute drift (Bluesky)
 *   POST /marketing/profiles/:channel/apply     write the approved text to the network (Bluesky)
 *
 * Autonomy model: reading and planning are Tier 0. Writing to a network profile is public and
 * outward-facing, so it is Tier 2 and only happens here, on a human's approve call that names the
 * exact text (`expected_hash`). `marketing.profile_update` is in autopilot's NEVER_AUTONOMOUS list.
 * `marketing_paused` stops it; dry-run mode rehearses it without a network call. Accounts are never
 * created by this code.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getAuditLogger } from '../audit/audit-log.js'
import { requireOperator } from '../operator/operator-auth.js'
import { getPlatformConfig } from '../operator/platform-config.js'
import type { SocialConnectionDoc } from '../marketing/social-publisher.js'
import {
  BIO_LIMIT,
  CHECKLIST_ITEMS,
  DEFAULT_PROFILES,
  PROFILE_CHANNELS,
  SUPPORTS_APPLY,
  SUPPORTS_CHECK,
  applyBlueskyProfile,
  computeDrift,
  desiredHash,
  isProfileChannel,
  readBlueskyProfile,
  validateDesired,
  type DesiredProfile,
  type ProfileChannel,
  type ProfileDoc,
} from '../marketing/channel-profiles.js'
import { getAutomation } from './marketing-posts.js'

const DesiredSchema = z.object({
  display_name: z.string().trim().min(1).max(100),
  handle: z.string().trim().min(1).max(100),
  bio: z.string().trim().max(2000),
  link: z.string().trim().url().max(500),
})

export interface MarketingProfileOptions {
  /** Test seam: skip the operator permission check for these tenants. */
  operatorTenants?: string[]
  readProfile?: typeof readBlueskyProfile
  applyProfile?: typeof applyBlueskyProfile
}

export function registerMarketingProfileRoutes(
  app: FastifyInstance,
  db: Db,
  opts?: MarketingProfileOptions,
): void {
  const col = db.collection<ProfileDoc>('channel_profiles')
  const connections = db.collection<SocialConnectionDoc>('social_connections')
  col.createIndex({ tenant_id: 1, channel: 1 }, { unique: true }).catch(() => {})
  const read = opts?.readProfile ?? readBlueskyProfile
  const apply = opts?.applyProfile ?? applyBlueskyProfile

  const testGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const allowed = new Set(opts?.operatorTenants ?? [])
    if (!allowed.has(req.authContext.tenant_id))
      await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')

  const view = (tenant_id: string, channel: ProfileChannel, doc: ProfileDoc | null) => {
    const desired = doc?.desired ?? DEFAULT_PROFILES[channel]
    const v = validateDesired(channel, desired)
    return {
      channel,
      desired,
      desired_hash: desiredHash(desired),
      problems: v.problems,
      bio_limit: BIO_LIMIT[channel],
      checklist_items: CHECKLIST_ITEMS[channel],
      checklist: doc?.checklist ?? {},
      actual: doc?.actual ?? null,
      drift: doc?.drift ?? [],
      supports_check: SUPPORTS_CHECK.has(channel),
      supports_apply: SUPPORTS_APPLY.has(channel),
      saved: Boolean(doc),
      applied_at: doc?.applied_at ?? null,
      tenant_id,
    }
  }

  async function load(tenant_id: string, channel: ProfileChannel): Promise<ProfileDoc | null> {
    return col.findOne({ tenant_id, channel })
  }

  app.get('/marketing/profiles', { preHandler: readGate }, async (req) => {
    const { tenant_id } = req.authContext
    const docs = await col.find({ tenant_id }).toArray()
    const by = new Map(docs.map((d) => [d.channel, d]))
    return { profiles: PROFILE_CHANNELS.map((c) => view(tenant_id, c, by.get(c) ?? null)) }
  })

  app.put<{ Params: { channel: string } }>(
    '/marketing/profiles/:channel',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const channel = req.params.channel
      if (!isProfileChannel(channel)) return reply.status(404).send({ error: 'unknown_channel' })
      const parsed = DesiredSchema.safeParse(req.body)
      if (!parsed.success)
        return reply.status(400).send({ error: 'Invalid profile', issues: parsed.error.issues })
      const desired: DesiredProfile = parsed.data
      const v = validateDesired(channel, desired)
      if (!v.ok)
        return reply.status(422).send({ error: 'profile_text_rejected', problems: v.problems })

      const existing = await load(tenant_id, channel)
      const drift = existing?.actual ? computeDrift(desired, existing.actual) : []
      const now = new Date()
      await col.updateOne(
        { tenant_id, channel },
        {
          $set: { desired, drift, updated_by: user_id, updated_at: now },
          $setOnInsert: { tenant_id, channel, checklist: {} },
        },
        { upsert: true },
      )
      getAuditLogger()?.fromRequest(req, 'marketing.profile_edit', 'channel_profile', channel, {
        channel,
      })
      return view(tenant_id, channel, await load(tenant_id, channel))
    },
  )

  app.put<{ Params: { channel: string } }>(
    '/marketing/profiles/:channel/checklist',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const channel = req.params.channel
      if (!isProfileChannel(channel)) return reply.status(404).send({ error: 'unknown_channel' })
      const parsed = z.object({ item: z.string(), done: z.boolean() }).safeParse(req.body)
      if (!parsed.success || !CHECKLIST_ITEMS[channel].includes(parsed.data.item))
        return reply.status(400).send({ error: 'unknown_checklist_item' })
      await col.updateOne(
        { tenant_id, channel },
        {
          $set: {
            [`checklist.${parsed.data.item}`]: parsed.data.done,
            updated_by: user_id,
            updated_at: new Date(),
          },
          $setOnInsert: { tenant_id, channel, desired: DEFAULT_PROFILES[channel], drift: [] },
        },
        { upsert: true },
      )
      return view(tenant_id, channel, await load(tenant_id, channel))
    },
  )

  app.post<{ Params: { channel: string } }>(
    '/marketing/profiles/:channel/check',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const channel = req.params.channel
      if (!isProfileChannel(channel)) return reply.status(404).send({ error: 'unknown_channel' })
      if (!SUPPORTS_CHECK.has(channel))
        return reply.status(400).send({
          error: 'manual_channel',
          message: `${channel} cannot be read by the console; use the checklist`,
        })
      const doc = await load(tenant_id, channel)
      const desired = doc?.desired ?? DEFAULT_PROFILES[channel]
      let actual: NonNullable<ProfileDoc['actual']>
      try {
        actual = await read(desired.handle)
      } catch (err) {
        return reply
          .status(502)
          .send({ error: 'profile_read_failed', message: String(err).slice(0, 200) })
      }
      await col.updateOne(
        { tenant_id, channel },
        {
          $set: {
            actual,
            drift: computeDrift(desired, actual),
            updated_by: user_id,
            updated_at: new Date(),
          },
          $setOnInsert: { tenant_id, channel, desired, checklist: {} },
        },
        { upsert: true },
      )
      return view(tenant_id, channel, await load(tenant_id, channel))
    },
  )

  app.post<{ Params: { channel: string } }>(
    '/marketing/profiles/:channel/apply',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const channel = req.params.channel
      if (!isProfileChannel(channel)) return reply.status(404).send({ error: 'unknown_channel' })
      if (!SUPPORTS_APPLY.has(channel))
        return reply
          .status(400)
          .send({ error: 'manual_channel', message: `${channel} must be updated by hand` })
      const parsed = z.object({ expected_hash: z.string() }).safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'expected_hash_required' })

      const doc = await load(tenant_id, channel)
      const desired = doc?.desired ?? DEFAULT_PROFILES[channel]
      if (parsed.data.expected_hash !== desiredHash(desired))
        return reply.status(409).send({
          error: 'profile_text_changed',
          message: 'The text changed since you reviewed it. Review it again.',
        })
      const v = validateDesired(channel, desired)
      if (!v.ok) return reply.status(422).send({ error: 'copy_guard_failed', problems: v.problems })
      if ((await getPlatformConfig(db)).marketing_paused)
        return reply.status(409).send({ error: 'marketing_paused' })

      const dryRun = (await getAutomation(db, tenant_id)).dry_run_mode === true
      if (!dryRun) {
        const conn = await connections.findOne({ tenant_id, channel, status: 'active' })
        if (!conn) return reply.status(409).send({ error: 'channel_not_connected' })
        try {
          await apply(db, conn, desired)
        } catch (err) {
          getAuditLogger()?.fromRequest(
            req,
            'marketing.profile_apply',
            'channel_profile',
            channel,
            { channel, outcome: 'failed' },
          )
          return reply
            .status(502)
            .send({ error: 'profile_apply_failed', message: String(err).slice(0, 200) })
        }
      }
      const now = new Date()
      await col.updateOne(
        { tenant_id, channel },
        {
          $set: { applied_at: now, applied_by: user_id, updated_by: user_id, updated_at: now },
          $setOnInsert: { tenant_id, channel, desired, checklist: {}, drift: [] },
        },
        { upsert: true },
      )
      getAuditLogger()?.fromRequest(req, 'marketing.profile_apply', 'channel_profile', channel, {
        channel,
        dry_run: dryRun,
      })
      return { ...view(tenant_id, channel, await load(tenant_id, channel)), dry_run: dryRun }
    },
  )
}
