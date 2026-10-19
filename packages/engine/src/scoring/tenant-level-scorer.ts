/**
 * Tenant-Level Scorer — Cross-signal online logistic regression.
 *
 * Learns patterns ACROSS detectors and signal types for the same entity.
 * The per-detector FeatureHashScorer only sees features from a single
 * triggering event. This scorer sees the full cross-signal context:
 *   "customer X had an overdue invoice AND a cart abandonment AND a
 *    payment failure" → predicts approval likelihood for the current
 *    insight, informed by what else is happening for that customer.
 *
 * Algorithm: Online logistic regression via the hashing trick (same as
 * FeatureHashScorer but with cross-signal features).
 *   - One model per tenant (not per detector)
 *   - O(features) per score/update
 *   - Fixed memory: 2^18 × 4 bytes = 1MB per tenant model
 *   - LRU eviction with configurable cap (default 200 tenants = ~200MB)
 *
 * Cross-signal features (built from recent insights for the same entity):
 *   - entity=<entity_key>                          (unigram)
 *   - signal_type=<current_signal_type>            (unigram)
 *   - detector=<current_detector_id>               (unigram)
 *   - recent_insight_count_7d=<bucket>             (how active is this entity)
 *   - recent_detector_diversity=<bucket>           (how many distinct detectors)
 *   - last_outcome=<approved|dismissed|none>       (what did the user do last)
 *   - active_signal_types=<comma-sorted-set>       (what's happening now)
 *   - has_overdue_invoice=<0|1>                    (cross-signal flag)
 *   - has_payment_failure=<0|1>                    (cross-signal flag)
 *   - has_cart_abandonment=<0|1>                   (cross-signal flag)
 *   - Bigrams: entity × recent_insight_count, etc.
 *
 * Training data source: action_receipts (approve/dismiss) — same as
 * FeatureHashScorer. On each approve/dismiss, the scorer builds the
 * cross-signal feature vector for the entity at that point in time and
 * does an SGD update.
 *
 * Inference: at evaluation time, the engine calls score() with the
 * current entity + recent insights, and injects the result into
 * EvaluationContext.tenant_level_score. Detectors can use it in
 * conditions: "context.tenant_level_score > 0.7"
 *
 * Usage:
 *   const scorer = new TenantLevelScorer(db)
 *   // At evaluation time:
 *   const score = await scorer.score(tenantId, entityKey, currentSignalType, recentInsights)
 *   // On approve/dismiss:
 *   await scorer.update(tenantId, entityKey, currentSignalType, recentInsights, outcome)
 */

// MongoDB structural type

type MongoDb = { collection: (name: string) => any }

// ── Constants ──────────────────────────────────────────────────────────────────
const HASH_BITS = 18
const HASH_SIZE = 1 << HASH_BITS
const DEFAULT_LR = 0.01
const BIGRAM_SEPARATOR = '×'

// ── MurmurHash3 (same as FeatureHashScorer — kept local) ──────────────────────
function murmurhash3(str: string, seed = 0): number {
  let h = seed >>> 0
  let k: number
  for (let i = 0; i < str.length; i++) {
    k = str.charCodeAt(i)
    k = Math.imul(k, 0xcc9e2d51)
    k = (k << 15) | (k >>> 17)
    k = Math.imul(k, 0x1b873593)
    h ^= k
    h = (h << 13) | (h >>> 19)
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0
  }
  h ^= str.length
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, x))))
}

// ── Types ──────────────────────────────────────────────────────────────────────

/** A recent insight for an entity — used to build cross-signal features. */
export interface RecentInsight {
  detector_id: string
  signal_type?: string
  state?: string // 'identified' | 'approved' | 'dismissed' | 'completed'
  created_at: Date
}

/** Result of scoring an entity with cross-signal context. */
export interface TenantLevelScoreResult {
  /** Sigmoid output 0–1 — probability that the current insight will be approved. */
  score: number
  /** Number of cross-signal features used. */
  feature_count: number
  /** The hashed token strings (for debugging/explainability). */
  tokens: string[]
}

