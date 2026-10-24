/**
 * MongoDB connection — lazy singleton.
 *
 * The `insights` collection stores every Insight produced by the engine.
 * Always scoped by `tenant_id` (from JWT) — never cross-tenant.
 *
 * Index strategy:
 *   { tenant_id: 1, created_at: -1 }   — list insights for a tenant
 *   { tenant_id: 1, state: 1 }         — filter by state
 *   { id: 1 }                           — unique insight lookup
 */

import { MongoClient, type Db, type Collection } from 'mongodb'
import type { Insight } from '@lifekeel/engine'
import type { ActionReceipt } from '@lifekeel/workflows'
import { initDetectorVersionsCollection } from './db/detector-versions.js'

let client: MongoClient | null = null
let db: Db | null = null

export async function getDb(): Promise<Db> {
  if (db) return db

  const uri =
    process.env['MONGODB_URL'] ?? process.env['MONGODB_URI'] ?? 'mongodb://localhost:27017'
  client = new MongoClient(uri, {
    maxPoolSize: 20,
    minPoolSize: 2,
    maxIdleTimeMS: 30000,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  await client.connect()
  db = client.db(process.env['MONGODB_DB'] ?? 'lifekeel')

  // Ensure indexes — wrapped in try/catch because createIndex throws if an
  // index with the same name exists but with different specs (e.g. from a
  // previous deployment with different options). Index creation is idempotent
  // only when the specs match exactly.
  const safeIndex = (err: unknown) => {
    // IndexAlreadyExists or similar — safe to ignore
  }
  const insights = db.collection('insights')
  await insights.createIndex({ tenant_id: 1, created_at: -1 }).catch(safeIndex)
  await insights.createIndex({ tenant_id: 1, state: 1 }).catch(safeIndex)
  await insights.createIndex({ id: 1 }, { unique: true }).catch(safeIndex)

  // Indexes for billing/usage queries (M7 — composite DB indexes)
  await db.collection('events').createIndex({ tenant_id: 1, created_at: -1 }).catch(safeIndex)
  await db
    .collection('workflow_runs')
    .createIndex({ tenant_id: 1, created_at: -1 })
    .catch(safeIndex)
  await db.collection('detectors').createIndex({ tenant_id: 1 }).catch(safeIndex)
  await db.collection('tenants').createIndex({ id: 1 }).catch(safeIndex)
  // Event dedup
  await db
    .collection('events')
    .createIndex({ tenant_id: 1, event_id: 1 }, { unique: true })
    .catch(safeIndex)

  // Login telemetry for the operator security view — 30-day TTL keeps it
  // bounded; per-user and per-IP indexes back the aggregations.
  const loginEvents = db.collection('login_events')
  await loginEvents
    .createIndex({ created_at: 1 }, { expireAfterSeconds: 30 * 86400 })
    .catch(safeIndex)
  await loginEvents.createIndex({ user_id: 1, created_at: -1 }).catch(safeIndex)
  await loginEvents.createIndex({ ip: 1, created_at: -1 }).catch(safeIndex)
  // Backs the per-email throttle in /auth/login (R42).
  await loginEvents.createIndex({ email: 1, created_at: -1 }).catch(safeIndex)

  // PRD-218: post tags are globally unique — growth_events carry no
  // tenant_id, so a tag collision would cross-attribute anonymous visits.
  await db
    .collection('marketing_posts')
    .createIndex({ post_tag: 1 }, { unique: true, sparse: true })
    .catch(safeIndex)

  // Signed-out session tokens (R06), kept until the longest session could expire.
  await db
    .collection('revoked_sessions')
    .createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })
    .catch(safeIndex)
  await db
    .collection('revoked_sessions')
    .createIndex({ token_hash: 1 }, { unique: true })
    .catch(safeIndex)

  // Initialize detector versions collection
  initDetectorVersionsCollection(db)

  return db
}

export async function getInsightsCollection(): Promise<Collection<Insight>> {
  const database = await getDb()
  return database.collection<Insight>('insights')
}

export async function getSignalsCollection(): Promise<Collection<Record<string, unknown>>> {
  const database = await getDb()
  const signals = database.collection<Record<string, unknown>>('signals')
  await signals.createIndex({ tenant_id: 1, signal_type: 1, created_at: -1 })
  await signals.createIndex({ signal_hash: 1 }, { unique: true })
  return signals
}

/** Returns tenant ids for the scheduler before tenant-scoped work begins. */
export async function findEnabledMomentumTenantIds(): Promise<string[]> {
  const database = await getDb()
  const configs = await database
    .collection<Record<string, unknown>>('tenant_settings')
    .find({ key: 'defensive_trend_strategy', 'value.strategy': 'momentum', 'value.enabled': true })
    .project({ tenant_id: 1 })
    .toArray()
  return configs.map((config) => String(config['tenant_id'] ?? '')).filter(Boolean)
}

