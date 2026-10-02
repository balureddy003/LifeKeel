/**
 * auto-execute-trusted — the spend side of trust_level_by_workflow.
 *
 * The trust counter is earned per workflow scope (workflow_id, or
 * detector_id for detector-produced insights) each time a human approves
 * one of that scope's insights. Once a scope reaches TRUST_THRESHOLD the
 * family has demonstrated — repeatedly, through real decisions — that
 * this kind of insight's recommendations are always right for them. This
 * worker converts that earned trust into Tier 3 autonomy: open insights
 * in a trusted scope are approved and executed automatically.
 *
 * The gate is deliberately narrow — ALL of these must hold:
 *
 *  - Tenant opted in: automation.auto_execute_enabled === true
 *    (off by default — autonomy is never assumed).
 *  - The insight's scope has TRUST_THRESHOLD earned approvals.
 *  - Every action on the insight classifies as non-external (log_only):
 *    previewActions is the same classifier the approval-gate UI and the
 *    executor share, so "auto" can never send an email, a WhatsApp
 *    message, or a CRM write — those stay human-gated forever.
 *  - The insight has been open for at least AUTO_EXECUTE_GRACE_MS —
 *    the notification went out at creation; this window lets a human
 *    dismiss first. A human decision always beats the machine's.
 *  - The monthly approval quota still applies — autonomy cannot exceed
 *    the plan's envelope.
 *  - dry_run_mode is honored: a simulating tenant's auto-executions
 *    simulate too.
 *
 * Reuses the approve path's propose→commit shape: an atomic claim to
 * 'approved' first (survives a crash before dispatch), then the real
 * outcome ('completed'/'execution_failed'/still-'approved' while a
 * pending claim is in flight) written back after execution.
 */
import type { Db } from 'mongodb'
import { FreeTierPolicy, createLogger } from '@agentoak/platform'
import { ActionExecutor, previewActions } from '../actions/action-executor.js'
import type { ActionReceipt } from '@agentoak/workflows'
import { getAuditLogger } from '../audit/audit-log.js'
import { randomUUID, createHash } from 'node:crypto'

const log = createLogger({ service: 'auto-execute-trusted', version: '0.0.0' })

export const AUTO_EXECUTE_TRUST_THRESHOLD = 5
export const AUTO_EXECUTE_GRACE_MS = 60 * 60 * 1000

export interface AutoExecuteSummary {
  tenants_scanned: number
  executed: number
  failed: number
  skipped: number
}