export interface TenantLevelScorerOptions {
  /** Max tenant models in memory. Default: 200 (~200MB). */
  maxLoadedTenants?: number
  /**
   * Whether first-load may warm-start from the cross-tenant
   * `federated_global_models` artifact. Defaults to **false** — reading a
   * cross-tenant model is a governed opt-in decision (CLAUDE.md rule 3), not
   * a cold-start convenience.
   */
  allowFederatedWarmStart?: boolean
}

export interface TenantLevelScorerMetrics {
  onEviction?: (tenantId: string) => void
  onCacheHit?: (tenantId: string) => void
  onCacheMiss?: (tenantId: string) => void
}

// ── Cross-signal feature builder ──────────────────────────────────────────────

/**
 * Build the cross-signal feature tokens for an entity.
 *
 * @param entityKey The entity identifier (customer_id, ticker, goal_id, etc.)
 * @param currentSignalType The signal type of the current event being evaluated
 * @param currentDetectorId The detector that fired (if any)
 * @param recentInsights Recent insights for this entity (last 7 days)
 */
function buildCrossSignalTokens(
  entityKey: string,
  currentSignalType: string | undefined,
  currentDetectorId: string | undefined,
  recentInsights: RecentInsight[],
): string[] {
  const now = Date.now()
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
  const recent = recentInsights.filter((i) => now - i.created_at.getTime() < SEVEN_DAYS)

  const unigrams: string[] = []

  // Entity identity
  if (entityKey) unigrams.push(`entity=${entityKey}`)

  // Current signal context
  if (currentSignalType) unigrams.push(`signal_type=${currentSignalType}`)
  if (currentDetectorId) unigrams.push(`detector=${currentDetectorId}`)

  // Activity level — how many insights for this entity recently
  const insightCount = recent.length
  unigrams.push(`recent_insight_count_7d=${bucketCount(insightCount)}`)

  // Detector diversity — how many distinct detectors fired
  const distinctDetectors = new Set(recent.map((i) => i.detector_id))
  unigrams.push(`recent_detector_diversity=${bucketCount(distinctDetectors.size)}`)

  // Last outcome — what did the user do with the most recent insight?
  const sorted = [...recent].sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
  const lastOutcome = sorted[0]?.state ?? 'none'
  unigrams.push(`last_outcome=${lastOutcome}`)

  // Active signal types — what's happening for this entity (sorted, comma-joined)
  const signalTypes = [...new Set(recent.map((i) => i.signal_type).filter(Boolean))].sort()
  if (signalTypes.length > 0) {
    unigrams.push(`active_signal_types=${signalTypes.join(',')}`)
  }

  // Cross-signal flags — presence of specific signal types
  const signalSet = new Set(signalTypes)
  unigrams.push(`has_overdue_invoice=${signalSet.has('invoice.overdue') ? '1' : '0'}`)
  unigrams.push(`has_payment_failure=${signalSet.has('payment.failed') ? '1' : '0'}`)
  unigrams.push(`has_cart_abandonment=${signalSet.has('cart.abandoned') ? '1' : '0'}`)

  // Bigrams — pairwise interactions (capped at 10 features)
  const bigrams: string[] = []
  const cap = Math.min(unigrams.length, 10)
  for (let i = 0; i < cap; i++) {
    for (let j = i + 1; j < cap; j++) {
      bigrams.push(`${unigrams[i]}${BIGRAM_SEPARATOR}${unigrams[j]}`)
    }
  }

  return [...unigrams, ...bigrams]
}

/** Bucket a count into a small set of ordinal categories. */
function bucketCount(n: number): string {
  if (n === 0) return '0'
  if (n === 1) return '1'
  if (n <= 3) return '2-3'
  if (n <= 7) return '4-7'
  if (n <= 15) return '8-15'
  return '16+'
}

