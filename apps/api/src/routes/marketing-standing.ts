/**
 * /marketing/standing — standing approvals (step 2).
 *
 *   GET  /marketing/standing                    the policy, bank counts, upcoming posts, paused networks
 *   PUT  /marketing/standing                    enable or renew (reason and expiry required, max 30 days)
 *   POST /marketing/standing/disable            revoke now; unsent standing posts are rejected
 *   POST /marketing/standing/channels/:c/resume resume a network a breaker paused
 *   POST /marketing/standing/run                run the breakers and scheduler for this tenant now
 *
 * Enabling is a human decision on limits, recorded with who, why and until when. It is not an autopilot
 * rule and cannot be turned on by one. Publishing still goes through the existing approved-post path.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { requireOperator } from '../operator/operator-auth.js'
import {
  ensurePolicyIndexes,
  enableStanding,
  POLICY_MAX_DAYS,
  resumeChannel,
  revokeStanding,
  runBreakers,
  scheduleStanding,
  standingStatus,
  type ScheduleDeps,
} from '../marketing/standing.js'

const CHANNELS = ['x', 'bluesky', 'threads', 'linkedin', 'instagram', 'facebook'] as const

const PolicySchema = z.object({
  reason: z.string().trim().min(3).max(300),
  expires_in_days: z.number().int().min(1).max(POLICY_MAX_DAYS),
  channels: z.array(z.enum(CHANNELS)).min(1).max(6),
  max_per_channel_per_week: z.number().int().min(1).max(7).optional(),
  max_per_channel_per_day: z.number().int().min(1).max(2).optional(),
  min_gap_hours: z.number().int().min(1).max(72).optional(),
  repeat_cooldown_days: z.number().int().min(7).max(180).optional(),
  hours: z.array(z.number().int().min(0).max(23)).min(1).max(6).optional(),
})

export interface MarketingStandingOptions {
  operatorTenants?: string[]
  now?: () => Date
  deps?: ScheduleDeps
}

export function registerMarketingStandingRoutes(
  app: FastifyInstance,
  db: Db,
  opts?: MarketingStandingOptions,
): void {
  ensurePolicyIndexes(db)
  const now = () => opts?.now?.() ?? new Date()

  const testGate = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!new Set(opts?.operatorTenants ?? []).has(req.authContext.tenant_id))
      await reply.status(403).send({ error: 'Forbidden: not an operator tenant' })
  }
  const readGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.read')
  const manageGate = opts?.operatorTenants ? testGate : requireOperator(db, 'marketing.manage')

  app.get('/marketing/standing', { preHandler: readGate }, async (req) =>
    standingStatus(db, req.authContext.tenant_id, now()),
  )

  app.put('/marketing/standing', { preHandler: manageGate }, async (req, reply) => {
    const parsed = PolicySchema.safeParse(req.body)
    if (!parsed.success)
      return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
    const { tenant_id, user_id } = req.authContext
    const policy = await enableStanding(db, tenant_id, user_id, parsed.data, now())
    return { policy }
  })

  app.post('/marketing/standing/disable', { preHandler: manageGate }, async (req, reply) => {
    const parsed = z.object({ reason: z.string().trim().min(3).max(300) }).safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'reason_required' })
    const { tenant_id, user_id } = req.authContext
    return revokeStanding(db, tenant_id, user_id, parsed.data.reason, now())
  })

  app.post<{ Params: { channel: string } }>(
    '/marketing/standing/channels/:channel/resume',
    { preHandler: manageGate },
    async (req, reply) => {
      const { tenant_id, user_id } = req.authContext
      const ok = await resumeChannel(db, tenant_id, user_id, req.params.channel, now())
      if (!ok) return reply.status(404).send({ error: 'channel_not_paused' })
      return { ok: true }
    },
  )

  app.post('/marketing/standing/run', { preHandler: manageGate }, async (req) => {
    const { tenant_id } = req.authContext
    const breakers = await runBreakers(db, now(), tenant_id)
    const scheduled = await scheduleStanding(db, now(), opts?.deps ?? {}, tenant_id)
    return { breakers, ...scheduled }
  })
}