export async function getReceiptsCollection(): Promise<Collection<ActionReceipt>> {
  const database = await getDb()
  const receipts = database.collection<ActionReceipt>('action_receipts')

  // Ensure indexes
  await receipts.createIndex({ tenant_id: 1 })
  await receipts.createIndex({ insight_id: 1 })
  await receipts.createIndex({ executed_at: -1 })
  await receipts.createIndex({ outcome: 1 })
  await receipts.createIndex({ tenant_id: 1, executed_at: -1 })
  // Idempotency key for per-action execution receipts (action-executor.ts):
  // payload_hash is derived from {insight_id, action_label, action_type}, so
  // re-executing the same insight (e.g. via POST /insights/:id/retry-execution)
  // can never double-dispatch an action that already succeeded.
  await receipts
    .createIndex({ tenant_id: 1, insight_id: 1, payload_hash: 1 }, { unique: true })
    .catch(() => {})

  return receipts
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close()
    client = null
    db = null
  }
}

/** Get the underlying MongoClient (for sharing across modules). */
export async function getMongoClient(): Promise<MongoClient> {
  if (!client) await getDb()
  return client!
}

// ── Raw collection accessors (allowed in this file per ADR-0065) ─────────────
// New modules MUST use these helpers instead of calling db.collection() directly.

export function getInviteCodesCollection(database: Db) {
  return database.collection<Record<string, unknown>>('invite_codes')
}

export function getPromoCodesCollection(database: Db) {
  return database.collection<Record<string, unknown>>('promo_codes')
}

export function getOutcomeEventsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('outcome_events')
}

export function getVerifiedMomentsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('verified_moments')
}

export function getOutcomeChargesCollection(database: Db) {
  return database.collection<Record<string, unknown>>('outcome_charges')
}

export function getPromoRedemptionsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('promo_redemptions')
}

export function getTenantsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('tenants')
}

export function getCreditLedgerCollection(database: Db) {
  return database.collection<Record<string, unknown>>('credit_ledger')
}

export function getCronLocksCollection(database: Db) {
  return database.collection<Record<string, unknown>>('cron_locks')
}

export function getFamilyGroupsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('family_groups')
}

// PRD-110: a join request exists before the requester has any tenant
// context (they aren't authenticated yet), so it's looked up directly by
// id/tenant_id rather than through the tenant-scoped wrapper — same
// reasoning as family_groups' own raw accessor above.
export function getFamilyJoinRequestsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('family_join_requests')
}

// PRD-123: same reasoning as join requests — an invite is resolved by its
// bearer token before the acceptor has any tenant context, so the accessor
// is raw (unscoped) rather than tenant-wrapped.
export function getFamilyMemberInvitesCollection(database: Db) {
  return database.collection<Record<string, unknown>>('family_member_invites')
}

export function getFamilyFinancialProfileCollection(database: Db) {
  return database.collection<Record<string, unknown>>('family_financial_profile')
}

// PRD-127: persisted member-agent nudges. Raw (unscoped) accessor because
// the daily agent loop iterates every tenant — routes still filter by
// tenant_id + member_id on every read/write.
export function getMemberNudgesCollection(database: Db) {
  return database.collection<Record<string, unknown>>('member_nudges')
}

// PRD-130: one doc per tenant holding the continuity switch's phase
// (watching → check-in sent → alerted) so the daily job is idempotent
// across replicas and restarts.
export function getFamilyContinuityStateCollection(database: Db) {
  return database.collection<Record<string, unknown>>('family_continuity_state')
}

// PRD-131: tenant-scoped ledger of declared income/expense entries — the
// substrate a live feed writes into later.
export function getFamilyCashflowCollection(database: Db) {
  return database.collection<Record<string, unknown>>('family_cashflow_entries')
}

export function getGrowthEventsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('growth_events')
}

// Security telemetry — one doc per /auth/login outcome (success and every
// failure mode). IPs and user agents live here for operator review; the
// collection is TTL-bounded (30 days, indexes ensured in getDb above).
export function getLoginEventsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('login_events')
}

// PRD-111: one doc per tenant tracking whether an unreported-life-change
// nudge is currently active. `reason` is written for the audit log only —
// no route ever returns it, so the frontend has no way to leak a guess
// about what changed even by accident.
export function getLifeChangeNudgeStateCollection(database: Db) {
  return database.collection<{
    tenant_id: string
    active: boolean
    reason?: string
    triggered_at?: Date
  }>('family_life_change_nudge_state')
}

// PRD-112: one referral code per tenant (the referrer's own shareable
// link), and one `referrals` doc per attributed signup (the referee).
// Kept as two collections rather than one, mirroring family_groups vs
// family_join_requests above — a code exists before any signup uses it,
// a referral only exists once one does.
export function getReferralCodesCollection(database: Db) {
  return database.collection<Record<string, unknown>>('referral_codes')
}

export function getReferralsCollection(database: Db) {
  return database.collection<Record<string, unknown>>('referrals')
}

export async function ensureOutcomeIndexes(database: Db): Promise<void> {
  await Promise.all([
    getOutcomeEventsCollection(database)
      .createIndex({ tenant_id: 1, goal_id: 1, kpi_metric: 1, measured_at: -1 })
      .catch(() => {}),
    getOutcomeEventsCollection(database)
      .createIndex({ tenant_id: 1, verified_moment_id: 1 }, { unique: true })
      .catch(() => {}),
    getVerifiedMomentsCollection(database)
      .createIndex({ tenant_id: 1, goal_id: 1, kpi_metric: 1, status: 1, created_at: -1 })
      .catch(() => {}),
  ])
}
