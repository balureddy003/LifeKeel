/**
 * /settings/automation — the Act-layer trust controls (remediation item 25).
 *
 * The fields this reads and writes — tenant_settings.automation.dry_run_mode
 * and .trust_level_by_workflow — already existed and are already honored by
 * POST /insights/:id/approve (dry_run_mode) and the approve handler's
 * per-workflow trust counter, but the only surface that ever exposed them
 * was an unregistered route file (since deleted), so no shipped client could
 * reach them. These are the live endpoints the settings screen talks to.
 *
 * Deliberately narrow: the only writable field is dry_run_mode. Trust levels
 * are earned state (incremented by real approvals, capped at 5) — a PATCH
 * that let a client set them directly would make "Oak has earned enough
 * trust to auto-run" a UI flag instead of a record of actual behavior, so
 * they're read-only here.
 *
 * Authorization: '/settings/*' maps to the 'settings' resource in
 * server.ts's authorizationResource — GET is 'read' (any signed-in role),
 * PATCH is 'update' (admin+ only, see packages/platform abilities.ts).
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getAuditLogger } from '../audit/audit-log.js'

interface AutomationDoc {
  dry_run_mode?: boolean
  trust_level_by_workflow?: Record<string, number>
}

export function registerAutomationSettingsRoutes(app: FastifyInstance, db: Db): void {
  const col = db.collection('tenant_settings')

  app.get('/settings/automation', async (request) => {
    const { tenant_id } = request.authContext
    const doc = await col.findOne({ tenant_id })
    const automation = (doc?.['automation'] as AutomationDoc | undefined) ?? {}
    return {
      dry_run_mode: automation.dry_run_mode === true,
      trust_level_by_workflow: automation.trust_level_by_workflow ?? {},
    }
  })

  app.patch<{ Body: { dry_run_mode?: boolean } }>(
    '/settings/automation',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { dry_run_mode } = request.body ?? {}
      if (typeof dry_run_mode !== 'boolean') {
        return reply.status(400).send({ error: 'dry_run_mode must be a boolean' })
      }

      await col.updateOne(
        { tenant_id },
        {
          $set: { 'automation.dry_run_mode': dry_run_mode, updated_at: new Date() },
          $setOnInsert: { tenant_id, created_at: new Date() },
        },
        { upsert: true },
      )

      getAuditLogger()?.fromRequest(request, 'settings.update', 'settings', 'automation', {
        dry_run_mode,
      })

      const doc = await col.findOne({ tenant_id })
      const automation = (doc?.['automation'] as AutomationDoc | undefined) ?? {}
      return {
        dry_run_mode: automation.dry_run_mode === true,
        trust_level_by_workflow: automation.trust_level_by_workflow ?? {},
      }
    },
  )
}
