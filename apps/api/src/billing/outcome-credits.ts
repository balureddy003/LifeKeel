import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { getTenantCollection, createLogger } from '@agentoak/platform'

const log = createLogger({ service: 'outcome-credits', version: '0.0.0' })
import { recordMomentOutcome } from '../verified-moments.js'
import {
  ensureOutcomeIndexes,
  getOutcomeChargesCollection,
} from '../db.js'
import { recordCreditsConsumed } from '../routes/metrics.js'
import { recordLedgerEntry } from './credit-ledger.js'
import { PLAN_CHARGE_COOLDOWN_DAYS, MIN_PROGRESS_THRESHOLD, type Plan } from './billing-constants.js'
import { checkAndSendLowCreditAlert } from './low-credit-alerts.js'

export interface KpiLike {
  metric: string
  label: string
  unit: string
  target: number
  start_value: number
  direction: 'increase' | 'decrease'
}

export interface OutcomeEvent {
  id: string
  tenant_id: string
  goal_id: string
  kpi_metric: string
  insight_id?: string
  verified_moment_id: string
  baseline: number
  observed: number
  delta: number
  credits_consumed: number
  currency: string
  measured_at: Date
  source: string
}

const MOMENT_LOOKBACK_DAYS = 14

function computeProgress(kpi: KpiLike, value: number): number {
  const totalNeeded = kpi.direction === 'increase'
    ? kpi.target - kpi.start_value
    : kpi.start_value - kpi.target
  if (totalNeeded <= 0) return 1
  const delta = kpi.direction === 'increase'
    ? value - kpi.start_value
    : kpi.start_value - value
  return Math.min(1, Math.max(0, delta / totalNeeded))
}

function generateId(): string {
  return `oe_${randomUUID()}`
}

const CURRENCY_UNITS = new Set(['GBP', 'USD', 'EUR', 'INR', 'SGD', 'AED', 'AUD', 'CAD', 'ZAR', 'NZD', 'CHF', 'JPY', 'BRL', 'MXN', 'currency', 'minor_currency', '£', '$', '€', '₹'])
const MINOR_CURRENCY_UNITS = new Set(['minor_currency'])

function isCurrencyUnit(unit: string): boolean {
  return CURRENCY_UNITS.has(unit)
}

function isMinorCurrency(unit: string): boolean {
  return MINOR_CURRENCY_UNITS.has(unit)
}

function outcomeValueMinorUnits(kpi: KpiLike, currentValue: number): number {
  if (!isCurrencyUnit(kpi.unit)) return 0
  const favourableDelta = kpi.direction === 'increase'
    ? currentValue - kpi.start_value
    : kpi.start_value - currentValue
  // minor_currency values are already in pence/cents; major currency units are in pounds/dollars/euros.
  const multiplier = isMinorCurrency(kpi.unit) ? 1 : 100
  return Math.max(0, Math.round(favourableDelta * multiplier))
}

