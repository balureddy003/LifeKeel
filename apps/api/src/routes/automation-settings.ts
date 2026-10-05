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
 * Writable fields:
 *  - dry_run_mode — approving an insight records the decision without
 *    dispatching anything.
 *  - renewal_reminders_enabled — the Tier 3 opt-IN for policy-renewal
 *    reminders (jobs/policy-renewal-reminders.ts). Default off: autonomy
 *    is never assumed — a member must explicitly enable it here before
 *    Keel schedules or sends anything on the family's behalf. The send
 *    path re-checks this flag at execution time, so disabling takes
 *    effect immediately for already-scheduled reminders.
 *  - renewal_reminder_lead_days — how many days before a renewal to notify
 *    (default [30, 7]; 1–365, max 5 entries).
 *  - auto_execute_enabled — the Tier 3 opt-IN for acting on trusted
 *    insight scopes without a tap (jobs/auto-execute-trusted.ts). Only
 *    scopes that have reached the earned-trust threshold qualify, and
 *    only insights whose actions are ALL log_only (no external side
 *    effects — sends, CRM writes and anything money-adjacent stay
 *    human-gated forever regardless of this flag).
 *
 * Trust levels are earned state (incremented by real approvals, capped at
 * 5) — a PATCH that let a client set them directly would make "Keel has
 * earned enough trust to auto-run" a UI flag instead of a record of actual
 * behavior, so they're read-only here.
 *
 * Authorization: '/settings/*' maps to the 'settings' resource in
 * server.ts's authorizationResource — GET is 'read' (any signed-in role),
 * PATCH is 'update' (admin+ only, see packages/platform abilities.ts).
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getAuditLogger } from '../audit/audit-log.js'
import { DEFAULT_LEAD_DAYS } from '../jobs/policy-renewal-reminders.js'

interface AutomationDoc {
  dry_run_mode?: boolean
  trust_level_by_workflow?: Record<string, number>
  renewal_reminders_enabled?: boolean
  renewal_reminder_lead_days?: number[]
  auto_execute_enabled?: boolean
  daily_marketing_drafts_enabled?: boolean
}

function toResponse(automation: AutomationDoc) {
  return {
    dry_run_mode: automation.dry_run_mode === true,
    trust_level_by_workflow: automation.trust_level_by_workflow ?? {},
    renewal_reminders_enabled: automation.renewal_reminders_enabled === true,
    renewal_reminder_lead_days: automation.renewal_reminder_lead_days ?? DEFAULT_LEAD_DAYS,
    auto_execute_enabled: automation.auto_execute_enabled === true,
    daily_marketing_drafts_enabled: automation.daily_marketing_drafts_enabled === true,
  }
}

function isValidLeadDays(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length >= 1
    && value.length <= 5
    && value.every((d) => Number.isInteger(d) && d >= 1 && d <= 365)
}

export function registerAutomationSettingsRoutes(app: FastifyInstance, db: Db): void {
  const col = db.collection('tenant_settings')

  app.get('/settings/automation', async (request) => {
    const { tenant_id } = request.authContext
    const doc = await col.findOne({ tenant_id })
    return toResponse((doc?.['automation'] as AutomationDoc | undefined) ?? {})
  })

  app.patch<{
    Body: {
      dry_run_mode?: boolean
      renewal_reminders_enabled?: boolean
      renewal_reminder_lead_days?: number[]
      auto_execute_enabled?: boolean
      daily_marketing_drafts_enabled?: boolean
    }
  }>(
    '/settings/automation',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { dry_run_mode, renewal_reminders_enabled, renewal_reminder_lead_days, auto_execute_enabled, daily_marketing_drafts_enabled } = request.body ?? {}

      const set: Record<string, unknown> = {}
      if (dry_run_mode !== undefined) {
        if (typeof dry_run_mode !== 'boolean') {
          return reply.status(400).send({ error: 'dry_run_mode must be a boolean' })
        }
        set['automation.dry_run_mode'] = dry_run_mode
      }
      if (renewal_reminders_enabled !== undefined) {
        if (typeof renewal_reminders_enabled !== 'boolean') {
          return reply.status(400).send({ error: 'renewal_reminders_enabled must be a boolean' })
        }
        set['automation.renewal_reminders_enabled'] = renewal_reminders_enabled
      }
      if (renewal_reminder_lead_days !== undefined) {
        if (!isValidLeadDays(renewal_reminder_lead_days)) {
          return reply.status(400).send({ error: 'renewal_reminder_lead_days must be 1–5 integers between 1 and 365' })
        }
        set['automation.renewal_reminder_lead_days'] = renewal_reminder_lead_days
      }
      if (auto_execute_enabled !== undefined) {
        if (typeof auto_execute_enabled !== 'boolean') {
          return reply.status(400).send({ error: 'auto_execute_enabled must be a boolean' })
        }
        set['automation.auto_execute_enabled'] = auto_execute_enabled
      }
      if (daily_marketing_drafts_enabled !== undefined) {
        if (typeof daily_marketing_drafts_enabled !== 'boolean') {
          return reply.status(400).send({ error: 'daily_marketing_drafts_enabled must be a boolean' })
        }
        set['automation.daily_marketing_drafts_enabled'] = daily_marketing_drafts_enabled
      }
      if (Object.keys(set).length === 0) {
        return reply.status(400).send({ error: 'Provide at least one of: dry_run_mode, renewal_reminders_enabled, renewal_reminder_lead_days, auto_execute_enabled, daily_marketing_drafts_enabled' })
      }

      await col.updateOne(
        { tenant_id },
        {
          $set: { ...set, updated_at: new Date() },
          $setOnInsert: { tenant_id, created_at: new Date() },
        },
        { upsert: true },
      )

      getAuditLogger()?.fromRequest(request, 'settings.update', 'settings', 'automation', {
        ...set,
      })

      const doc = await col.findOne({ tenant_id })
      return toResponse((doc?.['automation'] as AutomationDoc | undefined) ?? {})
    },
  )
}
