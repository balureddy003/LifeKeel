/**
 * Tenant data erasure — the shared wipe used by POST /account/delete,
 * the erasure-replay cron job, and the post-restore reconciliation step.
 *
 * Collections holding tenant-tagged family data, wiped on delete. Anything
 * tenant-scoped the family product writes must be in DELETABLE_COLLECTIONS —
 * internal ML/billing/platform collections are intentionally not (see the
 * account.ts header for the audit/billing retention rationale).
 *
 * Exported so the architecture-claims fitness test can keep this list in
 * sync with the tenant-scoped collection catalogue.
 *
 * Every entry must be keyed by a top-level `tenant_id` field — the wipe is
 * deleteMany({ tenant_id }). Collections keyed differently live in
 * CUSTOM_DELETES below instead.
 */
import type { Db } from 'mongodb'
import {
  countTenantGridfs,
  deleteTenantGridfs,
  deleteTenantVaultObjects,
} from './documents/storage.js'
import { purgeTenantObjects } from './documents/deletion.js'
import { hasCredential } from './documents/r2.js'

export const DELETABLE_COLLECTIONS = [
  // ── identity + family-authored data ──
  'users',
  'family_groups',
  'family_financial_profile',
  'freshness_state', // PRD-145
  'extraction_candidates', // PRD-143
  'profile_provenance', // PRD-143
  'notification_ledger', // PRD-139
  'push_failures', // PRD-140
  'perceived_protection', // PRD-141
  'value_events', // PRD-141
  'readiness_quiz_snapshots', // PRD-203: saved quiz results
  'family_readiness_history', // quiz saves now seed it before a profile exists
  'documents',
  'family_assets',
  'family_cashflow_entries',
  'family_scenarios',
  'household_briefs', // PRD-222
  'household_obligations', // PRD-231 — entered obligations map rows
  'employer_cover_facts', // PRD-232 — household-entered cover facts
  'family_continuity_state',
  'rehearsal_records', // PRD-214 M3 — dated continuity rehearsals
  'life_change_calibration', // PRD-213 M4 — shadow-only drift-sentinel rows
  'family_join_requests',
  'family_member_invites',
  'family_invite_sends', // R43 daily invitation counter
  'oauth_pending_grants', // R37 parked connector grants (encrypted, 10-minute TTL)
  'otp_chains', // email OTP challenges (CLOUDFLARE_INTEGRATION.md §6.2.1)
  'document_tombstones', // fenced-delete markers (§7.7); the objects are purged below
  'tenant_quota', // storage reservations (§7.12)
  'family_life_change_nudge_state',
  'feed_mutes',
  'legacy_contacts',
  'legacy_documents',
  'legacy_notes',
  'member_nudges',
  // Keel inline agent: owner-scoped chat history, proposals and per-user prefs.
  'keel_threads',
  'keel_messages',
  'keel_proposals',
  'keel_preferences',
  'external_accounts',
  'pending_trades',
  // ── product state derived from the family ──
  'signals',
  'events',
  'insights',
  'insight_attribution',
  'goals',
  'goal_kpi_snapshots',
  'inbox_items',
  'readiness_events',
  'heartbeat_sends',
  'tenant_settings',
  'scope_contracts', // PRD-214 — earned-scope grant/collapse artifacts
  'connector_credentials',
  'action_receipts',
  'agent_memory',
  'verified_moments',
  'outcome_events',
  'delivery_preferences',
  'delivery_queue',
  'delivery_receipts',
  'digest_queue',
  'move_rewrite_queue',
  'manual_review_queue',
  'move_judge_verdicts',
  'reminders',
  'web_push_subscriptions',
  'mobile_push_tokens',
  // ── tenant-keyed growth/support surfaces ──
  'marketing_posts',
  'content_items',
  'content_bank', // standing approvals: per-tenant approved post texts
  'marketing_standing_policy', // standing approvals: per-tenant limits a human set
  'channel_profiles',
  'social_connections',
  'support_cases',
  'referral_codes',
  // ── connector + pipeline state ──
  'connector_sync_state',
  'connector_health_dedup',
  'email_classify_failures',
  // ── AI/ML artifacts derived from this tenant's data ──
  'llm_cache',
  'llm_spans',
  // Output-guard events can persist tenant_id 'unknown' until the guard
  // telemetry attribution bug is fixed — those rows are unattributable
  // and out of erasure reach by definition.
  'llm_guard_events',
  'llm_usage',
  // Unified spend ledger (B8) — tenant-attributed spend telemetry.
  'spend_events',
  'feature_hash_models',
  'feature_hash_model_versions',
  'tenant_level_models',
  'calibration_params',
  'calibration_jobs',
  'calibration_alerts',
  'calibration_ece_history',
  'outcome_attributions',
  'adaptive_thresholds',
  'adwin_states',
  'cusum_states',
  'exp_smoother_states',
  'change_point_state',
  'causal_experiments',
  'intent_centroids',
  'novelty_tracker',
  'novelty_sketches',
  'raw_events',
  'skill_opt_history',
  'skill_rejection_memory',
  'workflow_approvals',
  // Per-tenant envelope keys (B4) — wiping these is the crypto-shred: every
  // dek:-format ciphertext for the tenant becomes permanently undecryptable.
  'tenant_keys',
  // Daily read-only check of each connected social API (ok / error text only).
  'channel_checks',
] as const

