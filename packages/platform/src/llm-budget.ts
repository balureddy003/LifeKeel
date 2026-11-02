import type { Db } from 'mongodb'
import { CostLedger } from './cost-ledger.js'

export interface LlmBudgetDecision {
  allowed: boolean
  spent_microdollars: number
  limit_microdollars: number | null
  threshold_reached: boolean
  reason?: 'budget_exhausted' | 'detector_budget_exhausted' | 'plan_spend_budget_exceeded'
  /** Set when the call holds a spend reservation; call it once the call has settled. */
  release?: () => Promise<void>
}

/**
 * In-flight spend reservations (one row per call). A row outlives a crashed
 * process only until expires_at; a TTL index on that field removes it.
 */
export const LLM_BUDGET_RESERVATIONS = 'llm_budget_reservations'
const RESERVATION_TTL_MS = 10 * 60 * 1000

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

  /**
   * `estimateMicrodollars` is the call's worst case (input estimate plus the
   * task's output ceiling). Under a hard stop the call reserves it first and
   * is refused when ledger spend plus every in-flight reservation would pass
   * the limit, so concurrent calls cannot jointly overspend (review F10).
   * Insert-then-sum is conservative: racing callers may both be refused, but
   * never both admitted past the limit.
   */
  async check(
    tenantId: string,
    detectorId?: string,
    estimateMicrodollars = 0,
  ): Promise<LlmBudgetDecision> {
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
    const allowed: LlmBudgetDecision = {
      allowed: true,
      spent_microdollars: spent,
      limit_microdollars: limit,
      threshold_reached: thresholdReached,
    }
    if (!(usingDefault || budget?.hard_stop) || estimateMicrodollars <= 0) return allowed
    const release = await this.reserve(tenantId, estimateMicrodollars, limit - spent)
    if (!release)
      return { ...allowed, allowed: false, threshold_reached: true, reason: 'budget_exhausted' }
    return { ...allowed, release }
  }

  private async reserve(
    tenantId: string,
    amount: number,
    headroom: number,
  ): Promise<(() => Promise<void>) | null> {
    const col = this.db.collection(LLM_BUDGET_RESERVATIONS)
    const now = new Date()
    const { insertedId } = await col.insertOne({
      tenant_id: tenantId,
      amount_microdollars: amount,
      created_at: now,
      expires_at: new Date(now.getTime() + RESERVATION_TTL_MS),
    })
    const release = async () => {
      await col.deleteOne({ _id: insertedId }).catch(() => {})
    }
    const held = await col
      .aggregate<{ total: number }>([
        { $match: { tenant_id: tenantId, expires_at: { $gt: now } } },
        { $group: { _id: null, total: { $sum: '$amount_microdollars' } } },
      ])
      .next()
    if ((held?.total ?? amount) > headroom) {
      await release()
      return null
    }
    return release
  }
}
