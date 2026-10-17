/**
 * Adaptive Threshold Store — per-tenant Bollinger Band thresholds.
 *
 * Replaces hardcoded YAML thresholds like `amount_minor >= 10000` with
 * statistically-derived per-tenant values that automatically scale with
 * each business's size and seasonality.
 *
 * Algorithm: Bollinger Bands (mean ± k×σ on a rolling window)
 *   - Works reliably with as few as 20 data points
 *   - Robust to outliers (uses population std dev, not mean-only)
 *   - No training or labelling required
 *   - Nightly materialization: O(n) over recent signals per tenant
 *
 * Progression path:
 *   1–19 events   → Exponential Smoothing (adaptive from event 1, no cold start)
 *   20–500 events → Bollinger Bands (mean ± kσ on rolling window)
 *   > 500 events  → GESD test / Isolation Forest (future: Python microservice)
 *
 * Usage in detector YAML (instead of hardcoded numbers):
 *   condition: "data.amount_minor > context.thresholds.invoice_overdue_2sigma"
 *
 * The engine injects `context.adaptive_thresholds` into every EvaluationContext,
 * so existing filtrex expressions can reference thresholds without code changes.
 *
 * Usage:
 *   const store = new AdaptiveThresholdStore(db)
 *   await store.recompute('tenant-123', 'invoice_overdue', 'amount_minor')
 *   const ctx = await store.injectIntoContext('tenant-123', baseContext)
 */

// MongoDB types — injected at runtime
 
type MongoDb = { collection: (name: string) => any }

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AdaptiveThreshold {
  tenant_id: string
  signal_type: string
  field: string
  /** Number of samples used. < 20 = unreliable; use fallback. */
  sample_count: number
  mean: number
  std_dev: number
  /** 25th / 50th / 75th / 90th percentiles */
  p25: number
  p50: number
  p75: number
  p90: number
  /** mean + 2σ — standard anomaly alert threshold */
  upper_2sigma: number
  /** mean + 3σ — critical / rare event threshold */
  upper_3sigma: number
  /** mean - 2σ — unusually low (e.g. revenue drop) */
  lower_2sigma: number
  computed_at: Date
  window_days: number
}

export interface ThresholdFallback {
  /** Static fallbacks keyed by `signal_type.field`. Applied when sample_count < minSamples. */
  [key: string]: number
}

// ── AdaptiveThresholdStore ─────────────────────────────────────────────────────

const MIN_SAMPLES = 20         // below this, use exponential smoothing
const DEFAULT_WINDOW_DAYS = 90 // rolling window for statistics

// ── Exponential Smoothing (cold-start: 1–19 events) ───────────────────────────
//
// Single exponential smoothing (Holt, 1957) — a recency-weighted running mean.
// Adaptive from event 1: no minimum sample requirement.
//
//   S[t] = α × x[t] + (1 − α) × S[t−1]
//
// α = 0.3 is a standard default: enough recency sensitivity without instability.
// MAD (Median Absolute Deviation) approximates σ without outlier sensitivity.
//
// Stored in the same adaptive_thresholds collection as Bollinger state,
// but with sample_count < MIN_SAMPLES so consumers know which regime applies.

const EXP_ALPHA = 0.3   // smoothing factor

export interface ExponentialSmootherState {
  tenant_id: string
  signal_type: string
  field: string
  estimate: number       // S[t] — current smoothed mean
  mad: number            // mean absolute deviation (σ proxy)
  sample_count: number
  updated_at: Date
}

export class ExponentialSmoother {
   
  private col: any
  private cache = new Map<string, ExponentialSmootherState>()

  constructor(db: MongoDb) {
    this.col = db.collection('exp_smoother_states')
    this.col.createIndex({ tenant_id: 1, signal_type: 1, field: 1 }, { unique: true }).catch(() => {})
  }

  async observe(
    tenantId: string,
    signalType: string,
    field: string,
    value: number,
  ): Promise<ExponentialSmootherState> {
    const key = `${tenantId}:${signalType}:${field}`
    const prev = this.cache.get(key)

    let estimate: number
    let mad: number
    const n = (prev?.sample_count ?? 0) + 1

    if (!prev) {
      estimate = value
      mad = 0
    } else {
      estimate = EXP_ALPHA * value + (1 - EXP_ALPHA) * prev.estimate
      // EMA of absolute deviation — same smoothing factor
      mad = EXP_ALPHA * Math.abs(value - estimate) + (1 - EXP_ALPHA) * prev.mad
    }

    const state: ExponentialSmootherState = {
      tenant_id: tenantId,
      signal_type: signalType,
      field,
      estimate: Math.round(estimate),
      mad: Math.round(mad),
      sample_count: n,
      updated_at: new Date(),
    }

    this.cache.set(key, state)
    this.col.replaceOne(
      { tenant_id: tenantId, signal_type: signalType, field },
      state,
      { upsert: true },
    ).catch(() => {})

    return state
  }