// Tenant-tagged collections whose key is NOT a top-level `tenant_id`.
// The filter is resolved per-delete from context gathered BEFORE the wipe
// (deleting `users` first would orphan the lookups these need).
export const CUSTOM_DELETES: ReadonlyArray<{
  collection: string
  filter: (ctx: {
    tenantId: string
    userIds: string[]
    userEmails: string[]
  }) => Record<string, unknown>
}> = [
  // Growth funnel events store the tenant under meta.tenant_id.
  { collection: 'growth_events', filter: (c) => ({ 'meta.tenant_id': c.tenantId }) },
  // A referral touches two tenants — the referrer and the referee.
  {
    collection: 'referrals',
    filter: (c) => ({
      $or: [{ referred_tenant_id: c.tenantId }, { referrer_tenant_id: c.tenantId }],
    }),
  },
  // Lifecycle email ledger is keyed by recipient id (user or lead) and
  // carries the address — cover both shapes.
  {
    collection: 'lifecycle_sends',
    filter: (c) => ({ $or: [{ recipient: { $in: c.userIds } }, { email: { $in: c.userEmails } }] }),
  },
  // R19: a lead captured before signup is keyed by email only, not tenant.
  { collection: 'leads', filter: (c) => ({ email: { $in: c.userEmails } }) },
  // R19: sign-in telemetry links user id, email and IP for 30 days; an
  // erased account's rows go now rather than at TTL.
  {
    collection: 'login_events',
    filter: (c) => ({ $or: [{ user_id: { $in: c.userIds } }, { email: { $in: c.userEmails } }] }),
  },
  // Daily upload counters are keyed "<tenant_id>:<yyyymmdd>" (48 h TTL).
  {
    collection: 'tenant_quota_days',
    filter: (c) => ({ _id: { $regex: `^${escapeRegex(c.tenantId)}:` } }),
  },
  // Email-OTP send budgets are keyed "<user_id>:<window>", not by tenant.
  {
    collection: 'otp_send_windows',
    filter: (c) =>
      c.userIds.length === 0
        ? { _id: { $in: [] } }
        : { _id: { $regex: `^(${c.userIds.map(escapeRegex).join('|')}):` } },
  },
]

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')
}

/**
 * What a family would call each kind of data, for receipts. Collections not
 * listed fall under "other family data". Names only; a receipt never carries
 * content.
 */
export const ERASURE_CATEGORY: Record<string, string> = {
  users: 'account',
  family_groups: 'family roster',
  family_financial_profile: 'financial profile',
  documents: 'documents and what was read from them',
  'documents.files': 'documents and what was read from them',
  inbox_items: 'inbox summaries',
  insights: 'insights and alerts',
  signals: 'insights and alerts',
  events: 'insights and alerts',
  readiness_events: 'insights and alerts',
  connector_credentials: 'connected services',
  connector_sync_state: 'connected services',
  web_push_subscriptions: 'notification devices',
  mobile_push_tokens: 'notification devices',
  tenant_keys: 'encryption keys',
  agent_memory: 'AI working data',
  llm_cache: 'AI working data',
  llm_spans: 'AI working data',
  llm_usage: 'AI working data',
  llm_guard_events: 'AI working data',
  leads: 'marketing contact record',
  login_events: 'sign-in history',
}
export const OTHER_CATEGORY = 'other family data'
const categoryOf = (collection: string) => ERASURE_CATEGORY[collection] ?? OTHER_CATEGORY