// ── TenantLevelScorer ─────────────────────────────────────────────────────────

export class TenantLevelScorer {
  private col: any
  private db: MongoDb
  /** In-memory weight vectors: tenantId → Float32Array */
  private weights = new Map<string, Float32Array>()
  /** Update counts: tenantId → number */
  private updateCounts = new Map<string, number>()
  /** Last-access logical clock — for LRU eviction. */
  private lastAccess = new Map<string, number>()
  private accessClock = 0
  private maxLoadedTenants: number
  private metrics: TenantLevelScorerMetrics | undefined
  /** See TenantLevelScorerOptions.allowFederatedWarmStart — default off. */
  private allowFederatedWarmStart: boolean

  constructor(
    db: MongoDb,
    options: TenantLevelScorerOptions = {},
    metrics?: TenantLevelScorerMetrics,
  ) {
    this.db = db
    this.col = db.collection('tenant_level_models')
    this.col.createIndex({ tenant_id: 1 }, { unique: true }).catch(() => {})
    this.maxLoadedTenants = options.maxLoadedTenants ?? 200
    this.allowFederatedWarmStart = options.allowFederatedWarmStart === true
    this.metrics = metrics
  }

  // ── Load / evict ────────────────────────────────────────────────────────────

  private async ensureLoaded(tenantId: string): Promise<void> {
    if (this.weights.has(tenantId)) {
      this.touch(tenantId)
      this.metrics?.onCacheHit?.(tenantId)
      return
    }
    this.metrics?.onCacheMiss?.(tenantId)
    if (this.weights.size >= this.maxLoadedTenants) {
      await this.evictLeastRecentlyUsed()
    }
    await this.load(tenantId)
    this.touch(tenantId)
  }

  private async load(tenantId: string): Promise<void> {
    const doc = (await this.col.findOne({ tenant_id: tenantId })) as {
      weights?: { buffer: ArrayBuffer } | Uint8Array
      update_count?: number
    } | null

    if (!doc?.weights) {
      // New tenant — try warm-start from the global federated model.
      // This gives new tenants the benefit of patterns learned across
      // all tenants, solving the cold-start problem.
      const warmed = await this.tryWarmStart(tenantId)
      if (!warmed) {
        this.weights.set(tenantId, new Float32Array(HASH_SIZE))
        this.updateCounts.set(tenantId, 0)
      }
    } else {
      const buf = doc.weights instanceof Uint8Array ? doc.weights.buffer : doc.weights.buffer
      this.weights.set(tenantId, new Float32Array(buf))
      this.updateCounts.set(tenantId, doc.update_count ?? 0)
    }
  }

  private touch(tenantId: string): void {
    this.lastAccess.set(tenantId, ++this.accessClock)
  }

  private async evictLeastRecentlyUsed(): Promise<void> {
    let lruTenant: string | null = null
    let lruTime = Infinity
    for (const [tid, time] of this.lastAccess) {
      if (time < lruTime) {
        lruTime = time
        lruTenant = tid
      }
    }
    if (!lruTenant) return

    // Flush pending updates before evicting
    const count = this.updateCounts.get(lruTenant) ?? 0
    if (count % 10 !== 0) {
      await this.persist(lruTenant).catch(() => {})
    }

    this.weights.delete(lruTenant)
    this.updateCounts.delete(lruTenant)
    this.lastAccess.delete(lruTenant)
    this.metrics?.onEviction?.(lruTenant)
  }

  /** Current number of tenant models in memory. */
  get loadedTenantCount(): number {
    return this.weights.size
  }

  // ── Score ───────────────────────────────────────────────────────────────────

