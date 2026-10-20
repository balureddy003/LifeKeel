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
import { load as loadYaml } from 'js-yaml'

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

// Tenant-scoped collections the account-deletion handler is KNOWN to miss.
// The 2026-10 audit list was closed out (every entry moved into the wipe
// or classified exempt); the set remains as the mechanism for documenting
// any future gap pending a named fix. An entry must (a) be a real
// collection found in code, and (b) NOT already be in the wipe — the test
// fails on stale or dishonest entries.
const KNOWN_ERASURE_GAPS = new Set<string>([])

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
  'operator_dual_approvals',
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
  // allowFederatedWarmStart (intent 06) until governance exists
  'federated_global_models',
  // GridFS buckets — emptied via bucket.delete() in the deletion path
  'documents.files',
  'documents.chunks',
  // registry doc is tombstoned status:'deleted', not removed — the marker
  // is what makes outstanding stateless JWTs die on the next request
  'tenants',
  // shared platform prompt definitions keyed by id — not tenant data
  'prompt_versions',
  // eval artifacts written under synthetic `eval_*` tenant ids — not real
  // tenant data
  'detector_eval_baselines',
  // unified eval-run lineage (B13): dataset hashes, metrics, verdicts —
  // no family content
  'eval_runs',
  // detector-level aggregate metrics (precision/recall per detector) — no
  // per-tenant key or family content by design
  'feature_hash_eval_reports',
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