export class OutcomeCredits {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    await ensureOutcomeIndexes(this.db)
    // L2: Add missing indexes on outcome_charges
    await Promise.all([
      getOutcomeChargesCollection(this.db).createIndex({ tenant_id: 1, status: 1, created_at: -1 }).catch(() => {}),
      getOutcomeChargesCollection(this.db).createIndex({ event_id: 1 }).catch(() => {}),
    ])
  }

  async getBalance(tenantId: string): Promise<number> {
    const tenants = getTenantCollection(this.db, 'tenants', tenantId)
    const tenant = (await tenants.findOne({})) as Record<string, any> | null
    const balance = tenant?.['billing']?.['credits_balance']
    return typeof balance === 'number' ? balance : 0
  }

  /**
   * Measure whether a KPI movement should consume an outcome credit.
   * Called by the KPI compute engine after it updates a goal KPI.
   *
   * C1 fix: The insert + deduction are now atomic. We use the unique index
   * on { tenant_id, verified_moment_id } as the guard — if the insert fails
   * (duplicate), we skip the deduction entirely.
   *
   * C2 fix: The deduction uses a conditional filter
   * (`credits_balance: { $gte: 1 }`) so it only fires if there are enough
   * credits. If the balance is 0, no deduction occurs.
   */
  async measureAndCharge(opts: {
    tenantId: string
    goalId: string
    kpi: KpiLike
    currentValue: number
  }): Promise<OutcomeEvent | null> {
    const { tenantId, goalId, kpi, currentValue } = opts
    const progress = computeProgress(kpi, currentValue)
    if (progress < MIN_PROGRESS_THRESHOLD) return null

    await this.ensureIndexes()

    const since = new Date(Date.now() - MOMENT_LOOKBACK_DAYS * 86_400_000)
    const moments = getTenantCollection(this.db, 'verified_moments', tenantId)

    const candidate = await moments.findOne({
      goal_id: goalId,
      kpi_metric: kpi.metric,
      status: { $in: ['approved', 'actioned'] },
      created_at: { $gte: since },
    }, { sort: { created_at: 1 } }) as Record<string, unknown> | null

    if (!candidate) return null

    const momentId = String(candidate['id'])

    // Avoid duplicate charges for the same moment
    const events = getTenantCollection(this.db, 'outcome_events', tenantId)
    const existing = await events.findOne({ verified_moment_id: momentId })
    if (existing) return null

    // Avoid charging the same goal+KPI too frequently
    // Cooldown is plan-based: 30 days for free, 7 days for paid plans
    const tenant = (await getTenantCollection(this.db, 'tenants', tenantId).findOne({})) as Record<string, any> | null
    const tenantPlan = String(tenant?.['plan'] ?? 'free') as Plan
    const cooldownDays = PLAN_CHARGE_COOLDOWN_DAYS[tenantPlan] ?? 30
    const cooldownSince = new Date(Date.now() - cooldownDays * 86_400_000)
    const recentCharge = await events.findOne({
      goal_id: goalId,
      kpi_metric: kpi.metric,
      measured_at: { $gte: cooldownSince },
    })
    if (recentCharge) return null

    const currency = String(tenant?.['billing']?.['currency'] ?? 'GBP')
    const outcomePrice = Number(tenant?.['billing']?.['outcome_price'] ?? 0)

    // Value-based credit pricing: charge more credits for higher-impact outcomes.
    // For currency KPIs, 1 credit per £5,000 (or equivalent) of favourable delta.
    // For non-currency KPIs, flat 1 credit.
    // Minimum 1 credit, maximum 10 credits per outcome.
    const outcomeValueMinor = outcomeValueMinorUnits(kpi, currentValue)
    const outcomeValueMajor = outcomeValueMinor / 100
    const VALUE_CREDIT_THRESHOLD = 5000 // £5,000 per credit
    let creditsToConsume = 1
    if (outcomeValueMinor > 0 && outcomeValueMajor >= VALUE_CREDIT_THRESHOLD) {
      creditsToConsume = Math.min(10, Math.max(1, Math.round(outcomeValueMajor / VALUE_CREDIT_THRESHOLD)))
    }

    const event: OutcomeEvent = {
      id: generateId(),
      tenant_id: tenantId,
      goal_id: goalId,
      kpi_metric: kpi.metric,
      verified_moment_id: momentId,
      baseline: kpi.start_value,
      observed: currentValue,
      delta: Math.round((currentValue - kpi.start_value) * 10_000) / 10_000,
      credits_consumed: creditsToConsume,
      currency,
      measured_at: new Date(),
      source: 'kpi_compute_engine',
    }
    if (candidate['insight_id']) {
      event.insight_id = String(candidate['insight_id'])
    }

    // C1+C2 fix: Use a MongoDB transaction to atomically insert the event
    // and deduct credits. Falls back to the non-transactional path if the
    // MongoDB deployment doesn't support transactions (e.g. standalone dev).
    const tenantsCol = getTenantCollection(this.db, 'tenants', tenantId)
    // Raw collections for transaction support (TenantScopedCollection doesn't pass sessions)
    const rawEvents = this.db.collection('outcome_events')
    const rawTenants = this.db.collection('tenants')

    let deductionSucceeded = false
    try {
      // Try transactional path (requires replica set or sharded cluster)
      const client = (this.db as unknown as { client: import('mongodb').MongoClient }).client
      const session = client.startSession()
      try {
        await session.withTransaction(async () => {
          // Insert event inside transaction (unique index prevents duplicates)
          await rawEvents.insertOne({ ...event, tenant_id: tenantId }, { session })
          // Conditional deduction — only deduct if balance >= credits
          const result = await rawTenants.updateOne(
            { tenant_id: tenantId, 'billing.credits_balance': { $gte: creditsToConsume } },
            { $inc: {
              'billing.credits_balance': -creditsToConsume,
              'billing.credits_used_this_period': creditsToConsume,
            } },
            { session },
          )
          if (result.modifiedCount === 0) {
            throw new Error('INSUFFICIENT_CREDITS')
          }
        })
        deductionSucceeded = true
      } finally {
        await session.endSession()
      }
    } catch (txErr) {
      // Transaction failed — could be no replica set (dev) or insufficient credits
      if (txErr instanceof Error && txErr.message === 'INSUFFICIENT_CREDITS') {
        return null
      }
      // Fall back to non-transactional path (standalone MongoDB / dev mode)
      // C1: Try inserting the event first. The unique index on
      // { tenant_id, verified_moment_id } prevents duplicates.
      try {
        await events.insertOne(event as unknown as Record<string, unknown>)
      } catch {
        // Duplicate key error — another concurrent call already charged
        return null
      }
      // C2: Conditional deduction — only deduct if balance >= credits.
      const deductionResult = await tenantsCol.updateOne(
        { 'billing.credits_balance': { $gte: creditsToConsume } },
        { $inc: {
          'billing.credits_balance': -creditsToConsume,
          'billing.credits_used_this_period': creditsToConsume,
        } },
      ) as { modifiedCount: number }
      if (deductionResult.modifiedCount === 0) {
        // Insufficient credits — remove the event we just inserted
        await events.deleteOne({ id: event.id }).catch(err => log.error({ err }, 'Failed to cleanup orphaned event'))
        return null
      }
      deductionSucceeded = true
    }

    if (!deductionSucceeded) return null

    // M5: Record credit consumption for Prometheus metrics
    recordCreditsConsumed(tenantId, creditsToConsume)

    // Record in the append-only credit ledger
    await recordLedgerEntry(this.db, {
      tenantId,
      type: 'outcome_charge',
      amount: -creditsToConsume,
      reference: event.id,
      reason: `Outcome charge for goal ${goalId}, KPI ${kpi.metric}`,
      actor: 'kpi_compute_engine',
    }).catch(err => log.error({ err, tenantId }, 'Failed to record ledger entry'))

    // Check if credits are low and send alert email if needed
    await checkAndSendLowCreditAlert(this.db, tenantId).catch(err => log.error({ err, tenantId }, 'Failed to send low credit alert'))

    await recordMomentOutcome(this.db, {
      tenantId,
      momentId,
      metric: kpi.metric,
      baseline: kpi.start_value,
      observed: currentValue,
      valueMinorUnits: outcomeValueMinorUnits(kpi, currentValue),
      currency,
      source: 'kpi_compute_engine',
    })

    // If the tenant has a configured outcome price, log a payable line item.
    if (outcomePrice > 0) {
      await getOutcomeChargesCollection(this.db).insertOne({
        tenant_id: tenantId,
        event_id: event.id,
        amount_minor: Math.round(outcomePrice * 100),
        currency,
        status: 'pending',
        created_at: new Date(),
      }).catch(() => {})
    }

    return event
  }

  /**
   * L3: Reverse a credit charge — restores credits and marks the outcome
   * event as reversed. Used when an outcome was incorrectly charged.
   */
  async reverseCharge(opts: {
    tenantId: string
    eventId: string
    reason: string
  }): Promise<boolean> {
    const { tenantId, eventId, reason } = opts
    const events = getTenantCollection(this.db, 'outcome_events', tenantId)

    // Find the event and check it hasn't already been reversed
    const event = await events.findOne({ id: eventId }) as Record<string, unknown> | null
    if (!event) return false
    if (event['reversed_at']) return false // Already reversed

    const creditsToRefund = Number(event['credits_consumed'] ?? 0)
    if (creditsToRefund <= 0) return false

    // Mark event as reversed
    await events.updateOne(
      { id: eventId },
      { $set: { reversed_at: new Date(), reversal_reason: reason } },
    )

    // Refund credits
    await getTenantCollection(this.db, 'tenants', tenantId).updateOne(
      {},
      { $inc: {
        'billing.credits_balance': creditsToRefund,
        'billing.credits_used_this_period': -creditsToRefund,
      } },
    )

    // Remove any pending outcome charge for this event
    await getOutcomeChargesCollection(this.db).deleteOne({
      event_id: eventId,
      status: 'pending',
    }).catch(() => {})

    // Record in the append-only credit ledger
    await recordLedgerEntry(this.db, {
      tenantId,
      type: 'outcome_reverse',
      amount: creditsToRefund,
      reference: eventId,
      reason: `Reversal: ${reason}`,
      actor: 'admin',
    }).catch(() => {})

    return true
  }
}
