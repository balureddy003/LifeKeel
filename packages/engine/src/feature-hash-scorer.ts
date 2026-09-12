/**
 * Feature Hash Scorer — Online logistic regression via the hashing trick.
 *
 * Learns which combinations of event fields predict user approvals,
 * without any schema definition or vocabulary management.
 *
 * Works on any data type: text labels, numeric buckets, boolean flags,
 * product SKUs, country codes, industry tags — anything stringifiable.
 *
 * Algorithm:
 *   1. Stringify each field: "amount_minor=50000", "industry=retail"
 *   2. Hash each token to a bucket index (MurmurHash3 mod 2^18)
 *   3. Score = sigmoid(sum of weights at hashed indices)
 *   4. On outcome: SGD update — weights[idx] += lr × (outcome - pred)
 *
 * Properties:
 *   - O(features) per score/update — no matrix ops
 *   - Fixed memory: 2^18 × 4 bytes = 1MB per model
 *   - Handles feature interactions via bigrams: "industry=retail × days_overdue_bucket=high"
 *   - No retraining — continuous online updates from approvals/dismissals
 *   - Per-tenant/per-detector models — each (tenant_id, detector_id) pair has its own weight vector
 *
 * Numeric bucketing:
 *   Continuous values like amount_minor=482341 are bucketed before hashing:
 *   "amount_minor=bucket:high" (top quartile), "amount_minor=bucket:medium", etc.
 *   Buckets come from per-tenant adaptive thresholds (p25/p50/p75/p90).
 *
 * YAML usage — new rule type 'score_model':
 *   rules:
 *     - id: high_risk_overdue
 *       score_model:
 *         features: [data.industry, data.customer_segment, data.amount_minor]
 *         min_score: 0.65     # treat as matched if model score ≥ this
 *         confidence: 0.82    # or_score to assign when matched
 *       reasoning_template: "Model score {{model_score}} for {{data.industry}} customer"
 *       actions: ["Prioritise collection"]
 *
 * Usage:
 *   const scorer = new FeatureHashScorer(db)
 *   await scorer.load('tenant_1', 'detector_id')
 *   const score = await scorer.score('tenant_1', 'detector_id', { industry: 'retail', amount_minor: 50000 })
 *   await scorer.update('tenant_1', 'detector_id', features, outcome=1, lr=0.01)
 */

// MongoDB structural type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

// ── Constants ──────────────────────────────────────────────────────────────────
const HASH_BITS = 18                    // 2^18 = 262,144 buckets
const HASH_SIZE = 1 << HASH_BITS       // 262144
const DEFAULT_LR = 0.01                // learning rate
const BIGRAM_SEPARATOR = '×'           // feature interaction marker

// ── MurmurHash3 (same as novelty-tracker — kept local to avoid coupling) ──────
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

