/**
 * Append-only credit ledger — every credit movement is recorded as an
 * immutable transaction. This is the financial source of truth.
 *
 * The `billing.credits_balance` field on the tenant document is a denormalized
 * cache for fast reads. The ledger is the authoritative record. A periodic
 * reconciliation job verifies they match.
 *
 * Transaction types:
 *   trial_grant       — credits granted at signup
 *   invite_grant      — credits granted via invite code
 *   promo_grant       — credits granted via promo code redemption
 *   plan_grant        — credits granted on plan upgrade/renewal
 *   outcome_charge    — credits consumed by an outcome measurement
 *   outcome_reverse   — credits restored by reversing an outcome charge
 *   admin_adjustment  — manual credit adjustment by an admin
 *   trial_expiry      — credits zeroed when trial expires
 *   plan_downgrade    — credits reset on plan downgrade
 *   cycle_reset       — credits refilled at billing cycle reset
 *
 * Each transaction records:
 *   - tenant_id, type, amount (positive=grant, negative=deduction)
 *   - balance_after (the balance after this transaction)
 *   - reference (event_id, promo_code, plan, etc.)
 *   - reason (human-readable)
 *   - actor (user_id, 'system', 'stripe_webhook', 'admin')
 *   - timestamp
 */

import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { getTenantCollection } from '@agentoak/platform'
import { isBillingV2Enabled } from './billing-constants.js'

type LedgerEntryType =
  | 'trial_grant'
  | 'invite_grant'
  | 'promo_grant'
  | 'plan_grant'
  | 'outcome_charge'
  | 'outcome_reverse'
  | 'admin_adjustment'
  | 'trial_expiry'
  | 'plan_downgrade'
  | 'cycle_reset'

export interface LedgerEntry {
  id: string
  tenant_id: string
  type: LedgerEntryType
  amount: number          // positive = grant, negative = deduction
  balance_after: number   // tenant balance after this entry
  reference?: string      // event_id, promo_code, plan name, etc.
  reason: string          // human-readable
  actor: string           // user_id, 'system', 'stripe_webhook', 'admin'
  timestamp: Date
}

export function getCreditLedgerCollection(db: Db) {
  return db.collection<LedgerEntry>('credit_ledger')
}

let indexesEnsured = false

export async function ensureLedgerIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return
  const col = getCreditLedgerCollection(db)
  await Promise.all([
    col.createIndex({ tenant_id: 1, timestamp: -1 }).catch(() => {}),
    col.createIndex({ tenant_id: 1, type: 1, timestamp: -1 }).catch(() => {}),
    col.createIndex({ reference: 1 }, { sparse: true }).catch(() => {}),
    col.createIndex({ id: 1 }, { unique: true }).catch(() => {}),
  ])
  indexesEnsured = true
}

/**
 * Record a credit ledger entry. This is called after every credit movement.
 * The `balanceAfter` is read from the tenant document to capture the current
 * state. If the read fails, we use -1 as a sentinel (reconciliation will catch it).
 */
export async function recordLedgerEntry(db: Db, opts: {
  tenantId: string
  type: LedgerEntryType
  amount: number
  reference?: string
  reason: string
  actor: string
}): Promise<LedgerEntry | null> {
  // Feature flag: skip ledger writes if billing v2 is not enabled
  if (!isBillingV2Enabled()) return null

  await ensureLedgerIndexes(db)

  // Read the current balance after the mutation
  const tenant = (await getTenantCollection(db, 'tenants', opts.tenantId).findOne({})) as Record<string, any> | null
  const balanceAfter = typeof tenant?.['billing']?.['credits_balance'] === 'number'
    ? tenant['billing']['credits_balance']
    : -1

  const entry: LedgerEntry = {
    id: `led_${randomUUID()}`,
    tenant_id: opts.tenantId,
    type: opts.type,
    amount: opts.amount,
    balance_after: balanceAfter,
    reference: opts.reference,
    reason: opts.reason,
    actor: opts.actor,
    timestamp: new Date(),
  }

  await getCreditLedgerCollection(db).insertOne(entry)
  return entry
}

/**
 * Get the ledger history for a tenant, paginated and optionally filtered by type.
 */
export async function getLedgerHistory(db: Db, opts: {
  tenantId: string
  type?: LedgerEntryType
  limit?: number
  cursor?: Date  // timestamp of the last entry from the previous page
}): Promise<{ entries: LedgerEntry[]; has_more: boolean }> {
  if (!isBillingV2Enabled()) return { entries: [], has_more: false }
  const limit = Math.min(opts.limit ?? 50, 200)
  const filter: Record<string, unknown> = { tenant_id: opts.tenantId }
  if (opts.type) filter['type'] = opts.type
  if (opts.cursor) filter['timestamp'] = { $lt: opts.cursor }

  const entries = await getCreditLedgerCollection(db)
    .find(filter)
    .sort({ timestamp: -1 })
    .limit(limit + 1)
    .toArray()

  const hasMore = entries.length > limit
  return {
    entries: entries.slice(0, limit),
    has_more: hasMore,
  }
}

/**
 * Reconciliation — verify that the sum of all ledger entries matches the
 * tenant's current credits_balance. Returns discrepancies.
 *
 * This is called by the billing cron daily. If a discrepancy is found, it
 * logs an error and optionally sends an alert.
 */
export async function reconcileCredits(db: Db, opts: {
  tenantId: string
}): Promise<{
  reconciled: boolean
  ledger_sum: number
  tenant_balance: number
  discrepancy: number
}> {
  const pipeline = [
    { $match: { tenant_id: opts.tenantId } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]
  const result = await getCreditLedgerCollection(db).aggregate(pipeline).toArray()
  const ledgerSum = result.length > 0 ? Number(result[0]['total']) : 0

  const tenant = (await getTenantCollection(db, 'tenants', opts.tenantId).findOne({})) as Record<string, any> | null
  const tenantBalance = typeof tenant?.['billing']?.['credits_balance'] === 'number'
    ? tenant['billing']['credits_balance']
    : 0

  // For unlimited plans (credits_balance = MAX_SAFE_INTEGER), reconciliation
  // is skipped — the ledger tracks individual charges, not the balance.
  if (tenantBalance === Number.MAX_SAFE_INTEGER) {
    return { reconciled: true, ledger_sum: ledgerSum, tenant_balance: tenantBalance, discrepancy: 0 }
  }

  const discrepancy = tenantBalance - ledgerSum
  return {
    reconciled: discrepancy === 0,
    ledger_sum: ledgerSum,
    tenant_balance: tenantBalance,
    discrepancy,
  }
}
