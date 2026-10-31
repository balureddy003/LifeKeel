import type { Db } from 'mongodb'
import { CostLedger } from './cost-ledger.js'

export interface LlmBudgetDecision {
  allowed: boolean
  spent_microdollars: number
  limit_microdollars: number | null
  threshold_reached: boolean
  reason?: 'budget_exhausted' | 'detector_budget_exhausted' | 'plan_spend_budget_exceeded'
}

/**
 * Monthly model spend per tenant when the tenant has set no budget of its own.
 * Without it a tenant that never configured one had no cap at all. Hard stop,
 * so a runaway or abusive account is refused rather than only alerted on.
 */
export const DEFAULT_MONTHLY_LIMIT_USD = 2

export class LlmBudgetGuard {
  private readonly ledger: CostLedger
  constructor(private readonly db: Db) {
    this.ledger = new CostLedger(db)
  }

  async check(tenantId: string, detectorId?: string): Promise<LlmBudgetDecision> {
    const settings = await this.db.collection('tenant_settings').findOne({ tenant_id: tenantId })
    const budget = settings?.['llm_budget'] as
      | {
          monthly_limit_usd?: number
          alert_threshold_pct?: number
          hard_stop?: boolean
          per_detector_limit_usd?: Record<string, number>
        }
      | undefined
    const spent = (await this.ledger.getSummary(tenantId, 31)).total_cost_microdollars
    const usingDefault = !budget?.monthly_limit_usd
    const limit = (budget?.monthly_limit_usd ?? DEFAULT_MONTHLY_LIMIT_USD) * 1_000_000
    const thresholdReached = spent >= limit * ((budget?.alert_threshold_pct ?? 80) / 100)
    if (thresholdReached)
      await this.db.collection('system_events').updateOne(
        {
          tenant_id: tenantId,
          type: 'llm.budget_threshold',
          month: new Date().toISOString().slice(0, 7),
        },
        {
          $setOnInsert: {
            tenant_id: tenantId,
            type: 'llm.budget_threshold',
            month: new Date().toISOString().slice(0, 7),
            spent_microdollars: spent,
            limit_microdollars: limit,
            created_at: new Date(),
          },
        },
        { upsert: true },
      )
    if ((usingDefault || budget?.hard_stop) && spent >= limit)
      return {
        allowed: false,
        spent_microdollars: spent,
        limit_microdollars: limit,
        threshold_reached: true,
        reason: 'budget_exhausted',
      }
    if (detectorId && budget?.per_detector_limit_usd?.[detectorId]) {
      const detectorSpent = await this.db
        .collection('llm_usage')
        .aggregate<{ total: number }>([
          { $match: { tenant_id: tenantId, detector_id: detectorId } },
          { $group: { _id: null, total: { $sum: '$cost_microdollars' } } },
        ])
        .next()
      if ((detectorSpent?.total ?? 0) >= budget.per_detector_limit_usd![detectorId]! * 1_000_000)
        return {
          allowed: false,
          spent_microdollars: spent,
          limit_microdollars: limit,
          threshold_reached: thresholdReached,
          reason: 'detector_budget_exhausted',
        }
    }
    return {
      allowed: true,
      spent_microdollars: spent,
      limit_microdollars: limit,
      threshold_reached: thresholdReached,
    }
  }
}