// ── Numeric bucketing using adaptive threshold percentiles ─────────────────────
function bucketNumeric(
  value: number,
  thresholds?: { p25?: number; p50?: number; p75?: number; p90?: number },
): string {
  if (!thresholds) {
    // Fallback: log-scale buckets
    if (value <= 0) return 'zero'
    const mag = Math.floor(Math.log10(Math.abs(value)))
    return `mag:${mag}`
  }
  if (thresholds.p90 !== undefined && value >= thresholds.p90) return 'bucket:top'
  if (thresholds.p75 !== undefined && value >= thresholds.p75) return 'bucket:high'
  if (thresholds.p50 !== undefined && value >= thresholds.p50) return 'bucket:medium'
  if (thresholds.p25 !== undefined && value >= thresholds.p25) return 'bucket:low'
  return 'bucket:bottom'
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ModelMeta {
  tenant_id: string
  detector_id: string
  weights_checksum: number   // sum of non-zero weights (for drift detection)
  update_count: number
  last_updated_at: Date
}

export interface ScoreResult {
  score: number           // sigmoid output 0–1
  matched: boolean        // score >= min_score threshold
  feature_count: number   // number of features used
  tokens: string[]        // hashed token strings (for explain)
}

export interface FeatureHashConfig {
  features: string[]          // dot-paths into data: ["data.industry", "data.amount_minor"]
  min_score?: number          // default 0.65
  use_bigrams?: boolean       // include pairwise interactions (default true)
  l2_reg?: number             // L2 regularisation coefficient (default 0.0001)
  l1_reg?: number             // L1 regularisation coefficient (default 0.01)
  learning_rate?: number      // initial learning rate (default 0.01)
  learning_rate_schedule?: 'constant' | 'decay' | 'warmup_decay'  // learning rate schedule
}

export interface LearningRateSchedule {
  type: 'constant' | 'decay' | 'warmup_decay'
  initial_lr: number
  current_lr: number
  warmup_steps: number
  decay_rate: number
  decay_steps: number
  min_lr: number
}

export interface ModelVersion {
  version: number
  created_at: Date
  update_count: number
  weights_checksum: number
  learning_rate: number
  l1_reg: number
  l2_reg: number
}

// ── LRU eviction config ───────────────────────────────────────────────────────

export interface FeatureHashScorerOptions {
  /**
   * Maximum number of (tenant, detector) models kept in memory at once.
   * Each model is ~1MB (2^18 × 4 bytes Float32Array). Default: 200 (~200MB).
   * When the limit is exceeded, the least-recently-used model is evicted
   * (flushed to MongoDB first if it has pending updates).
   */
  maxLoadedModels?: number
}

/** Optional metrics hook — called on cache events. Decouples engine from prom-client. */
export interface FeatureHashScorerMetrics {
  onEviction?: (tenantId: string, detectorId: string) => void
  onCacheHit?: (tenantId: string, detectorId: string) => void
  onCacheMiss?: (tenantId: string, detectorId: string) => void
}

// ── FeatureHashScorer ──────────────────────────────────────────────────────────

export class FeatureHashScorer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  /** In-memory weight vectors: tenantId → detectorId → Float32Array */
  private weights = new Map<string, Map<string, Float32Array>>()
  /** Update counts: tenantId → detectorId → number */
  private updateCounts = new Map<string, Map<string, number>>()
  /** Learning rate schedules: tenantId → detectorId → LearningRateSchedule */
  private lrSchedules = new Map<string, Map<string, LearningRateSchedule>>()
  /** Model versions: tenantId → detectorId → ModelVersion[] */
  private modelVersions = new Map<string, Map<string, ModelVersion[]>>()
  /** Track which (tenantId, detectorId) models have been loaded this process */
  private loadedKeys = new Set<string>()
  /** Last-access logical clock per model key — for LRU eviction. */
  private lastAccess = new Map<string, number>()
  /** Monotonic counter — increments on every touch. Avoids millisecond
   *  collisions when many score/update calls happen within the same ms. */
  private accessClock = 0
  /** Max models in memory before LRU eviction kicks in. */
  private maxLoadedModels: number
  /** Optional metrics hook. */
  private metrics: FeatureHashScorerMetrics | undefined
  /** DB reference for the versions collection (used by createModelVersion + rollback). */
  private db: MongoDb

  constructor(db: MongoDb, options: FeatureHashScorerOptions = {}, metrics?: FeatureHashScorerMetrics) {
    this.db = db
    this.col = db.collection('feature_hash_models')
    this.col.createIndex({ tenant_id: 1, detector_id: 1 }, { unique: true }).catch(() => {})
    db.collection('feature_hash_model_versions')
      .createIndex({ tenant_id: 1, detector_id: 1, version: 1 }, { unique: true }).catch(() => {})
    this.maxLoadedModels = options.maxLoadedModels ?? 200
    this.metrics = metrics
  }

  // ── Per-tenant map helpers ──────────────────────────────────────────────────

  private getTenantMap<T>(map: Map<string, Map<string, T>>, tenantId: string): Map<string, T> {
    let tenantMap = map.get(tenantId)
    if (!tenantMap) {
      tenantMap = new Map<string, T>()
      map.set(tenantId, tenantMap)
    }
    return tenantMap
  }

  private modelKey(tenantId: string, detectorId: string): string {
    return `${tenantId}::${detectorId}`
  }

  // ── Load model weights from MongoDB ───────────────────────────────────────

  async load(tenantId: string, detectorId: string): Promise<void> {
    const key = this.modelKey(tenantId, detectorId)
    if (this.loadedKeys.has(key)) return

    const doc = await this.col.findOne({ tenant_id: tenantId, detector_id: detectorId }) as {
      weights: { buffer: ArrayBuffer } | Uint8Array
      update_count: number
      learning_rate?: number
      l1_reg?: number
      l2_reg?: number
      versions?: ModelVersion[]
    } | null

    if (!doc) {
      // Cold start: no per-tenant model exists. Try warm-start from the
      // global federated model — this gives new tenants the benefit of
      // patterns learned across all tenants for this detector, reducing
      // the cold-start period from ~20 updates to ~5.
      const warmed = await this.tryWarmStart(tenantId, detectorId)
      if (!warmed) {
        this.getTenantMap(this.weights, tenantId).set(detectorId, new Float32Array(HASH_SIZE))
        this.getTenantMap(this.updateCounts, tenantId).set(detectorId, 0)
        this.initializeLrSchedule(tenantId, detectorId, 0.01, 'warmup_decay')
      }
    } else {
      const buf = doc.weights instanceof Uint8Array
        ? doc.weights.buffer
        : doc.weights.buffer
      this.getTenantMap(this.weights, tenantId).set(detectorId, new Float32Array(buf))
      this.getTenantMap(this.updateCounts, tenantId).set(detectorId, doc.update_count ?? 0)

      // Initialize learning rate schedule
      this.initializeLrSchedule(
        tenantId,
        detectorId,
        doc.learning_rate ?? 0.01,
        'warmup_decay',
      )

      // Load model versions if available
      if (doc.versions) {
        this.getTenantMap(this.modelVersions, tenantId).set(detectorId, doc.versions)
      }
    }

    this.loadedKeys.add(key)
  }

  /**
   * Warm-start a new tenant+detector model from the global federated model.
   * Called when no per-tenant model exists for this detector. The global
   * model is stored in MongoDB by the FederatedLearningService's weekly
   * round, containing aggregated gradients from all participating tenants.
   *
   * Returns true if warm-start succeeded (weights initialized from global
   * model), false if no global model is available (caller falls back to
   * zero-initialized weights).
   */
  private async tryWarmStart(tenantId: string, detectorId: string): Promise<boolean> {
    try {
      const globalCol = this.db.collection('federated_global_models')
      const globalDoc = await globalCol.findOne({ _id: 'latest' }) as {
        indices?: number[]
        deltas?: number[]
        participant_count?: number
      } | null
      if (!globalDoc?.indices || !globalDoc?.deltas || globalDoc.indices.length === 0) {
        return false
      }

      // Initialize weights from the global model with a conservative scale
      // (0.3) — same as TenantLevelScorer.tryWarmStart. This gives the new
      // tenant a starting point that reflects cross-tenant patterns without
      // overwhelming tenant-specific learning.
      const w = new Float32Array(HASH_SIZE)
      for (let i = 0; i < globalDoc.indices.length; i++) {
        w[globalDoc.indices[i]!] = globalDoc.deltas[i]! * 0.3
      }
      this.getTenantMap(this.weights, tenantId).set(detectorId, w)
      this.getTenantMap(this.updateCounts, tenantId).set(detectorId, 0)
      // Use a lower initial learning rate since the model is warm-started —
      // less aggressive updates needed to fine-tune from the global model.
      this.initializeLrSchedule(tenantId, detectorId, 0.005, 'warmup_decay')
      this.loadedKeys.add(this.modelKey(tenantId, detectorId))
      return true
    } catch {
      return false
    }
  }

  private async ensureLoaded(tenantId: string, detectorId: string): Promise<void> {
    const key = this.modelKey(tenantId, detectorId)
    if (this.loadedKeys.has(key)) {
      this.touch(key)
      this.metrics?.onCacheHit?.(tenantId, detectorId)
      return
    }
    this.metrics?.onCacheMiss?.(tenantId, detectorId)
    // Evict LRU model if at capacity before loading a new one
    if (this.loadedKeys.size >= this.maxLoadedModels) {
      await this.evictLeastRecentlyUsed()
    }
    await this.load(tenantId, detectorId)
    this.touch(key)
  }

  /** Update last-access logical clock for a model key. */
  private touch(key: string): void {
    this.lastAccess.set(key, ++this.accessClock)
  }

  /**
   * Evict the least-recently-used model from memory.
   * Flushes to MongoDB first if the model has pending (un-persisted) updates,
   * determined by the update count modulo 10 (persist cadence in update()).
   * Returns nothing — caller should re-check capacity if needed.
   */
  private async evictLeastRecentlyUsed(): Promise<void> {
    // Find the LRU key
    let lruKey: string | null = null
    let lruTime = Infinity
    for (const [key, time] of this.lastAccess) {
      if (time < lruTime) {
        lruTime = time
        lruKey = key
      }
    }
    if (!lruKey) return

    const [tenantId, detectorId] = lruKey.split('::')
    if (!tenantId || !detectorId) return

    // Flush pending updates before evicting — otherwise we lose the last
    // <10 SGD updates (persist cadence is every 10 updates in update()).
    const count = this.updateCounts.get(tenantId)?.get(detectorId) ?? 0
    if (count % 10 !== 0) {
      await this.persist(tenantId, detectorId).catch(() => {})
    }

    // Evict from all 5 state maps
    this.weights.get(tenantId)?.delete(detectorId)
    this.updateCounts.get(tenantId)?.delete(detectorId)
    this.lrSchedules.get(tenantId)?.delete(detectorId)
    this.modelVersions.get(tenantId)?.delete(detectorId)
    this.loadedKeys.delete(lruKey)
    this.lastAccess.delete(lruKey)

    // Clean up empty tenant maps to avoid unbounded Map growth
    if (this.weights.get(tenantId)?.size === 0) {
      this.weights.delete(tenantId)
      this.updateCounts.delete(tenantId)
      this.lrSchedules.delete(tenantId)
      this.modelVersions.delete(tenantId)
    }

    this.metrics?.onEviction?.(tenantId, detectorId)
  }

  /** Current number of models in memory — for monitoring. */
  get loadedModelCount(): number {
    return this.loadedKeys.size
  }

  // ── Initialize learning rate schedule ───────────────────────────────────────

  private initializeLrSchedule(
    tenantId: string,
    detectorId: string,
    initialLr: number,
    scheduleType: 'constant' | 'decay' | 'warmup_decay',
  ): void {
    this.getTenantMap(this.lrSchedules, tenantId).set(detectorId, {
      type: scheduleType,
      initial_lr: initialLr,
      current_lr: initialLr,
      warmup_steps: 100,
      decay_rate: 0.99,
      decay_steps: 1000,
      min_lr: 0.0001,
    })
  }

  // ── Get current learning rate based on schedule ─────────────────────────────

  private getCurrentLearningRate(tenantId: string, detectorId: string): number {
    const schedule = this.lrSchedules.get(tenantId)?.get(detectorId)
    if (!schedule) return DEFAULT_LR

    const updateCount = this.updateCounts.get(tenantId)?.get(detectorId) ?? 0

    switch (schedule.type) {
      case 'constant':
        return schedule.initial_lr

      case 'decay':
        const decayFactor = Math.pow(
          schedule.decay_rate,
          Math.floor(updateCount / schedule.decay_steps),
        )
        return Math.max(schedule.initial_lr * decayFactor, schedule.min_lr)

      case 'warmup_decay':
        if (updateCount < schedule.warmup_steps) {
          // Linear warmup
          return schedule.initial_lr * (updateCount / schedule.warmup_steps)
        }
        // Exponential decay after warmup
        const warmupDecayFactor = Math.pow(
          schedule.decay_rate,
          Math.floor((updateCount - schedule.warmup_steps) / schedule.decay_steps),
        )
        return Math.max(schedule.initial_lr * warmupDecayFactor, schedule.min_lr)

      default:
        return schedule.initial_lr
    }
  }

  // ── Calculate weights checksum for versioning ───────────────────────────────

  calculateWeightsChecksum(weights: Float32Array): number {
    let sum = 0
    for (let i = 0; i < weights.length; i++) {
      const val = weights[i] ?? 0
      if (val !== 0) sum += Math.abs(val)
    }
    return Math.round(sum * 10000) / 10000
  }

  // ── Get learning rate schedule for monitoring ─────────────────────────────────

  getLrSchedule(tenantId: string, detectorId: string): LearningRateSchedule | undefined {
    return this.lrSchedules.get(tenantId)?.get(detectorId)
  }

  // ── Get weights for monitoring (public wrapper) ─────────────────────────────

  getWeightsPublic(tenantId: string, detectorId: string): Float32Array {
    return this.weights.get(tenantId)?.get(detectorId) ?? new Float32Array(HASH_SIZE)
  }

  // ── Create new model version ─────────────────────────────────────────────────

  private async createModelVersion(
    tenantId: string,
    detectorId: string,
    config: FeatureHashConfig,
  ): Promise<ModelVersion> {
    const weights = this.getWeights(tenantId, detectorId)
    const tenantVersions = this.getTenantMap(this.modelVersions, tenantId)
    const currentVersions = tenantVersions.get(detectorId) ?? []
    const lastVersion = currentVersions[currentVersions.length - 1]

    const newVersion: ModelVersion = {
      version: lastVersion ? lastVersion.version + 1 : 1,
      created_at: new Date(),
      update_count: this.updateCounts.get(tenantId)?.get(detectorId) ?? 0,
      weights_checksum: this.calculateWeightsChecksum(weights),
      learning_rate: this.getCurrentLearningRate(tenantId, detectorId),
      l1_reg: config.l1_reg ?? 0.01,
      l2_reg: config.l2_reg ?? 0.0001,
    }

    // Keep only last 5 versions in memory
    const updatedVersions = [...currentVersions, newVersion].slice(-5)
    tenantVersions.set(detectorId, updatedVersions)

    // Persist a weight snapshot to the versions collection so rollback
    // can actually restore weights (not just learning rate).
    // Without this, rollbackToVersion() was a no-op for weights.
    // IMPORTANT: copy the buffer — Buffer.from(arrayBuffer) creates a view
    // sharing the same memory, so subsequent SGD updates would mutate the
    // snapshot. We must copy the bytes.
    const versionsCol = this.db.collection('feature_hash_model_versions')
    const weightsCopy = new Float32Array(weights)
    await versionsCol.replaceOne(
      { tenant_id: tenantId, detector_id: detectorId, version: newVersion.version },
      {
        tenant_id: tenantId,
        detector_id: detectorId,
        version: newVersion.version,
        weights: Buffer.from(weightsCopy.buffer),
        weights_checksum: newVersion.weights_checksum,
        update_count: newVersion.update_count,
        created_at: newVersion.created_at,
      },
      { upsert: true },
    ).catch(() => {})

    // Prune old versions beyond the 5-version window
    if (currentVersions.length >= 5) {
      const pruned = currentVersions.slice(0, currentVersions.length - 4)
      for (const p of pruned) {
        await versionsCol.deleteOne({
          tenant_id: tenantId, detector_id: detectorId, version: p.version,
        }).catch(() => {})
      }
    }

    return newVersion
  }

  // ── Get model versions ─────────────────────────────────────────────────────

  getModelVersions(tenantId: string, detectorId: string): ModelVersion[] {
    return this.modelVersions.get(tenantId)?.get(detectorId) ?? []
  }

  // ── Rollback to specific version ────────────────────────────────────────────

  async rollbackToVersion(tenantId: string, detectorId: string, version: number): Promise<void> {
    const versions = this.modelVersions.get(tenantId)?.get(detectorId)
    if (!versions) {
      throw new Error(`No versions found for tenant ${tenantId} detector ${detectorId}`)
    }

    const targetVersion = versions.find(v => v.version === version)
    if (!targetVersion) {
      throw new Error(`Version ${version} not found for tenant ${tenantId} detector ${detectorId}`)
    }

    // Load the weight snapshot from the versions collection.
    // Previously this method only restored the learning rate — the weights
    // were never stored per version, making rollback a no-op for the model.
    const versionsCol = this.db.collection('feature_hash_model_versions')
    const snapshot = await versionsCol.findOne({
      tenant_id: tenantId, detector_id: detectorId, version,
    }) as { weights?: { buffer: ArrayBuffer } | Uint8Array } | null

    if (snapshot?.weights) {
      const buf = snapshot.weights instanceof Uint8Array
        ? snapshot.weights.buffer
        : snapshot.weights.buffer
      this.getTenantMap(this.weights, tenantId).set(detectorId, new Float32Array(buf))
    }

    // Restore the learning rate and update count from the version
    this.initializeLrSchedule(tenantId, detectorId, targetVersion.learning_rate, 'warmup_decay')
    this.getTenantMap(this.updateCounts, tenantId).set(detectorId, targetVersion.update_count)

    // Persist the rollback
    await this.persist(tenantId, detectorId)
  }

  /**
   * Reset a model to a fresh state — all weights zeroed, update count reset.
   * Use when early training was corrupted by bad labels or concept drift
   * has made the current weights unreliable. The model relearns from
   * scratch on subsequent approve/dismiss updates.
   */
  async resetModel(tenantId: string, detectorId: string): Promise<void> {
    const key = this.modelKey(tenantId, detectorId)
    // Zero out weights in memory
    this.getTenantMap(this.weights, tenantId).set(detectorId, new Float32Array(HASH_SIZE))
    this.getTenantMap(this.updateCounts, tenantId).set(detectorId, 0)
    this.getTenantMap(this.modelVersions, tenantId).delete(detectorId)
    this.initializeLrSchedule(tenantId, detectorId, 0.01, 'warmup_decay')
    this.loadedKeys.add(key)
    this.touch(key)

    // Persist the reset state + prune old versions
    await this.persist(tenantId, detectorId)
    const versionsCol = this.db.collection('feature_hash_model_versions')
    await versionsCol.deleteMany({
      tenant_id: tenantId, detector_id: detectorId,
    }).catch(() => {})
  }

  // ── Score features ─────────────────────────────────────────────────────────

  async score(
    tenantId: string,
    detectorId: string,
    data: Record<string, unknown>,
    config: FeatureHashConfig,
    adaptiveThresholds?: Record<string, { p25?: number; p50?: number; p75?: number; p90?: number }>,
  ): Promise<ScoreResult> {
    await this.ensureLoaded(tenantId, detectorId)

    const w = this.getWeights(tenantId, detectorId)
    const tokens = this.buildTokens(data, config, adaptiveThresholds)
    const minScore = config.min_score ?? 0.65

    let dot = 0
    for (const token of tokens) {
      const idx = murmurhash3(token) % HASH_SIZE
      dot += w[idx] ?? 0
    }

    const scoreVal = sigmoid(dot)
    return {
      score: Math.round(scoreVal * 10000) / 10000,
      matched: scoreVal >= minScore,
      feature_count: tokens.length,
      tokens,
    }
  }

  // ── Online SGD update from an approval or dismissal ───────────────────────

  async update(
    tenantId: string,
    detectorId: string,
    data: Record<string, unknown>,
    outcome: 0 | 1,
    config: FeatureHashConfig,
    adaptiveThresholds?: Record<string, { p25?: number; p50?: number; p75?: number; p90?: number }>,
    lr?: number,
  ): Promise<void> {
    await this.ensureLoaded(tenantId, detectorId)

    const w = this.getWeights(tenantId, detectorId)
    const tokens = this.buildTokens(data, config, adaptiveThresholds)
    const l2 = config.l2_reg ?? 0.0001
    const l1 = config.l1_reg ?? 0.01

    // Use learning rate from schedule if not provided
    const effectiveLr = lr ?? this.getCurrentLearningRate(tenantId, detectorId)

    // Score current prediction
    let dot = 0
    for (const token of tokens) {
      dot += w[murmurhash3(token) % HASH_SIZE] ?? 0
    }
    const pred = sigmoid(dot)
    const error = outcome - pred

    // SGD update with L1 and L2 regularisation
    for (const token of tokens) {
      const idx = murmurhash3(token) % HASH_SIZE
      const curr = w[idx] ?? 0

      // L1 regularisation (LASSO) - soft thresholding
      const l1Term = l1 * (curr > 0 ? 1 : curr < 0 ? -1 : 0)

      // L2 regularisation (Ridge) - weight decay
      const l2Term = l2 * curr

      // SGD update
      w[idx] = curr + effectiveLr * error - l1Term - l2Term
    }

    const tenantUpdateCounts = this.getTenantMap(this.updateCounts, tenantId)
    const count = (tenantUpdateCounts.get(detectorId) ?? 0) + 1
    tenantUpdateCounts.set(detectorId, count)

    // Create new version every 100 updates
    if (count % 100 === 0) {
      await this.createModelVersion(tenantId, detectorId, config)
    }

    // Persist every 10 updates (amortise write cost)
    if (count % 10 === 0) {
      await this.persist(tenantId, detectorId)
    }
  }

  /** Force persist (call at end of batch). */
  async flush(tenantId: string, detectorId: string): Promise<void> {
    await this.persist(tenantId, detectorId)
  }

  /** Flush all loaded models. */
  async flushAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [tenantId, detectors] of this.weights) {
      for (const detectorId of detectors.keys()) {
        promises.push(this.persist(tenantId, detectorId))
      }
    }
    await Promise.all(promises)
  }

  /**
   * Evict all models for a tenant from memory (e.g. on tenant offboarding).
   * Flushes pending updates to MongoDB first. Does not delete the persisted
   * model documents — only releases the in-memory state.
   */
  async evictTenant(tenantId: string): Promise<void> {
    const detectors = this.weights.get(tenantId)
    if (!detectors) return
    for (const detectorId of detectors.keys()) {
      await this.persist(tenantId, detectorId).catch(() => {})
      const key = this.modelKey(tenantId, detectorId)
      this.loadedKeys.delete(key)
      this.lastAccess.delete(key)
    }
    this.weights.delete(tenantId)
    this.updateCounts.delete(tenantId)
    this.lrSchedules.delete(tenantId)
    this.modelVersions.delete(tenantId)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getWeights(tenantId: string, detectorId: string): Float32Array {
    const tenantMap = this.getTenantMap(this.weights, tenantId)
    if (!tenantMap.has(detectorId)) {
      tenantMap.set(detectorId, new Float32Array(HASH_SIZE))
    }
    return tenantMap.get(detectorId)!
  }

  private buildTokens(
    data: Record<string, unknown>,
    config: FeatureHashConfig,
    adaptiveThresholds?: Record<string, { p25?: number; p50?: number; p75?: number; p90?: number }>,
  ): string[] {
    const useBigrams = config.use_bigrams ?? true
    const unigrams: string[] = []

    for (const field of config.features) {
      const value = this.extractField(data, field)
      if (value === null) continue

      let token: string
      if (typeof value === 'number') {
        const fieldKey = field.replace(/^data\./, '')
        const thresholds = adaptiveThresholds?.[fieldKey]
        token = `${fieldKey}=${bucketNumeric(value, thresholds)}`
      } else if (typeof value === 'boolean') {
        token = `${field.replace(/^data\./, '')}=${value ? '1' : '0'}`
      } else {
        // Normalise: lowercase, replace whitespace with _
        const normalised = String(value).toLowerCase().replace(/\s+/g, '_').slice(0, 64)
        token = `${field.replace(/^data\./, '')}=${normalised}`
      }
      unigrams.push(token)
    }

    if (!useBigrams || unigrams.length < 2) return unigrams

    // Pairwise bigrams — O(k²) where k = feature count; capped at 10 features
    const bigrams: string[] = []
    const cap = Math.min(unigrams.length, 10)
    for (let i = 0; i < cap; i++) {
      for (let j = i + 1; j < cap; j++) {
        bigrams.push(`${unigrams[i]}${BIGRAM_SEPARATOR}${unigrams[j]}`)
      }
    }

    return [...unigrams, ...bigrams]
  }

  private extractField(data: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.replace(/^data\./, '').split('.')
    let cur: unknown = data
    for (const part of parts) {
      if (cur === null || typeof cur !== 'object') return null
      cur = (cur as Record<string, unknown>)[part]
    }
    return cur ?? null
  }

  private async persist(tenantId: string, detectorId: string): Promise<void> {
    const tenantWeights = this.weights.get(tenantId)
    const w = tenantWeights?.get(detectorId)
    if (!w) return

    // Checksum: count non-zero weights (cheap drift signal)
    let nonZero = 0
    for (let i = 0; i < w.length; i++) {
      const val = w[i] ?? 0
      if (val !== 0) nonZero++
    }

    const schedule = this.lrSchedules.get(tenantId)?.get(detectorId)
    const versions = this.modelVersions.get(tenantId)?.get(detectorId)

    await this.col.replaceOne(
      { tenant_id: tenantId, detector_id: detectorId },
      {
        tenant_id: tenantId,
        detector_id: detectorId,
        weights: Buffer.from(w.buffer),
        weights_checksum: nonZero,
        update_count: this.updateCounts.get(tenantId)?.get(detectorId) ?? 0,
        last_updated_at: new Date(),
        learning_rate: schedule?.current_lr,
        l1_reg: schedule?.initial_lr ? 0.01 : undefined, // Store default if using schedule
        l2_reg: 0.0001, // Default L2
        versions: versions,
      },
      { upsert: true },
    )
  }
}
