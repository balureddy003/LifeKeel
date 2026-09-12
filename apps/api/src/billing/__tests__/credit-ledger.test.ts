/**
 * Tests for the append-only credit ledger:
 * - Ledger entries are recorded for every credit movement
 * - Reconciliation detects discrepancies between ledger and balance
 * - Ledger history pagination works
 * - Orphaned event cleanup removes events without deductions
 * - Distributed cron lock prevents concurrent runs
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import {
  recordLedgerEntry,
  getLedgerHistory,
  reconcileCredits,
  ensureLedgerIndexes,
  getCreditLedgerCollection,
} from '../credit-ledger.js'
import { OutcomeCredits, type KpiLike } from '../outcome-credits.js'
import { redeemPromoCode } from '../promo-codes.js'
import { cleanupOrphanedEvents, runReconciliation } from '../../jobs/billing-cron.js'

const TENANT_ID = 'ledger-test-tenant'

async function seedTenant(db: Db, opts: {
  balance?: number
  outcomePrice?: number
  currency?: string
  plan?: string
} = {}) {
  await db.collection('tenants').updateOne(
    { tenant_id: TENANT_ID },
    {
      $set: {
        tenant_id: TENANT_ID,
        plan: opts.plan ?? 'free',
        billing: {
          credits_balance: opts.balance ?? 10,
          credits_included: 10,
          credits_used_this_period: 0,
          outcome_price: opts.outcomePrice ?? 0,
          currency: opts.currency ?? 'GBP',
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
    },
    { upsert: true },
  )
}

const TEST_KPI: KpiLike = {
  metric: 'portfolio_concentration_max_pct',
  label: 'Concentration',
  unit: '%',
  target: 10,
  start_value: 12,
  direction: 'decrease',
}

async function seedVerifiedMoment(db: Db, momentId: string) {
  await db.collection('verified_moments').insertOne({
    id: momentId,
    tenant_id: TENANT_ID,
    goal_id: 'goal-1',
    kpi_metric: TEST_KPI.metric,
    insight_id: `insight-${momentId}`,
    status: 'approved',
    hypothesis: 'test',
    confidence: 0.85,
    signal_ids: [],
    reasoning: 'Test reasoning',
    created_at: new Date(),
  })
}

describe('Credit ledger', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db

  beforeEach(async () => {
    mongod = await MongoMemoryServer.create()
    const uri = mongod.getUri()
    process.env['MONGODB_URL'] = uri
    process.env['MONGODB_DB'] = 'ledger_test'
    process.env['BILLING_V2_ENABLED'] = 'true'
    client = new MongoClient(uri)
    await client.connect()
    db = client.db('ledger_test')
    await ensureLedgerIndexes(db)
  })

  afterEach(async () => {
    await client.close()
    await mongod.stop()
  })

  // ── Basic ledger operations ──────────────────────────────────────────────────

  it('records a ledger entry with correct fields', async () => {
    await seedTenant(db, { balance: 10 })
    const entry = await recordLedgerEntry(db, {
      tenantId: TENANT_ID,
      type: 'trial_grant',
      amount: 10,
      reference: 'signup',
      reason: 'Trial credits at signup',
      actor: 'system',
    })

    expect(entry).not.toBeNull()
    expect(entry!.id).toMatch(/^led_/)
    expect(entry!.tenant_id).toBe(TENANT_ID)
    expect(entry!.type).toBe('trial_grant')
    expect(entry!.amount).toBe(10)
    expect(entry!.balance_after).toBe(10) // read from tenant
    expect(entry!.reference).toBe('signup')
    expect(entry!.reason).toBe('Trial credits at signup')
    expect(entry!.actor).toBe('system')
    expect(entry!.timestamp).toBeInstanceOf(Date)
  })

  it('records negative amounts for deductions', async () => {
    await seedTenant(db, { balance: 8 })
    const entry = await recordLedgerEntry(db, {
      tenantId: TENANT_ID,
      type: 'outcome_charge',
      amount: -1,
      reference: 'oe_123',
      reason: 'Outcome charge',
      actor: 'kpi_compute_engine',
    })

    expect(entry).not.toBeNull()
    expect(entry!.amount).toBe(-1)
    expect(entry!.balance_after).toBe(8)
  })

  // ── Ledger history ───────────────────────────────────────────────────────────

  it('returns ledger history sorted by timestamp descending', async () => {
    await seedTenant(db, { balance: 10 })

    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'trial_grant', amount: 10, reason: 'Grant 1', actor: 'system' })
    await new Promise(r => setTimeout(r, 10))
    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'outcome_charge', amount: -1, reason: 'Charge 1', actor: 'system' })
    await new Promise(r => setTimeout(r, 10))
    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'outcome_charge', amount: -1, reason: 'Charge 2', actor: 'system' })

    const result = await getLedgerHistory(db, { tenantId: TENANT_ID })

    expect(result.entries.length).toBe(3)
    expect(result.has_more).toBe(false)
    // Most recent first
    expect(result.entries[0].reason).toBe('Charge 2')
    expect(result.entries[1].reason).toBe('Charge 1')
    expect(result.entries[2].reason).toBe('Grant 1')
  })

  it('filters history by type', async () => {
    await seedTenant(db, { balance: 10 })

    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'trial_grant', amount: 10, reason: 'Grant', actor: 'system' })
    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'outcome_charge', amount: -1, reason: 'Charge 1', actor: 'system' })
    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'outcome_charge', amount: -1, reason: 'Charge 2', actor: 'system' })

    const result = await getLedgerHistory(db, { tenantId: TENANT_ID, type: 'outcome_charge' })

    expect(result.entries.length).toBe(2)
    expect(result.entries.every(e => e.type === 'outcome_charge')).toBe(true)
  })

  it('paginates with limit and cursor', async () => {
    await seedTenant(db, { balance: 10 })

    for (let i = 0; i < 5; i++) {
      await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'outcome_charge', amount: -1, reason: `Charge ${i}`, actor: 'system' })
      await new Promise(r => setTimeout(r, 5))
    }

    // First page
    const page1 = await getLedgerHistory(db, { tenantId: TENANT_ID, limit: 2 })
    expect(page1.entries.length).toBe(2)
    expect(page1.has_more).toBe(true)

    // Second page using cursor
    const page2 = await getLedgerHistory(db, {
      tenantId: TENANT_ID,
      limit: 2,
      cursor: page1.entries[1].timestamp,
    })
    expect(page2.entries.length).toBe(2)
    expect(page2.has_more).toBe(true)

    // Third page
    const page3 = await getLedgerHistory(db, {
      tenantId: TENANT_ID,
      limit: 2,
      cursor: page2.entries[1].timestamp,
    })
    expect(page3.entries.length).toBe(1)
    expect(page3.has_more).toBe(false)
  })

  // ── Reconciliation ───────────────────────────────────────────────────────────

  it('reconciliation passes when ledger sum matches balance', async () => {
    await seedTenant(db, { balance: 10 })

    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'trial_grant', amount: 10, reason: 'Trial', actor: 'system' })

    const result = await reconcileCredits(db, { tenantId: TENANT_ID })

    expect(result.reconciled).toBe(true)
    expect(result.ledger_sum).toBe(10)
    expect(result.tenant_balance).toBe(10)
    expect(result.discrepancy).toBe(0)
  })

  it('reconciliation detects discrepancy when balance does not match ledger', async () => {
    await seedTenant(db, { balance: 15 }) // Balance is 15 but ledger only records 10

    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'trial_grant', amount: 10, reason: 'Trial', actor: 'system' })

    const result = await reconcileCredits(db, { tenantId: TENANT_ID })

    expect(result.reconciled).toBe(false)
    expect(result.ledger_sum).toBe(10)
    expect(result.tenant_balance).toBe(15)
    expect(result.discrepancy).toBe(5) // 15 - 10 = 5
  })

  it('reconciliation handles tenant with no ledger entries', async () => {
    await seedTenant(db, { balance: 10 })

    const result = await reconcileCredits(db, { tenantId: TENANT_ID })

    expect(result.reconciled).toBe(false)
    expect(result.ledger_sum).toBe(0)
    expect(result.tenant_balance).toBe(10)
    expect(result.discrepancy).toBe(10)
  })

  it('reconciliation skips unlimited plans (MAX_SAFE_INTEGER balance)', async () => {
    await db.collection('tenants').updateOne(
      { tenant_id: TENANT_ID },
      {
        $set: {
          tenant_id: TENANT_ID,
          plan: 'enterprise',
          billing: { credits_balance: Number.MAX_SAFE_INTEGER, credits_included: -1, credits_used_this_period: 0, outcome_price: 0, currency: 'GBP' },
        },
      },
      { upsert: true },
    )

    const result = await reconcileCredits(db, { tenantId: TENANT_ID })

    expect(result.reconciled).toBe(true)
    expect(result.discrepancy).toBe(0)
  })

  // ── Integration: outcome charge creates ledger entry ─────────────────────────

  it('measureAndCharge creates a ledger entry', async () => {
    await seedTenant(db, { balance: 10 })
    await seedVerifiedMoment(db, 'vm-ledger-1')

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    const ledgerEntries = await getCreditLedgerCollection(db).find({
      tenant_id: TENANT_ID,
      type: 'outcome_charge',
    }).toArray()

    expect(ledgerEntries.length).toBe(1)
    expect(ledgerEntries[0].amount).toBe(-1)
    expect(ledgerEntries[0].reference).toBe(event!.id)
  })

  it('reverseCharge creates a ledger entry', async () => {
    await seedTenant(db, { balance: 10 })
    await seedVerifiedMoment(db, 'vm-ledger-2')

    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: event!.id,
      reason: 'test reversal',
    })

    const ledgerEntries = await getCreditLedgerCollection(db).find({
      tenant_id: TENANT_ID,
      type: 'outcome_reverse',
    }).toArray()

    expect(ledgerEntries.length).toBe(1)
    expect(ledgerEntries[0].amount).toBe(1) // refund
    expect(ledgerEntries[0].reference).toBe(event!.id)
  })

  it('promo code redemption creates a ledger entry', async () => {
    await seedTenant(db, { balance: 10 })
    await db.collection('promo_codes').insertOne({
      code: 'LEDGER50',
      grant_credits: 50,
      max_uses: 100,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })

    await redeemPromoCode(db, TENANT_ID, 'LEDGER50')

    const ledgerEntries = await getCreditLedgerCollection(db).find({
      tenant_id: TENANT_ID,
      type: 'promo_grant',
    }).toArray()

    expect(ledgerEntries.length).toBe(1)
    expect(ledgerEntries[0].amount).toBe(50)
    expect(ledgerEntries[0].reference).toBe('LEDGER50')
  })

  // ── Orphaned event cleanup ───────────────────────────────────────────────────

  it('cleans up orphaned outcome events (inserted but never charged)', async () => {
    await seedTenant(db, { balance: 0 })

    // Insert an outcome_event directly without a corresponding charge
    // (simulates a crash between insert and deduction)
    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    await db.collection('outcome_events').insertOne({
      id: 'oe_orphan_1',
      tenant_id: TENANT_ID,
      goal_id: 'goal-1',
      kpi_metric: TEST_KPI.metric,
      verified_moment_id: 'vm_orphan',
      credits_consumed: 1,
      currency: 'GBP',
      measured_at: oldDate,
      source: 'kpi_compute_engine',
    })

    const result = await cleanupOrphanedEvents(db)

    expect(result.cleaned).toBe(1)

    // The orphan should be deleted
    const event = await db.collection('outcome_events').findOne({ id: 'oe_orphan_1' })
    expect(event).toBeNull()
  })

  it('does not clean up events that have a corresponding ledger entry', async () => {
    await seedTenant(db, { balance: 10 })

    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await db.collection('outcome_events').insertOne({
      id: 'oe_not_orphan',
      tenant_id: TENANT_ID,
      goal_id: 'goal-1',
      kpi_metric: TEST_KPI.metric,
      verified_moment_id: 'vm_not_orphan',
      credits_consumed: 1,
      currency: 'GBP',
      measured_at: oldDate,
      source: 'kpi_compute_engine',
    })

    // Create a ledger entry for this event (simulating successful charge)
    await recordLedgerEntry(db, {
      tenantId: TENANT_ID,
      type: 'outcome_charge',
      amount: -1,
      reference: 'oe_not_orphan',
      reason: 'Outcome charge',
      actor: 'kpi_compute_engine',
    })

    const result = await cleanupOrphanedEvents(db)

    expect(result.cleaned).toBe(0)

    // Event should still exist
    const event = await db.collection('outcome_events').findOne({ id: 'oe_not_orphan' })
    expect(event).not.toBeNull()
  })

  it('does not clean up recent events (within 1 hour)', async () => {
    await seedTenant(db, { balance: 0 })

    // Insert a recent event (10 minutes ago)
    const recentDate = new Date(Date.now() - 10 * 60 * 1000)
    await db.collection('outcome_events').insertOne({
      id: 'oe_recent',
      tenant_id: TENANT_ID,
      goal_id: 'goal-1',
      kpi_metric: TEST_KPI.metric,
      verified_moment_id: 'vm_recent',
      credits_consumed: 1,
      currency: 'GBP',
      measured_at: recentDate,
      source: 'kpi_compute_engine',
    })

    const result = await cleanupOrphanedEvents(db)

    expect(result.cleaned).toBe(0)
  })

  // ── Reconciliation cron ──────────────────────────────────────────────────────

  it('runReconciliation checks all tenants and reports discrepancies', async () => {
    // Tenant 1: balanced
    await db.collection('tenants').insertOne({
      tenant_id: 'tenant-balanced',
      plan: 'free',
      billing: { credits_balance: 10, credits_included: 10, credits_used_this_period: 0, outcome_price: 0, currency: 'GBP' },
    })
    await recordLedgerEntry(db, { tenantId: 'tenant-balanced', type: 'trial_grant', amount: 10, reason: 'Trial', actor: 'system' })

    // Tenant 2: discrepancy
    await db.collection('tenants').insertOne({
      tenant_id: 'tenant-discrepancy',
      plan: 'free',
      billing: { credits_balance: 20, credits_included: 10, credits_used_this_period: 0, outcome_price: 0, currency: 'GBP' },
    })
    await recordLedgerEntry(db, { tenantId: 'tenant-discrepancy', type: 'trial_grant', amount: 10, reason: 'Trial', actor: 'system' })

    const result = await runReconciliation(db)

    expect(result.checked).toBe(2)
    expect(result.discrepancies).toBe(1) // tenant-discrepancy has a 10-unit discrepancy
  })

  // ── Full ledger trail for a tenant lifecycle ──────────────────────────────────

  it('full lifecycle: trial grant → outcome charge → reversal → promo grant', async () => {
    await seedTenant(db, { balance: 10 })

    // 1. Trial grant
    await recordLedgerEntry(db, { tenantId: TENANT_ID, type: 'trial_grant', amount: 10, reference: 'signup', reason: 'Trial', actor: 'system' })

    // 2. Outcome charge
    await seedVerifiedMoment(db, 'vm-lifecycle')
    const service = new OutcomeCredits(db)
    const event = await service.measureAndCharge({
      tenantId: TENANT_ID,
      goalId: 'goal-1',
      kpi: TEST_KPI,
      currentValue: 11,
    })
    expect(event).not.toBeNull()

    // 3. Reversal
    await service.reverseCharge({
      tenantId: TENANT_ID,
      eventId: event!.id,
      reason: 'false positive',
    })

    // 4. Promo grant
    await db.collection('promo_codes').insertOne({
      code: 'LIFE25',
      grant_credits: 25,
      max_uses: 100,
      used_count: 0,
      active: true,
      created_at: new Date(),
    })
    await redeemPromoCode(db, TENANT_ID, 'LIFE25')

    // Verify the full ledger trail
    const history = await getLedgerHistory(db, { tenantId: TENANT_ID })
    expect(history.entries.length).toBe(4)

    // Check the types in order (most recent first)
    expect(history.entries[0].type).toBe('promo_grant')
    expect(history.entries[0].amount).toBe(25)
    expect(history.entries[1].type).toBe('outcome_reverse')
    expect(history.entries[1].amount).toBe(1)
    expect(history.entries[2].type).toBe('outcome_charge')
    expect(history.entries[2].amount).toBe(-1)
    expect(history.entries[3].type).toBe('trial_grant')
    expect(history.entries[3].amount).toBe(10)

    // Reconciliation should pass: 10 - 1 + 1 + 25 = 35
    // Balance should be: 10 - 1 + 1 + 25 = 35
    const recon = await reconcileCredits(db, { tenantId: TENANT_ID })
    expect(recon.reconciled).toBe(true)
    expect(recon.ledger_sum).toBe(35)
    expect(recon.tenant_balance).toBe(35)
  })
})
