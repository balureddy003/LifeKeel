/**
 * SkillOptimizerQuota — Quota enforcement for skill optimization runs.
 * 
 * Prevents runaway LLM costs from unlimited optimization runs by enforcing:
 * - Per-detector daily limits
 * - Per-tenant daily limits  
 * - Minimum approval thresholds between runs
 */

import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'skill-optimizer-quota', version: '0.0.0' })

export interface SkillOptimizerQuotaConfig {
  max_runs_per_detector_per_day: number   // default: 1
  max_runs_per_tenant_per_day: number     // default: 5
  min_approvals_since_last_run: number    // default: 10
}

export const DEFAULT_QUOTA: SkillOptimizerQuotaConfig = {
  max_runs_per_detector_per_day: 1,
  max_runs_per_tenant_per_day: 5,
  min_approvals_since_last_run: 10,
}

export type QuotaCheckResult =
  | { allowed: true }
  | { allowed: false; reason: 'tenant_daily_limit' | 'detector_daily_limit' | 'insufficient_approvals'; detail: string }

export async function checkSkillOptimizerQuota(
  db: Db,
  tenantId: string,
  detectorId: string,
  config: SkillOptimizerQuotaConfig = DEFAULT_QUOTA,
): Promise<QuotaCheckResult> {
  try {
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Query skill_opt_history for runs today for this tenant (tenant daily count)
    const tenantRunsToday = await db.collection('skill_opt_history').countDocuments({
      tenant_id: tenantId,
      completed_at: { $gte: startOfDay },
    })

    if (tenantRunsToday >= config.max_runs_per_tenant_per_day) {
      log.warn({ tenant_id: tenantId, count: tenantRunsToday, limit: config.max_runs_per_tenant_per_day }, 'SkillOptimizer tenant daily limit exceeded')
      return {
        allowed: false,
        reason: 'tenant_daily_limit',
        detail: `Tenant has used ${tenantRunsToday}/${config.max_runs_per_tenant_per_day} daily optimization runs`,
      }
    }

    // Query skill_opt_history for runs today for this detector (detector daily count)
    const detectorRunsToday = await db.collection('skill_opt_history').countDocuments({
      tenant_id: tenantId,
      detector_id: detectorId,
      completed_at: { $gte: startOfDay },
    })

    if (detectorRunsToday >= config.max_runs_per_detector_per_day) {
      log.warn({ tenant_id: tenantId, detector_id: detectorId, count: detectorRunsToday, limit: config.max_runs_per_detector_per_day }, 'SkillOptimizer detector daily limit exceeded')
      return {
        allowed: false,
        reason: 'detector_daily_limit',
        detail: `Detector has used ${detectorRunsToday}/${config.max_runs_per_detector_per_day} daily optimization runs`,
      }
    }

    // Check for minimum approvals since last run
    const lastRun = await db.collection('skill_opt_history').findOne(
      { tenant_id: tenantId, detector_id: detectorId },
      { sort: { completed_at: -1 } },
    )

    if (lastRun) {
      const lastRunTime = lastRun['completed_at'] as Date
      // Count approvals since last run
      const approvalsSinceLastRun = await db.collection('insights').countDocuments({
        tenant_id: tenantId,
        detector_id: detectorId,
        approved_at: { $gte: lastRunTime },
      })

      if (approvalsSinceLastRun < config.min_approvals_since_last_run) {
        log.warn({ tenant_id: tenantId, detector_id: detectorId, count: approvalsSinceLastRun, required: config.min_approvals_since_last_run }, 'SkillOptimizer insufficient approvals since last run')
        return {
          allowed: false,
          reason: 'insufficient_approvals',
          detail: `Only ${approvalsSinceLastRun}/${config.min_approvals_since_last_run} required approvals since last optimization run`,
        }
      }
    }

    return { allowed: true }
  } catch (error) {
    log.error({ error, tenant_id: tenantId, detector_id: detectorId }, 'SkillOptimizer quota check failed')
    // Fail open: allow the run if quota check fails, to avoid blocking legitimate operations
    return { allowed: true }
  }
}
