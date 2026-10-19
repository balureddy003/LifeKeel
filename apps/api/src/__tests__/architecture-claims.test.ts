/**
 * ARCHITECTURE-CLAIMS FITNESS TEST (intent 00 / remediation plan Stage 0)
 *
 * ARCHITECTURE.md makes "Implemented" claims that have already drifted from
 * the code in half a dozen places (dead OTel init, CSP-blocked WebLLM,
 * unenforced processor terms, stale gap-register rows). These checks are
 * static tripwires: each one fails if the claim silently regresses, forcing
 * the claim — or the code — to be corrected in the same PR.
 *
 * Like trust-tier-gate.test.ts, these are tripwires, not proof. They catch
 * "the control exists" — not "the control is correct."
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const API_SRC = resolve(__dirname, '..')
const REPO_ROOT = resolve(__dirname, '../../../..')
const SKIP_DIRS = new Set(['__tests__', '__fixtures__', 'node_modules', 'dist', '.next'])

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) yield* sourceFiles(p)
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) yield p
  }
}

function readSrc(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

/* ------------------------------------------------------------------ */
/* Claim 1: every tenant-scoped collection is classified for erasure    */
/*                                                                     */
/* The catalogue below is intentionally exhaustive — adding a collection */
/* without classifying it fails this test, which forces the GDPR        */
/* question into review before the data exists.                          */
/* ------------------------------------------------------------------ */

// Tenant-scoped collections the account-deletion handler DOES NOT yet
// wipe — the documented A4/intent-04 remediation list. When a collection
// is added to DELETABLE_COLLECTIONS in routes/account.ts, remove it here:
// this test fails on stale gap entries as well as unclassified collections.
const KNOWN_ERASURE_GAPS = new Set([
  // --- family-authored data the family product writes ---
  'events', // domain event log (tenant_id indexed)
  'family_assets',
  'family_cashflow_entries',
  'family_scenarios',
  'family_continuity_state',
  'family_join_requests',
  'family_member_invites',
  'family_life_change_nudge_state',
  'feed_mutes',
  'heartbeat_sends',
  'insight_attribution',
  'legacy_contacts',
  'legacy_documents',
  'legacy_notes',
  'member_nudges',
  'readiness_events',
  'external_accounts',
  'pending_trades',
  'tenants', // tenant registry doc — verify closure path
  // --- AI-derived / ML artifacts ---
  'adaptive_thresholds',
  'adwin_states',
  'calibration_alerts',
  'calibration_ece_history',
  'calibration_jobs',
  'calibration_params',
  'causal_experiments',
  'change_point_state',
  'cusum_states',
  'detector_eval_baselines',
  'exp_smoother_states',
  'feature_hash_eval_reports',
  'feature_hash_model_versions',
  'feature_hash_models',
  'intent_centroids',
  'llm_cache',
  'llm_guard_events',
  'llm_spans',
  'llm_usage',
  'novelty_sketches',
  'novelty_tracker',
  'outcome_attributions',
  'prompt_versions',
  'raw_events',
  'skill_opt_history',
  'skill_rejection_memory',
  'tenant_level_models',
  'workflow_approvals',
  // --- connector + pipeline state ---
  'connector_health_dedup',
  'connector_sync_state',
  'email_classify_failures',
  // --- growth/operator surfaces keyed to tenant or member ---
  'growth_events',
  'lifecycle_sends',
  'marketing_posts',
  'referral_codes',
  'referrals',
  'social_connections',
  'support_cases',
])

