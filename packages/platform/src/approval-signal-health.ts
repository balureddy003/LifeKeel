/**
 * ApprovalSignalHealthMonitor — detect bad approval patterns
 * 
 * The four learning loops all use approval/dismissal signals as their training signal.
 * If a user rapidly approves everything, approves in a suspicious batch, or suddenly
 * dismisses everything, the learning loops will be poisoned. This monitor detects those patterns.
 */

import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'approval-signal-health', version: '0.0.0' })

export interface ApprovalSignalHealthScore {
  score: number          // 0–1; < 0.6 = pause learning
  flags: ApprovalFlag[]
  computed_at: Date
}

export type ApprovalFlag =
  | 'rapid_fire'          // > 10 approvals in 60 seconds
  | 'batch_approval'      // > 15 approvals in 5 minutes
  | 'dismiss_spike'       // dismiss rate > 90% in last hour (baseline was < 40%)
  | 'no_variance'         // all decisions identical for > 20 consecutive insights
  | 'connector_resync'    // large event batch detected (> 30 events in 2 mins)

export class ApprovalSignalHealthMonitor {
  constructor(private readonly db: Db) {}

  async compute(tenantId: string): Promise<ApprovalSignalHealthScore> {
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
    const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000)

    const flags: ApprovalFlag[] = []
    let score = 1.0

    // Query insights for approvals/dismissals in the last hour for tenant
    const insights = await this.db.collection('insights').find({
      tenant_id: tenantId,
      $or: [
        { approved_at: { $gte: oneHourAgo } },
        { dismissed_at: { $gte: oneHourAgo } },
      ],
    }).toArray()

    const approved = insights.filter(i => i.approved_at).length
    const dismissed = insights.filter(i => i.dismissed_at).length
    const total = approved + dismissed

    if (total === 0) {
      // No activity, return healthy score
      return { score: 1.0, flags: [], computed_at: now }
    }

    // Check rapid_fire: > 10 approvals in 60 seconds
    const recentApprovals = insights.filter(i => 
      i.approved_at && new Date(i.approved_at as Date).getTime() > oneHourAgo.getTime()
    )
    const approvalsInLastMinute = recentApprovals.filter(i => {
      const approvedTime = new Date(i.approved_at as Date).getTime()
      return approvedTime > new Date(now.getTime() - 60 * 1000).getTime()
    }).length

    if (approvalsInLastMinute > 10) {
      flags.push('rapid_fire')
      score -= 0.25
    }

    // Check batch_approval: > 15 approvals in 5 minutes
    const approvalsInLastFiveMinutes = recentApprovals.filter(i => {
      const approvedTime = new Date(i.approved_at as Date).getTime()
      return approvedTime > fiveMinutesAgo.getTime()
    }).length

    if (approvalsInLastFiveMinutes > 15) {
      flags.push('batch_approval')
      score -= 0.25
    }

    // Check dismiss_spike: dismiss rate > 90% in last hour (baseline was < 40%)
    const dismissRate = total > 0 ? dismissed / total : 0
    if (dismissRate > 0.9) {
      // Check if this is a spike by looking at baseline
      const baselineDismissals = await this.db.collection('insights').countDocuments({
        tenant_id: tenantId,
        dismissed_at: { $gte: new Date(oneHourAgo.getTime() - 24 * 60 * 60 * 1000), $lt: oneHourAgo },
      })
      const baselineTotal = await this.db.collection('insights').countDocuments({
        tenant_id: tenantId,
        $or: [
          { approved_at: { $gte: new Date(oneHourAgo.getTime() - 24 * 60 * 60 * 1000), $lt: oneHourAgo } },
          { dismissed_at: { $gte: new Date(oneHourAgo.getTime() - 24 * 60 * 60 * 1000), $lt: oneHourAgo } },
        ],
      })
      const baselineRate = baselineTotal > 0 ? baselineDismissals / baselineTotal : 0

      if (baselineRate < 0.4 && dismissRate > 0.9) {
        flags.push('dismiss_spike')
        score -= 0.25
      }
    }

    // Check no_variance: all decisions identical for > 20 consecutive insights
    const recentInsights = await this.db.collection('insights').find({
      tenant_id: tenantId,
      $or: [
        { approved_at: { $gte: oneHourAgo } },
        { dismissed_at: { $gte: oneHourAgo } },
      ],
    }).sort({ approved_at: -1, dismissed_at: -1 }).limit(20).toArray()

    if (recentInsights.length >= 20) {
      const allApproved = recentInsights.every(i => i.approved_at)
      const allDismissed = recentInsights.every(i => i.dismissed_at)
      if (allApproved || allDismissed) {
        flags.push('no_variance')
        score -= 0.25
      }
    }

    // Check connector_resync: large event batch detected (> 30 events in 2 mins)
    const eventsInLastTwoMinutes = await this.db.collection('insights').countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: twoMinutesAgo },
    })

    if (eventsInLastTwoMinutes > 30) {
      flags.push('connector_resync')
      score -= 0.25
    }

    // Floor score at 0
    score = Math.max(0, score)

    // Persist result to tenant_settings with 10-minute TTL
    await this.db.collection('tenant_settings').updateOne(
      { tenant_id: tenantId },
      { 
        $set: { 
          'approval_signal_health': { score, flags, computed_at: now },
          updated_at: now 
        } 
      },
      { upsert: true }
    )

    return { score, flags, computed_at: now }
  }

  async shouldPauseLearning(tenantId: string): Promise<boolean> {
    // Check if we have a recent cached result (within 10 minutes)
    const cached = await this.db.collection('tenant_settings').findOne({ tenant_id: tenantId })
    const cachedHealth = cached?.['approval_signal_health'] as ApprovalSignalHealthScore | undefined

    if (cachedHealth) {
      const cacheAge = new Date().getTime() - new Date(cachedHealth.computed_at).getTime()
      if (cacheAge < 10 * 60 * 1000) { // 10 minutes
        return cachedHealth.score < 0.6
      }
    }

    // Compute fresh health score
    const health = await this.compute(tenantId)
    return health.score < 0.6
  }
}
