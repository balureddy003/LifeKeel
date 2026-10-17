/**
 * Preference center (PRD-136 §5) — the tenant-level delivery preferences
 * behind the heartbeat and per-insight delivery. All adults can read them;
 * only the organizer edits (per-member cadence is a noted follow-up — the
 * prefs doc is tenant-scoped today).
 *
 *   GET   /family/notifications — adult: prefs with defaults applied +
 *                                 the criticals no setting can silence.
 *   PATCH /family/notifications — organizer: channels order, quiet hours,
 *                                 digest/urgency floor, heartbeat fields.
 *
 * Tier 0 bookkeeping — these prefs shape what Keel sends; nothing here
 * sends anything itself.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { isFamilyAdult, isFamilyOrganizer } from '../lib/family-permissions.js'
import type { Channel, DeliveryPreferences } from '../delivery/delivery-router.js'

const CHANNELS = ['whatsapp', 'sms', 'email', 'web_push', 'mobile_push'] as const
const URGENCIES = ['critical', 'high', 'medium', 'low'] as const
const DOMAINS = ['emergency_fund', 'protection', 'retirement', 'education', 'estate'] as const

/** Critical alerts no preference can silence — shown read-only in the UI. */
const EXEMPT_CRITICALS = ['renewal_within_7_days', 'continuity_check_in', 'emergency_vault_awareness'] as const

const PatchBody = z.object({
  channels: z.array(z.enum(CHANNELS)).optional(),
  quiet_hours_start: z.number().int().min(0).max(23).nullable().optional(),
  quiet_hours_end: z.number().int().min(0).max(23).nullable().optional(),
  digest_mode: z.boolean().optional(),
  min_urgency: z.enum(URGENCIES).optional(),
  heartbeat_cadence: z.enum(['weekly', 'monthly', 'off']).optional(),
  heartbeat_quiet_weeks: z.boolean().optional(),
  domains_muted: z.array(z.enum(DOMAINS)).optional(),
  member_scope: z.enum(['all', 'mine']).optional(),
})

function withDefaults(prefs: Partial<DeliveryPreferences> | null) {
  return {
    channels: prefs?.channels ?? ['web_push', 'email'],
    whatsapp_to: prefs?.whatsapp_to ?? null,
    sms_to: prefs?.sms_to ?? null,
    email_to: prefs?.email_to ?? null,
    web_push_enabled: prefs?.web_push_enabled ?? false,
    mobile_push_enabled: prefs?.mobile_push_enabled ?? false,
    min_urgency: prefs?.min_urgency ?? 'low',
    business_name: prefs?.business_name ?? 'LifeKeel',
    quiet_hours_start: prefs?.quiet_hours_start ?? null,
    quiet_hours_end: prefs?.quiet_hours_end ?? null,
    digest_mode: prefs?.digest_mode ?? false,
    enabled: prefs?.enabled ?? true,
    heartbeat_cadence: prefs?.heartbeat_cadence ?? 'weekly',
    heartbeat_quiet_weeks: prefs?.heartbeat_quiet_weeks ?? false,
    domains_muted: prefs?.domains_muted ?? [],
    member_scope: prefs?.member_scope ?? 'all',
  }
}

export function registerFamilyNotificationRoutes(app: FastifyInstance, db: Db): void {
  const prefsCol = () => db.collection('delivery_preferences')

  app.get('/family/notifications', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Notification settings are visible to adult family members only.' })
    }
    const prefs = (await prefsCol().findOne({ tenant_id })) as DeliveryPreferences | null
    return { preferences: withDefaults(prefs), exempt_criticals: [...EXEMPT_CRITICALS] }
  })

  app.patch('/family/notifications', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Notification settings are visible to adult family members only.' })
    }
    if (!(await isFamilyOrganizer(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only the organizer can change notification settings.' })
    }
    const parsed = PatchBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid notification preferences', issues: parsed.error.issues })

    const $set: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) $set[k] = v
    }
    if (Object.keys($set).length === 0) return reply.status(400).send({ error: 'Nothing to update' })
    await prefsCol().updateOne(
      { tenant_id },
      { $set, $setOnInsert: { tenant_id, enabled: true } },
      { upsert: true },
    )
    const saved = (await prefsCol().findOne({ tenant_id })) as DeliveryPreferences | null
    return { preferences: withDefaults(saved), exempt_criticals: [...EXEMPT_CRITICALS] }
  })
}