// Platform/audit/global collections that are intentionally NOT in the
// per-tenant wipe, with the reason each is exempt. Membership in this set
// is a decision — keep the reason accurate.
const EXEMPT_COLLECTIONS = new Set([
  // audit + security trail (7-yr retention stated in account.ts header)
  'audit_log',
  'operator_audit_log',
  'login_events',
  // operator control plane
  'operator_alerts',
  'operator_digests',
  'platform_operators',
  'platform_config',
  'platform_config_history',
  // infra state (not family data)
  'cron_locks',
  'migrations',
  'metrics_daily',
  'system_events',
  'infra_cost_snapshots',
  'judge_shadow_results',
  'tenant_usage',
  // billing/financial record (retained as the ledger of what happened)
  'credit_ledger',
  'outcome_charges',
  'stripe_webhook_events',
  // commercial plane (pre-signup/operator-scoped; lead emails handled by
  // the lead-suppression path, not account deletion)
  'campaigns',
  'case_studies',
  'blog_posts',
  'groups',
  'invite_codes',
  'leads',
  'promo_codes',
  'promo_rate_limits',
  'promo_redemptions',
  // shared platform assets (not tenant-authored)
  'detectors',
  'detector_versions',
  'skill_templates',
  'autopilot_actions',
  'autopilot_rules',
  'workflow_runs',
  // global aggregate — not per-tenant deletable; warm-start gated by
  // enableFederatedWarmStart (intent 06) until governance exists
  'federated_global_models',
  // GridFS buckets — emptied via bucket.delete() in the deletion path
  'documents.files',
  'documents.chunks',
])