  async score(
    tenantId: string,
    entityKey: string,
    currentSignalType: string | undefined,
    currentDetectorId: string | undefined,
    recentInsights: RecentInsight[],
  ): Promise<TenantLevelScoreResult> {
    await this.ensureLoaded(tenantId)
    const w = this.weights.get(tenantId)!
    const tokens = buildCrossSignalTokens(
      entityKey,
      currentSignalType,
      currentDetectorId,
      recentInsights,
    )

    let dot = 0
    for (const token of tokens) {
      dot += w[murmurhash3(token) % HASH_SIZE] ?? 0
    }

    const scoreVal = sigmoid(dot)
    return {
      score: Math.round(scoreVal * 10000) / 10000,
      feature_count: tokens.length,
      tokens,
    }
  }

  // ── Online SGD update ───────────────────────────────────────────────────────

  async update(
    tenantId: string,
    entityKey: string,
    currentSignalType: string | undefined,
    currentDetectorId: string | undefined,
    recentInsights: RecentInsight[],
    outcome: 0 | 1,
    lr?: number,
  ): Promise<void> {
    await this.ensureLoaded(tenantId)
    const w = this.weights.get(tenantId)!
    const tokens = buildCrossSignalTokens(
      entityKey,
      currentSignalType,
      currentDetectorId,
      recentInsights,
    )
    const effectiveLr = lr ?? DEFAULT_LR

    // Score current prediction
    let dot = 0
    for (const token of tokens) {
      dot += w[murmurhash3(token) % HASH_SIZE] ?? 0
    }
    const pred = sigmoid(dot)
    const error = outcome - pred

    // SGD update (light L2 regularization)
    const l2 = 0.0001
    for (const token of tokens) {
      const idx = murmurhash3(token) % HASH_SIZE
      const curr = w[idx] ?? 0
      w[idx] = curr + effectiveLr * error - l2 * curr
    }

    const count = (this.updateCounts.get(tenantId) ?? 0) + 1
    this.updateCounts.set(tenantId, count)

    // Persist every 10 updates
    if (count % 10 === 0) {
      await this.persist(tenantId)
    }
  }

  // ── Persist / flush ─────────────────────────────────────────────────────────

  private async persist(tenantId: string): Promise<void> {
    const w = this.weights.get(tenantId)
    if (!w) return
    const weightsCopy = new Float32Array(w)
    await this.col.replaceOne(
      { tenant_id: tenantId },
      {
        tenant_id: tenantId,
        weights: Buffer.from(weightsCopy.buffer),
        update_count: this.updateCounts.get(tenantId) ?? 0,
        last_updated_at: new Date(),
      },
      { upsert: true },
    )
  }