export interface ErasureReport {
  removed: { category: string; count: number }[]
  /** Rows still present after the wipe, by category; empty when the check passed. */
  residual: { category: string; count: number }[]
}

const tally = (rows: { category: string; count: number }[]) => {
  const by = new Map<string, number>()
  for (const r of rows) by.set(r.category, (by.get(r.category) ?? 0) + r.count)
  return [...by].filter(([, n]) => n > 0).map(([category, count]) => ({ category, count }))
}

/**
 * Wipe every tenant-tagged collection for `tenantId` and report what went and
 * what, if anything, is still there. Safe to re-run: deletes are idempotent,
 * so this doubles as the resume path after a partial failure and the
 * post-restore replay for tombstoned tenants.
 */
export async function eraseTenantDataReport(db: Db, tenantId: string): Promise<ErasureReport> {
  // Resolve the keys non-standard collections are wiped by BEFORE any
  // deletion runs: lifecycle_sends is keyed by recipient/email, so the
  // tenant's user ids and addresses are needed while users still exist.
  const memberUsers = await db
    .collection('users')
    .find({ tenant_id: tenantId })
    .project({ id: 1, email: 1 })
    .toArray()
  const deleteCtx = {
    tenantId,
    userIds: memberUsers.map((u) => String(u['id'])),
    // Both spellings: users are stored lowercased, older lead rows may not be.
    userEmails: [
      ...new Set(
        memberUsers.flatMap((u) => [String(u['email']), String(u['email']).toLowerCase()]),
      ),
    ],
  }
  const removed: { category: string; count: number }[] = []

  // Document bytes go before the metadata rows below, so a partial failure
  // leaves orphaned metadata (harmless: unreferenced) rather than orphaned
  // bytes with no way to identify whose they were. GridFS blobs are keyed by
  // metadata.tenant_id; R2 objects by the `{tenant_id}/` prefix in all three
  // buckets (CLOUDFLARE_INTEGRATION.md §7.7). Workers and upload routes
  // refuse a tenant whose status is 'deleting', and the erasure-replay job
  // re-runs this wipe, which is the second pass for anything an unexpired
  // presigned URL wrote in between.
  removed.push({
    category: categoryOf('documents.files'),
    count: await deleteTenantGridfs(db, tenantId),
  })
  if (r2Configured()) {
    removed.push({
      category: categoryOf('documents.files'),
      count: await purgeTenantObjects(tenantId),
    })
    removed.push({
      category: categoryOf('documents.files'),
      count: await deleteTenantVaultObjects(tenantId),
    })
  }

  for (const d of CUSTOM_DELETES) {
    const r = await db.collection(d.collection).deleteMany(d.filter(deleteCtx))
    removed.push({ category: categoryOf(d.collection), count: r.deletedCount })
  }

  for (const name of DELETABLE_COLLECTIONS) {
    const r = await db.collection(name).deleteMany({ tenant_id: tenantId })
    removed.push({ category: categoryOf(name), count: r.deletedCount })
  }

  // Verify: count what is left in every place the wipe touched. A non-zero
  // result is reported, never hidden; the replay job retries it.
  const residual: { category: string; count: number }[] = []
  residual.push({
    category: categoryOf('documents.files'),
    count: await countTenantGridfs(db, tenantId),
  })
  for (const d of CUSTOM_DELETES) {
    residual.push({
      category: categoryOf(d.collection),
      count: await db.collection(d.collection).countDocuments(d.filter(deleteCtx)),
    })
  }
  for (const name of DELETABLE_COLLECTIONS) {
    residual.push({
      category: categoryOf(name),
      count: await db.collection(name).countDocuments({ tenant_id: tenantId }),
    })
  }
  return { removed: tally(removed), residual: tally(residual) }
}

/** R2 credentials present: R2 prefixes are part of the wipe. */
function r2Configured(): boolean {
  return hasCredential('delete') || hasCredential('presign') || hasCredential('vault')
}

/** The wipe without the report, for callers that only need it done (replay of tombstones). */
export async function eraseTenantData(db: Db, tenantId: string): Promise<void> {
  await eraseTenantDataReport(db, tenantId)
}