// Collection-name literals at known access patterns. Kept deliberately
// narrow (three helpers + db.collection) rather than "every quoted
// identifier" so a random string can't masquerade as a collection.
const COLLECTION_PATTERNS = [
  /\.collection\s*(?:<[\s\S]*?>)?\s*\(\s*'([a-z][a-z0-9_.]*)'/g,
  /getTenantCollection\s*(?:<[\s\S]*?>)?\s*\([^,]+,\s*'([a-z][a-z0-9_.]*)'/g,
  /(?:readAll|safeFind|safeInsert|safeUpdate|safeCount|safeAggregate)\s*\([^,]+,[^,]+,\s*'([a-z][a-z0-9_.]*)'/g,
]

function collectionsInSource(root: string): Set<string> {
  const names = new Set<string>()
  for (const file of sourceFiles(root)) {
    const src = readFileSync(file, 'utf8')
    for (const re of COLLECTION_PATTERNS) {
      re.lastIndex = 0
      for (let m = re.exec(src); m; m = re.exec(src)) names.add(m[1]!)
    }
  }
  return names
}

// The deletion list, extracted statically from account.ts so this test
// stays a pure tripwire with no module side effects.
function deletableCollections(): string[] {
  const src = readSrc('apps/api/src/routes/account.ts')
  const m = src.match(/DELETABLE_COLLECTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!m) return []
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((g) => g[1]!)
}

describe('architecture claims: account erasure coverage', () => {
  const scanRoots = [
    API_SRC,
    ...readdirSync(resolve(REPO_ROOT, 'packages'))
      .map((p) => resolve(REPO_ROOT, 'packages', p, 'src'))
      .filter(existsSync),
  ]
  const found = new Set<string>()
  for (const root of scanRoots) for (const n of collectionsInSource(root)) found.add(n)
  const deletable = new Set(deletableCollections())

  it('DELETABLE_COLLECTIONS was extracted from account.ts', () => {
    expect(deletable.size).toBeGreaterThan(20)
  })

  it('DELETABLE_COLLECTIONS and the gap list are disjoint', () => {
    for (const name of deletable) {
      expect(
        KNOWN_ERASURE_GAPS.has(name),
        `'${name}' is deleted AND listed as a gap — remove it from KNOWN_ERASURE_GAPS`,
      ).toBe(false)
      expect(
        EXEMPT_COLLECTIONS.has(name),
        `'${name}' is deleted AND listed as exempt — fix the catalogue`,
      ).toBe(false)
    }
  })

  it('every collection referenced in code is classified: deletable, known gap, or exempt', () => {
    const classified = new Set<string>([...deletable, ...KNOWN_ERASURE_GAPS, ...EXEMPT_COLLECTIONS])
    const unclassified = [...found].filter((n) => !classified.has(n)).sort()
    expect(
      unclassified,
      'new collection(s) found — classify each in the erasure catalogue in architecture-claims.test.ts',
    ).toEqual([])
  })

  it('known gaps are real collections still present in code (no stale entries)', () => {
    const stale = [...KNOWN_ERASURE_GAPS].filter((n) => !found.has(n)).sort()
    expect(stale, 'gap entries no longer referenced in code — remove or verify them').toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Claim 2: federated/global scorer warm-start is gated (intent 06)     */
/* ------------------------------------------------------------------ */

describe('architecture claims: no ungoverned cross-tenant model influence', () => {
  for (const rel of [
    'packages/engine/src/scoring/feature-hash-scorer.ts',
    'packages/engine/src/scoring/tenant-level-scorer.ts',
  ]) {
    it(`${rel} requires the allowFederatedWarmStart opt-in before reading federated_global_models`, () => {
      const src = readSrc(rel)
      const guard = 'if (!this.allowFederatedWarmStart) return false'
      const read = "collection('federated_global_models')"
      expect(src, 'governed opt-in flag missing').toContain('allowFederatedWarmStart')
      expect(src, 'warm-start guard missing').toContain(guard)
      // The guard must appear before the global-artifact read it protects.
      const g = src.indexOf(guard),
        r = src.indexOf(read)
      expect(g, 'federated_global_models read is not guarded').toBeGreaterThanOrEqual(0)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(g).toBeLessThan(r)
    })
  }

  it('feature-hash-eval evaluates per tenant instead of pooling across tenants', () => {
    const src = readSrc('apps/api/src/jobs/feature-hash-eval.ts')
    expect(src).toContain("distinct('tenant_id'")
    expect(src).toMatch(/\.find\(\s*\{[\s\S]{0,200}tenant_id: tenantId/)
    // A pooled find ({ detector_id, state } with no tenant filter) is the
    // original cross-tenant shape — it must not come back.
    expect(src).not.toMatch(/\.find\(\s*\{\s*detector_id[^}]*\}\s*\)/)
  })
})

/* ------------------------------------------------------------------ */
/* Claim 3: auth + delivery hardening actually shipped (intent 02/10)   */
/* ------------------------------------------------------------------ */

describe('architecture claims: session, login, and signed-link hardening', () => {
  it('session-cookie does not unconditionally trust localhost origins', () => {
    const src = readSrc('apps/api/src/auth/session-cookie.ts')
    // In cloud/accountant (production) deployment modes DEV_ORIGINS must be
    // empty — localhost on the SameSite=None boundary is a CSRF hole.
    expect(src).toMatch(/DEV_ORIGINS\s*=\s*IS_CLOUD\s*\?\s*\[\]/)
  })

  it('login route carries a route-level rate limit', () => {
    const src = readSrc('apps/api/src/routes/auth-users.ts')
    expect(src).toMatch(/post[\s\S]{0,100}'\/auth\/login'[\s\S]{0,300}rateLimit\s*:/)
  })

  it('delivery signing has no weak secret fallback — missing secret fails closed', () => {
    const src = readSrc('apps/api/src/delivery/delivery-router.ts')
    expect(src).not.toContain('change-me')
    expect(src).toMatch(/throw new Error\(\s*['"`]DELIVERY_SIGNING_SECRET/)
  })

  it('action receipts persist the approving actor', () => {
    const executor = readSrc('apps/api/src/actions/action-executor.ts')
    expect(executor).toContain('approved_by')
    expect(executor).toContain('approved_via')
    expect(readSrc('packages/workflows/src/types.ts')).toMatch(/approved_via\?:/)
  })
})

/* ------------------------------------------------------------------ */
/* Claim 4: shipped features are actually deliverable (intent 10)       */
/* ------------------------------------------------------------------ */

describe('architecture claims: production deliverability', () => {
  it('firebase.json CSP permits the on-device LLM feature it ships', () => {
    const conf = JSON.parse(readSrc('apps/web/firebase.json')) as {
      hosting: { headers: { headers: { key: string; value: string }[] }[] }[]
    }
    const targets = Array.isArray(conf.hosting) ? conf.hosting : [conf.hosting]
    for (const target of targets) {
      const csps = target.headers
        .flatMap((h) => h.headers)
        .filter((h) => h.key === 'Content-Security-Policy')
        .map((h) => h.value)
      for (const csp of csps) {
        expect(csp).toContain('huggingface.co') // model download
        expect(csp).toContain('wasm-unsafe-eval') // wasm compile
      }
    }
  })

  it('llm.ts contains no console.log debugging (one previously logged generated content)', () => {
    expect(readSrc('packages/platform/src/llm.ts')).not.toContain('console.log')
  })

  it('key registry fails closed once versioned keys exist', () => {
    expect(readSrc('packages/platform/src/key-registry.ts')).toContain('hasVersionedKeys')
  })
})