  async flush(tenantId: string): Promise<void> {
    await this.persist(tenantId)
  }

  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const tenantId of this.weights.keys()) {
      promises.push(this.persist(tenantId))
    }
    await Promise.all(promises)
  }

  /** Evict a tenant's model from memory (e.g. on offboarding). */
  async evictTenant(tenantId: string): Promise<void> {
    if (!this.weights.has(tenantId)) return
    await this.persist(tenantId).catch(() => {})
    this.weights.delete(tenantId)
    this.updateCounts.delete(tenantId)
    this.lastAccess.delete(tenantId)
  }

  /** Reset a tenant's model to zero weights (retrain from scratch). */
  async resetModel(tenantId: string): Promise<void> {
    this.weights.set(tenantId, new Float32Array(HASH_SIZE))
    this.updateCounts.set(tenantId, 0)
    this.touch(tenantId)
    await this.persist(tenantId)
  }

  // ── Federated learning support ─────────────────────────────────────────────

  /** Baseline weights at the last federated gradient submission. */
  private federatedBaselines = new Map<string, Float32Array>()
  /** Baseline update count at the last federated gradient submission. */
  private federatedBaselineCounts = new Map<string, number>()

  /**
   * Extract the weight delta (gradient) since the last federated submission.
   * Returns a sparse representation: only non-zero deltas are included,
   * as { index, delta } pairs. This is the gradient that gets submitted
   * to the federated learning round.
   *
   * After extraction, the current weights become the new baseline.
   */
  async extractGradient(
    tenantId: string,
  ): Promise<{ indices: number[]; deltas: number[]; sampleCount: number }> {
    await this.ensureLoaded(tenantId)
    const w = this.weights.get(tenantId)!
    const baseline = this.federatedBaselines.get(tenantId) ?? new Float32Array(HASH_SIZE)
    const baselineCount = this.federatedBaselineCounts.get(tenantId) ?? 0
    const currentCount = this.updateCounts.get(tenantId) ?? 0

    const indices: number[] = []
    const deltas: number[] = []
    // Sample every Nth weight to keep gradient size manageable for FL.
    // Full 2^18 = 262144 weights is too large for DP noise + secure agg.
    // Sampling 1/16 gives ~16K weights — enough signal, manageable size.
    const SAMPLE_STRIDE = 16
    for (let i = 0; i < HASH_SIZE; i += SAMPLE_STRIDE) {
      const delta = (w[i] ?? 0) - (baseline[i] ?? 0)
      if (Math.abs(delta) > 1e-8) {
        indices.push(i)
        deltas.push(Math.round(delta * 1e6) / 1e6) // quantize to reduce noise
      }
    }

    return {
      indices,
      deltas,
      sampleCount: currentCount - baselineCount, // delta since last submission
    }
  }

  /**
   * Mark the current weights as the baseline for the next gradient extraction.
   * Called after a gradient has been successfully submitted to a federated round.
   */
  markGradientSubmitted(tenantId: string): void {
    const w = this.weights.get(tenantId)
    if (w) {
      this.federatedBaselines.set(tenantId, new Float32Array(w))
      this.federatedBaselineCounts.set(tenantId, this.updateCounts.get(tenantId) ?? 0)
    }
  }

  /**
   * Apply a global model update from federated aggregation.
   * This warm-starts the tenant's model with patterns learned across
   * all tenants. The global update is applied additively to the current
   * weights (not replacing them — the tenant's own learning is preserved).
   *
   * @param tenantId The tenant to update
   * @param globalIndices Sparse indices from the global gradient
   * @param globalDeltas Sparse deltas (already aggregated + DP-noised)
   * @param scale How much to scale the global update (default 0.3 —
   *              conservative to avoid a bad global model overwhelming
   *              tenant-specific learning)
   */
  async applyGlobalUpdate(
    tenantId: string,
    globalIndices: number[],
    globalDeltas: number[],
    scale = 0.3,
  ): Promise<void> {
    await this.ensureLoaded(tenantId)
    const w = this.weights.get(tenantId)!
    for (let i = 0; i < globalIndices.length; i++) {
      const idx = globalIndices[i]!
      w[idx] = (w[idx] ?? 0) + scale * globalDeltas[i]!
    }
    await this.persist(tenantId)
  }

  /**
   * Warm-start a new tenant from the global model.
   * Called when a tenant is first loaded and has no saved weights.
   * The global model is stored in MongoDB by the FederatedLearningService.
   */
  private async tryWarmStart(tenantId: string): Promise<boolean> {
    // Gated: consuming a cross-tenant artifact is governed opt-in (CLAUDE.md
    // rule 3). Default off — see TenantLevelScorerOptions.
    if (!this.allowFederatedWarmStart) return false
    const globalCol = this.db.collection('federated_global_models')
    const globalDoc = (await globalCol.findOne({ _id: 'latest' })) as {
      indices?: number[]
      deltas?: number[]
      version?: string
    } | null
    if (!globalDoc?.indices || !globalDoc?.deltas) return false

    const w = new Float32Array(HASH_SIZE)
    for (let i = 0; i < globalDoc.indices.length; i++) {
      w[globalDoc.indices[i]!] = globalDoc.deltas[i]! * 0.3 // conservative scale
    }
    this.weights.set(tenantId, w)
    this.updateCounts.set(tenantId, 0)
    return true
  }
}