export async function runAutoExecuteTrusted(
  db: Db,
  opts: { now?: Date; limitPerTenant?: number } = {},
): Promise<AutoExecuteSummary> {
  const now = opts.now ?? new Date()
  const limit = opts.limitPerTenant ?? 20
  const graceBefore = new Date(now.getTime() - AUTO_EXECUTE_GRACE_MS)
  const summary: AutoExecuteSummary = { tenants_scanned: 0, executed: 0, failed: 0, skipped: 0 }

  const tenants = await db.collection('tenant_settings')
    .find({ 'automation.auto_execute_enabled': true })
    .project({ tenant_id: 1, automation: 1 })
    .toArray()

  const executor = new ActionExecutor(db)
  const insightsCol = db.collection('insights')
  const receiptsCol = db.collection('action_receipts')

  for (const settingsDoc of tenants) {
    const tenantId = settingsDoc['tenant_id'] as string
    const automation = (settingsDoc['automation'] ?? {}) as Record<string, unknown>
    const trustMap = (automation['trust_level_by_workflow'] ?? {}) as Record<string, number>
    const trustedScopes = Object.entries(trustMap)
      .filter(([, level]) => level >= AUTO_EXECUTE_TRUST_THRESHOLD)
      .map(([scope]) => scope)
    if (trustedScopes.length === 0) continue
    summary.tenants_scanned++

    const tenantDryRun = automation['dry_run_mode'] === true

    // Quota gate — auto-approvals draw from the same monthly envelope as
    // human ones. Over quota → leave everything for the human.
    const tenant = await db.collection('tenants').findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] })
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const used = await insightsCol.countDocuments({ tenant_id: tenantId, approved_at: { $gte: monthStart } })
    // `plan` is the field billing maintains on the tenant — `tier` is a
    // kairos-era field name nothing writes, so reading it capped paid
    // tenants at the free-tier limit.
    const quota = new FreeTierPolicy().check('monthly_move_approvals', used, String(tenant?.['plan'] ?? 'free'))
    if (!quota.allowed) {
      summary.skipped++
      continue
    }

    const candidates = await insightsCol.find({
      tenant_id: tenantId,
      state: { $in: ['identified', 'sent'] },
      created_at: { $lte: graceBefore },
      $or: [{ workflow_id: { $in: trustedScopes } }, { detector_id: { $in: trustedScopes } }],
    }).sort({ created_at: 1 }).limit(limit).toArray()

    for (const insight of candidates) {
      const actions = Array.isArray(insight['actions']) ? insight['actions'] as string[] : []
      const intents = Array.isArray(insight['action_intents'])
        ? insight['action_intents'] as { type: 'send_email' | 'send_whatsapp' | 'crm_tag' | 'log_only'; label: string; params?: Record<string, unknown> }[]
        : undefined
      // Non-external only — one send_email/whatsapp/crm_tag anywhere on
      // the insight keeps it human-gated regardless of trust level.
      // PRD-116: declared action_intents count here too — a detector that
      // declares send_email must never auto-execute, period.
      if (!previewActions(actions, intents).every((a) => !a.external)) {
        summary.skipped++
        continue
      }

      // Atomic claim — a concurrent human approve/dismiss or a second
      // replica loses the race and owns the decision instead.
      const claimed = await insightsCol.findOneAndUpdate(
        { id: insight['id'], tenant_id: tenantId, state: { $in: ['identified', 'sent'] } },
        { $set: { state: 'approved', approved_at: new Date(), approved_by: 'auto-trust', auto_executed: true } },
        { returnDocument: 'after' },
      )
      if (!claimed) {
        summary.skipped++
        continue
      }

      const execution = await executor.execute(claimed as never, tenantId, {
        dryRun: tenantDryRun,
        approvedBy: 'auto-trust',
      }).catch((err) => {
        log.warn({ err, insight_id: insight['id'], tenant_id: tenantId }, 'Auto-execute dispatch failed')
        return null
      })

      const executionFailed = execution === null
        || execution.receipts.some((r) => r.outcome === 'execution_failed' || r.outcome === 'execution_ambiguous')
      const executionPending = execution !== null
        && execution.receipts.some((r) => r.outcome === 'pending')
      await insightsCol.updateOne(
        { id: insight['id'], tenant_id: tenantId, state: 'approved' },
        { $set: { state: executionFailed ? 'execution_failed' : executionPending ? 'approved' : 'completed' } },
      )

      // Same decision-receipt shape the human approve path writes —
      // outcome 'policy_blocked' under dry_run, matching its convention.
      // learning_suppressed: an auto-execution is NOT a human approval
      // signal — feeding it back would let trust compound on its own
      // decisions. Distinct action_type keeps it queryable.
      await receiptsCol.insertOne({
        id: randomUUID(),
        tenant_id: tenantId,
        insight_id: insight['id'] as string,
        detector_id: insight['detector_id'] as string | undefined,
        action_type: 'insight.auto_execute',
        outcome: tenantDryRun ? 'policy_blocked' : 'approved',
        outcome_reason: tenantDryRun ? 'dry_run_mode' : undefined,
        executed_at: new Date(),
        approved_by: 'auto-trust',
        payload_hash: createHash('sha256').update(JSON.stringify({ id: insight['id'], auto: true })).digest('hex'),
        dry_run: tenantDryRun,
        learning_suppressed: true,
      } satisfies Partial<ActionReceipt> as ActionReceipt).catch((err) => {
        // Unique (tenant_id, insight_id, payload_hash) — a second receipt
        // for the same insight must not kill the worker loop.
        log.warn({ err, insight_id: insight['id'] }, 'Auto-execute decision receipt insert failed')
      })

      getAuditLogger()?.log({
        tenant_id: tenantId,
        user_id: 'auto-trust',
        action: 'insight.auto_execute',
        resource_type: 'insight',
        resource_id: insight['id'] as string,
        metadata: { detector_id: insight['detector_id'], trust_scope: insight['workflow_id'] ?? insight['detector_id'] },
        ip: '',
        user_agent: '',
        timestamp: new Date(),
      })
      await db.collection('system_events').insertOne({
        tenant_id: tenantId,
        type: 'insight.auto_executed',
        insight_id: insight['id'],
        detector_id: insight['detector_id'],
        created_at: new Date(),
      })

      if (executionFailed) summary.failed++
      else summary.executed++
      log.info({ insight_id: insight['id'], tenant_id: tenantId, dry_run: tenantDryRun }, 'Auto-executed trusted insight')
    }
  }

  return summary
}