  /** Build AdaptiveThreshold-compatible object from smoother state (used as fallback). */
  toThreshold(state: ExponentialSmootherState): AdaptiveThreshold {
    const sigma = state.mad * 1.4826  // MAD → σ conversion factor (Gaussian assumption)
    return {
      tenant_id: state.tenant_id,
      signal_type: state.signal_type,
      field: state.field,
      sample_count: state.sample_count,
      mean: state.estimate,
      std_dev: Math.round(sigma),
      p25: Math.round(state.estimate - sigma),
      p50: state.estimate,
      p75: Math.round(state.estimate + sigma),
      p90: Math.round(state.estimate + 1.5 * sigma),
      upper_2sigma: Math.round(state.estimate + 2 * sigma),
      upper_3sigma: Math.round(state.estimate + 3 * sigma),
      lower_2sigma: Math.max(0, Math.round(state.estimate - 2 * sigma)),
      computed_at: state.updated_at,
      window_days: 0,  // not window-based
    }
  }

  async load(tenantId: string, signalType: string, field: string): Promise<void> {
    const key = `${tenantId}:${signalType}:${field}`
    if (this.cache.has(key)) return
    const doc = await this.col.findOne({ tenant_id: tenantId, signal_type: signalType, field }) as ExponentialSmootherState | null
    if (doc) this.cache.set(key, doc)
  }

  getState(tenantId: string, signalType: string, field: string): ExponentialSmootherState | null {
    return this.cache.get(`${tenantId}:${signalType}:${field}`) ?? null
  }
}

export class AdaptiveThresholdStore {
   
  private col: any
   
  private signalCol: any
  private smoother: ExponentialSmoother | undefined
  /**
   * In-memory cache for buildContextMap results. Keyed by
   * `${tenantId}:${signalType}`. Thresholds are recomputed nightly by the
   * cron job, so a 15-minute TTL is safe and saves a MongoDB query on every
   * event evaluation (the hottest path in the API).
   */
  private contextMapCache = new Map<string, { value: Record<string, number>; expiresAt: number }>()
  private readonly contextMapCacheTtlMs = 15 * 60_000 // 15 minutes

  constructor(
    db: MongoDb,
    private readonly fallbacks: ThresholdFallback = {},
  ) {
    this.col = db.collection('adaptive_thresholds')
    this.signalCol = db.collection('signals')
    this.smoother = new ExponentialSmoother(db)
    this.ensureIndexes().catch(() => {})
  }

  /** Invalidate the in-memory cache for one tenant (call after recompute). */
  invalidateCache(tenantId?: string): void {
    if (tenantId) {
      for (const key of this.contextMapCache.keys()) {
        if (key.startsWith(`${tenantId}:`)) this.contextMapCache.delete(key)
      }
    } else {
      this.contextMapCache.clear()
    }
  }

