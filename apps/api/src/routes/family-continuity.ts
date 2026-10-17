/**
 * Continuity settings routes (PRD-130).
 *
 * GET   /family/continuity — the family's continuity config + state.
 * PATCH /family/continuity — organizer-only: enable/disable, pick
 *                            designated contacts, tune thresholds.
 *
 * Designated contacts are roster members — only active adults are ever
 * notified (the job re-checks at send time, so a member later removed or
 * demoted to child can't inherit an alert). Enabling the switch is
 * itself audited.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getTenantCollection } from '@lifekeel/platform'
import { isFamilyOrganizer } from '../lib/family-permissions.js'
import { getFamilyContinuityStateCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { DEFAULT_CHECK_IN_DAYS, DEFAULT_GRACE_DAYS } from '../jobs/continuity-check.js'
import type { FamilyGroupDoc } from './family-group.js'

const PatchBody = z.object({
  enabled: z.boolean(),
  designated_member_ids: z.array(z.string().min(1)).max(10).default([]),
  check_in_after_days: z.number().int().min(7).max(365).default(DEFAULT_CHECK_IN_DAYS),
  grace_days: z.number().int().min(1).max(90).default(DEFAULT_GRACE_DAYS),
})

export function registerFamilyContinuityRoutes(app: FastifyInstance, db: Db): void {
  const groupsFor = (tenantId: string) => getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId)

  app.get('/family/continuity', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const group = await groupsFor(tenant_id).findOne({})
    if (!group) return reply.status(404).send({ error: 'No family group' })
    const state = await getFamilyContinuityStateCollection(db).findOne({ tenant_id })
    return {
      continuity: group.continuity ?? {
        enabled: false,
        designated_member_ids: [],
        check_in_after_days: DEFAULT_CHECK_IN_DAYS,
        grace_days: DEFAULT_GRACE_DAYS,
      },
      state: state
        ? { phase: state['phase'], inactive_since: state['inactive_since'], check_in_sent_at: state['check_in_sent_at'], alerted_at: state['alerted_at'] }
        : { phase: 'watching' },
      is_organizer: await isFamilyOrganizer(db, tenant_id, user_id),
    }
  })

  app.patch('/family/continuity', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyOrganizer(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only the family organizer can change continuity settings' })
    }
    const parsed = PatchBody.safeParse(req.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid continuity settings', details: parsed.error.issues })

    const group = await groupsFor(tenant_id).findOne({})
    if (!group) return reply.status(404).send({ error: 'No family group' })

    // Designated contacts must be real roster members — and only members
    // who could plausibly receive an alert (active, adult, has email).
    // Pending members and children are rejected now rather than silently
    // skipped at send time, so the organizer sees the truth immediately.
    const eligible = new Set(group.members.filter((m) => m.status === 'active' && m.role !== 'child' && m.email).map((m) => m.id))
    const invalid = parsed.data.designated_member_ids.filter((id) => !eligible.has(id))
    if (invalid.length > 0) {
      return reply.status(400).send({ error: 'Designated contacts must be active adult members with an email on file', invalid_member_ids: invalid })
    }

    await groupsFor(tenant_id).updateOne(
      {},
      { $set: { continuity: parsed.data, updated_at: new Date() } },
    )

    getAuditLogger()?.log({
      tenant_id,
      user_id,
      action: 'family.continuity_updated',
      resource_type: 'family',
      resource_id: group.id,
      metadata: { enabled: parsed.data.enabled, designated_member_ids: parsed.data.designated_member_ids, check_in_after_days: parsed.data.check_in_after_days, grace_days: parsed.data.grace_days },
      ip: req.ip,
      user_agent: req.headers['user-agent'] ?? '',
      timestamp: new Date(),
    })

    return { continuity: parsed.data }
  })
}