// The deletion list, extracted statically from erasure.ts (the shared wipe
// module) so this test stays a pure tripwire with no module side effects.
function deletableCollections(): string[] {
  const src = readSrc('apps/api/src/erasure.ts')
  const m = src.match(/DELETABLE_COLLECTIONS\s*=\s*\[([\s\S]*?)\]\s*as const/)
  if (!m) return []
  return [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((g) => g[1]!)
}

// Collections wiped via CUSTOM_DELETES' per-collection filters instead of
// the default tenant_id deleteMany.
function customDeletedCollections(): string[] {
  const src = readSrc('apps/api/src/erasure.ts')
  const m = src.match(/CUSTOM_DELETES[^=]*=\s*[\s\S]*?\n\]\s*\n/)
  if (!m) return []
  return [...m[0].matchAll(/collection:\s*'([a-z_]+)'/g)].map((g) => g[1]!)
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
  const customDeleted = new Set(customDeletedCollections())

  it('DELETABLE_COLLECTIONS and CUSTOM_DELETES were extracted from erasure.ts', () => {
    expect(deletable.size).toBeGreaterThan(20)
    expect(customDeleted.size).toBeGreaterThan(0)
  })

  it('delete lists, gap list, and exempt list are all disjoint', () => {
    for (const name of deletable) {
      expect(
        KNOWN_ERASURE_GAPS.has(name),
        `'${name}' is deleted AND listed as a gap — remove it from KNOWN_ERASURE_GAPS`,
      ).toBe(false)
      expect(
        EXEMPT_COLLECTIONS.has(name),
        `'${name}' is deleted AND listed as exempt — fix the catalogue`,
      ).toBe(false)
      expect(
        customDeleted.has(name),
        `'${name}' has a custom filter AND sits in the default wipe — pick one`,
      ).toBe(false)
    }
    for (const name of customDeleted) {
      expect(KNOWN_ERASURE_GAPS.has(name)).toBe(false)
      expect(EXEMPT_COLLECTIONS.has(name)).toBe(false)
    }
  })

  it('every collection referenced in code is classified: deletable, custom-deleted, known gap, or exempt', () => {
    const classified = new Set<string>([
      ...deletable,
      ...customDeleted,
      ...KNOWN_ERASURE_GAPS,
      ...EXEMPT_COLLECTIONS,
    ])
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

  it('signed-link approve requires a same-tenant session — the bearer link cannot dispatch alone', () => {
    const src = readSrc('apps/api/src/routes/insights.ts')
    // Intent 02: POST /a/:token approve must check authContext against the
    // token's tenant; removing this silently restores unauthenticated
    // external dispatch.
    expect(src).toContain('ctx.tenant_id !== decoded.tenant_id')
    expect(src).toContain('isOriginAllowedForCookieAuth')
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

/* ------------------------------------------------------------------ */
/* Claim 5: erasure is durable across restores (intent 04/05)           */
/* ------------------------------------------------------------------ */

describe('architecture claims: erasure survives backup restore', () => {
  it('erasure-replay is scheduled daily and re-wipes tombstoned tenants', () => {
    expect(readSrc('apps/api/src/server.ts')).toContain("'erasure-replay'")
    const job = readSrc('apps/api/src/jobs/erasure-replay.ts')
    // The replay keys on the durable marker — the tenants tombstone that
    // restore.sh re-applies after a --drop restore.
    expect(job).toContain("status: 'deleted'")
    expect(job).toContain('eraseTenantData')
  })

  it('the shared eraseTenantData wipe is what the delete route and the replay both call', () => {
    expect(readSrc('apps/api/src/routes/account.ts')).toContain('eraseTenantData')
    expect(readSrc('apps/api/src/erasure.ts')).toContain('export async function eraseTenantData')
  })

  it('restore.sh preserves tombstones across a --drop restore', () => {
    const src = readSrc('scripts/ops/restore.sh')
    // Without this, a stale backup un-deletes accounts: the restored
    // tenants row carries status:'active' and replay finds nothing.
    expect(src).toContain("status: 'deleted'")
    expect(src).toContain('tombstoned tenant_ids')
  })
})

/* ------------------------------------------------------------------ */
/* Claim 6: queue durability + migration deploy gate (intent 07/08)     */
/* ------------------------------------------------------------------ */

describe('architecture claims: queue durability and migration gate', () => {
  it('durable queues fail closed in production — no silent in-memory fallback', () => {
    const src = readSrc('apps/api/src/queue/QueueManager.ts')
    // QUEUE_MODE=required is the production default; removing it restores
    // the inline fallback that loses buffered jobs on crash.
    expect(src).toContain('QueueUnavailableError')
    expect(src).toContain('allowInline')
    expect(src).toMatch(/'dev'\s*\|\|\s*deploymentConfig\.mode === 'airgap'/)
  })

  it('processing-list recovery is visibility-lease aware, not blind', () => {
    const src = readSrc('apps/api/src/queue/QueueManager.ts')
    // Pre-lease recovery requeued every :processing entry on subscribe —
    // including a live replica's in-flight job.
    expect(src).toContain('recoverStrandedJobs')
    expect(src).toContain('lease:')
  })

  it('migration failure fails boot outside dev', () => {
    const src = readSrc('apps/api/src/server.ts')
    expect(src).toContain("deploymentConfig.mode !== 'dev'")
    expect(src).not.toContain("'Database migration failed — starting anyway'")
  })

  it('/health/ready reports real migration and index state — the canary gate', () => {
    const src = readSrc('apps/api/src/server.ts')
    expect(src).toContain('pendingMigrations')
    expect(src).toContain('verifyCriticalIndexes')
    expect(src).toContain('migration_pending')
    // The env-var stand-in never reflected the real ledger.
    expect(src).not.toContain("process.env['MIGRATION_VERSION']")
  })

  it('Prometheus labels never carry tenant_id (B13)', () => {
    const src = readSrc('apps/api/src/routes/metrics.ts')
    // tenant_id was a Prometheus label on seven series — unbounded
    // cardinality plus the tenant roster leaking into metrics infra.
    for (const m of src.matchAll(/labelNames:\s*\[([^\]]*)\]/g)) {
      expect(m[1]).not.toContain('tenant_id')
    }
  })

  it('credential and vault writes go through the per-tenant DEK envelope (B4)', () => {
    // New ciphertexts must bind to a tenant DEK — the raw global-key helpers
    // (encryptIfNeeded/encryptBuffer) may only appear on the decrypt/legacy
    // path inside envelope.ts itself.
    for (const rel of [
      'apps/api/src/routes/connector-credentials.ts',
      'apps/api/src/routes/family-connectors.ts',
      'apps/api/src/routes/marketing-posts.ts',
      'apps/api/src/jobs/email-scan.ts',
    ]) {
      const src = readSrc(rel)
      expect(src, `${rel} still uses global-key writes`).not.toContain('encryptIfNeeded(')
    }
    expect(readSrc('apps/api/src/routes/vault.ts')).not.toContain('encryptBuffer(')
    // Crypto-shredding is real: erasure wipes tenant_keys, orphaning every
    // dek:-format ciphertext for the tenant.
    expect(deletableCollections()).toContain('tenant_keys')
  })

  it('red-team fixture suite is wired into CI and records lineage', () => {
    const src = readSrc('apps/api/src/__tests__/red-team.test.ts')
    expect(src).toContain('guard-fixtures.yaml')
    expect(src).toContain('recordEvalRun')
    // A fixture asserting event 'none' documents a KNOWN miss — the suite
    // must require known_gap: true for those, else a fake "coverage" claim.
    expect(src).toContain('known_gap')
    expect(existsSync(join(REPO_ROOT, 'red-team', 'guard-fixtures.yaml'))).toBe(true)
  })
})

describe('architecture claims: service-role split (B7)', () => {
  it('every cron schedule and queue consumer lives inside the SERVICE_ROLE gate', () => {
    const src = readSrc('apps/api/src/server.ts')
    const open = src.indexOf('if (runBackgroundWork) {')
    const close = src.indexOf('} // end runBackgroundWork')
    expect(open).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(open)
    const gated = src.slice(open, close)
    // No timer or consumer may be registered outside the gated region —
    // an api-role process must run zero background work.
    expect(src.slice(0, open)).not.toContain('cron.schedule(')
    expect(src.slice(close)).not.toContain('cron.schedule(')
    expect(src.slice(close)).not.toContain('.subscribe(')
    expect(gated).toContain('cron.schedule(')
    expect(gated).toContain('.subscribe(')
  })

  it('the queue connection stays role-agnostic — api publishes, jobs consumes', () => {
    const src = readSrc('apps/api/src/server.ts')
    const open = src.indexOf('if (runBackgroundWork) {')
    expect(src.slice(0, open)).toContain('queueManager.connect()')
  })
})

describe('architecture claims: social provider gateway (B12)', () => {
  it('channel adapters never call raw fetch — every call crosses the gateway', () => {
    const src = readSrc('apps/api/src/marketing/social-publisher.ts')
    // Direct fetch would bypass deadline/retry/breaker/idempotency.
    expect(src).not.toMatch(/[^a-zA-Z.]fetch\(/)
    expect(src).toContain('providerFetch(')
  })

  it('integration ids bind dispatch to a credential source — no silent env fallback', () => {
    const src = readSrc('apps/api/src/marketing/social-publisher.ts')
    expect(src).toContain('parseIntegrationId')
    // An explicit :connection id must throw rather than post as the
    // platform account.
    expect(src).toMatch(/wanted\.source === 'connection'[\s\S]{0,400}channel_not_configured/)
  })

  it('published posts record which account dispatched them', () => {
    const posts = readSrc('apps/api/src/routes/marketing-posts.ts')
    expect(posts).toContain('published_via')
    // The post id is the dispatch idempotency key.
    expect(posts).toContain('idempotencyKey: post.id')
  })
})

describe('architecture claims: AI bill of materials (B14)', () => {
  it('ai-bom.yaml pins an immutable artifact for every model and base image', () => {
    const bom = loadYaml(readFileSync(join(REPO_ROOT, 'ai-bom.yaml'), 'utf8')) as {
      artifacts: {
        id: string
        kind: string
        pin: { kind: string; value: string }
        card?: string
        data_boundary?: string
      }[]
    }
    expect(bom.artifacts.length).toBeGreaterThanOrEqual(4)
    for (const a of bom.artifacts) {
      expect(['oci-manifest-digest', 'hf-revision', 'docker-content-digest']).toContain(a.pin.kind)
      // Mutable references (tags, `main`) never satisfy a pin.
      expect(a.pin.value).toMatch(/^sha256:[0-9a-f]{64}$|^[0-9a-f]{40}$/)
      if (a.kind === 'model') {
        expect(a.card).toBeTruthy()
        expect(existsSync(join(REPO_ROOT, a.card!))).toBe(true)
        expect(a.data_boundary).toBeTruthy()
      }
    }
  })

  it('the code and Dockerfile pins match the BOM — no drift between them', () => {
    const bom = loadYaml(readFileSync(join(REPO_ROOT, 'ai-bom.yaml'), 'utf8')) as {
      artifacts: { id: string; pin: { value: string } }[]
    }
    const pin = (id: string) => bom.artifacts.find((a) => a.id === id)?.pin.value ?? ''

    const embed = readSrc('packages/platform/src/memory/LocalEmbeddingProvider.ts')
    expect(embed).toContain(`DEFAULT_LOCAL_EMBEDDING_REVISION = '${pin('local-embedding-model')}'`)
    // The revision is actually passed to the loader, not just declared.
    expect(embed).toContain('revision: this.revision')

    const judge = readFileSync(join(REPO_ROOT, 'infra/local-judge/Dockerfile'), 'utf8')
    expect(judge).toContain(`MODEL_DIGEST=${pin('local-judge-model').replace('sha256:', '')}`)
    expect(judge).toContain(`ollama/ollama:0.35.0@${pin('local-judge-base-image')}`)

    const encoder = readFileSync(join(REPO_ROOT, 'infra/encoder-service/Dockerfile'), 'utf8')
    expect(encoder).toContain(`ENCODER_MODEL_REVISION=${pin('encoder-model')}`)
    expect(encoder).toContain(`python:3.11-slim@${pin('encoder-base-image')}`)

    const server = readFileSync(join(REPO_ROOT, 'infra/encoder-service/server.py'), 'utf8')
    expect(server).toContain('revision=MODEL_REVISION')
  })
})