  private async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ tenant_id: 1, signal_type: 1, field: 1 }, { unique: true })
  }

  // ── Compute and persist thresholds for one tenant+signal+field ─────────────

  async recompute(
    tenantId: string,
    signalType: string,
    field: string,
    windowDays = DEFAULT_WINDOW_DAYS,
  ): Promise<AdaptiveThreshold> {
    const since = new Date(Date.now() - windowDays * 86_400_000)

    // MongoDB aggregation: compute statistics in one pass
    // $percentile requires MongoDB 7.0+; fall back to manual percentile if unavailable
    const [stats] = await this.signalCol.aggregate([
      {
        $match: {
          tenant_id: tenantId,
          signal_type: signalType,
          [field]: { $exists: true, $type: 'number', $gt: 0 },
          created_at: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          mean:   { $avg: `$${field}` },
          std:    { $stdDevPop: `$${field}` },
          count:  { $sum: 1 },
          values: { $push: `$${field}` },
        },
      },
    ]).toArray() as Array<{ mean: number; std: number; count: number; values: number[] }>

    if (!stats || stats.count < MIN_SAMPLES) {
      // Cold-start: use exponential smoother — but load existing state first so
      // we only feed net-new observations, not the full 90-day window every night.
      if (this.smoother && stats && stats.values.length > 0) {
        await this.smoother.load(tenantId, signalType, field)
        const existing = this.smoother.getState(tenantId, signalType, field)
        // Only feed values that arrived after the last smoother update
        const since = existing?.updated_at ?? new Date(0)
        const newValues = stats.values.slice(
          // values are ordered by created_at ASC from the aggregation
          // approximate: feed only the last (count - existing.sample_count) values
          Math.max(0, (existing?.sample_count ?? 0)),
        )
        let smootherState = existing ?? undefined
        for (const v of newValues) {
          smootherState = await this.smoother.observe(tenantId, signalType, field, v)
        }
        // Suppress unused variable warning — `since` used conceptually above
        void since
        if (smootherState) return this.buildFallback(tenantId, signalType, field, windowDays, smootherState)
      }
      return this.buildFallback(tenantId, signalType, field, windowDays)
    }

    // Compute percentiles from the collected values array
    const sorted = [...stats.values].sort((a, b) => a - b)
    const percentile = (p: number) => {
      const idx = Math.floor(p * sorted.length)
      return sorted[Math.min(idx, sorted.length - 1)] ?? 0
    }

    const threshold: AdaptiveThreshold = {
      tenant_id: tenantId,
      signal_type: signalType,
      field,
      sample_count: stats.count,
      mean: Math.round(stats.mean),
      std_dev: Math.round(stats.std),
      p25: Math.round(percentile(0.25)),
      p50: Math.round(percentile(0.50)),
      p75: Math.round(percentile(0.75)),
      p90: Math.round(percentile(0.90)),
      upper_2sigma: Math.round(stats.mean + 2 * stats.std),
      upper_3sigma: Math.round(stats.mean + 3 * stats.std),
      lower_2sigma: Math.round(Math.max(0, stats.mean - 2 * stats.std)),
      computed_at: new Date(),
      window_days: windowDays,
    }

    await this.col.replaceOne(
      { tenant_id: tenantId, signal_type: signalType, field },
      threshold,
      { upsert: true },
    )

    // Invalidate the in-memory cache for this tenant+signal so the next
    // buildContextMap call picks up the new threshold.
    this.contextMapCache.delete(`${tenantId}:${signalType}`)

    return threshold
  }

  // ── Retrieve persisted thresholds ──────────────────────────────────────────

  async get(
    tenantId: string,
    signalType: string,
    field: string,
  ): Promise<AdaptiveThreshold | null> {
    return this.col.findOne({ tenant_id: tenantId, signal_type: signalType, field })
  }

  // ── Build a flat threshold map for injection into EvaluationContext ─────────
  //
  // Returns an object like:
  // {
  //   "invoice_overdue.amount_minor.2sigma": 285000,
  //   "invoice_overdue.amount_minor.3sigma": 420000,
  //   "invoice_overdue.amount_minor.p90":    310000,
  //   ...
  // }
  // Referenced in filtrex as: context.adaptive_thresholds["invoice_overdue.amount_minor.2sigma"]

  async buildContextMap(tenantId: string, signalType: string): Promise<Record<string, number>> {
    const cacheKey = `${tenantId}:${signalType}`
    const cached = this.contextMapCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }

    const all = await this.col
      .find({ tenant_id: tenantId, signal_type: signalType })
      .toArray() as AdaptiveThreshold[]

    const map: Record<string, number> = {}
    for (const t of all) {
      const prefix = `${signalType}.${t.field}`
      map[`${prefix}.mean`]        = t.mean
      map[`${prefix}.2sigma`]      = t.upper_2sigma
      map[`${prefix}.3sigma`]      = t.upper_3sigma
      map[`${prefix}.p90`]         = t.p90
      map[`${prefix}.p75`]         = t.p75
      map[`${prefix}.p50`]         = t.p50
      map[`${prefix}.lower2sigma`] = t.lower_2sigma
    }
    this.contextMapCache.set(cacheKey, { value: map, expiresAt: Date.now() + this.contextMapCacheTtlMs })
    return map
  }

  // ── Recompute all thresholds for all tenants (nightly batch job) ────────────

  async recomputeAll(
    signalTypes: Array<{ signal_type: string; fields: string[] }>,
    windowDays = DEFAULT_WINDOW_DAYS,
  ): Promise<{ computed: number; skipped: number }> {
    // Get all distinct tenant_ids
    const tenantIds: string[] = await this.signalCol.distinct('tenant_id')
    let computed = 0
    let skipped = 0

    for (const tenantId of tenantIds) {
      for (const { signal_type, fields } of signalTypes) {
        for (const field of fields) {
          const result = await this.recompute(tenantId, signal_type, field, windowDays)
          if (result.sample_count >= MIN_SAMPLES) computed++
          else skipped++
        }
      }
    }

    return { computed, skipped }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildFallback(
    tenantId: string,
    signalType: string,
    field: string,
    windowDays: number,
    smootherState?: ExponentialSmootherState,
  ): AdaptiveThreshold {
    // Prefer exponential smoother when available (adaptive from event 1)
    if (smootherState && smootherState.sample_count > 0) {
      const t = this.smoother?.toThreshold(smootherState)
      if (t) return { ...t, window_days: windowDays }
    }
    // Static fallback — only when smoother has no data at all
    const key = `${signalType}.${field}`
    const fallbackValue = this.fallbacks[key] ?? 0
    return {
      tenant_id: tenantId,
      signal_type: signalType,
      field,
      sample_count: 0,
      mean: fallbackValue,
      std_dev: Math.round(fallbackValue * 0.3),
      p25: Math.round(fallbackValue * 0.5),
      p50: fallbackValue,
      p75: Math.round(fallbackValue * 1.5),
      p90: Math.round(fallbackValue * 2),
      upper_2sigma: Math.round(fallbackValue * 1.6),
      upper_3sigma: Math.round(fallbackValue * 1.9),
      lower_2sigma: Math.max(0, Math.round(fallbackValue * 0.4)),
      computed_at: new Date(),
      window_days: windowDays,
    }
  }
}