/**
 * Change-Point Detection — CUSUM (Cumulative Sum Control Chart).
 *
 * Detects when a metric's underlying mean has shifted, across any numeric
 * stream: revenue, invoice counts, payment amounts, login frequency, inventory.
 *
 * Algorithm: CUSUM (Page, 1954)
 *   C[t] = max(0, C[t-1] + (x[t] - μ) / σ - k)
 *
 *   where:
 *     x[t]  = normalised observation at time t
 *     μ, σ  = running mean and std dev (updated via Welford's algorithm)
 *     k     = slack (half the minimum shift worth detecting, default 0.5σ)
 *     h     = alarm threshold (default 4.0 — corresponds to ~ARL₀ = 500)
 *
 * Properties:
 *   - O(1) per observation — single accumulator, no history needed
 *   - Works from observation 1 (Welford online mean/variance)
 *   - Directional: separate up/down detectors per stream
 *   - Resets accumulator after alarm (steady-state detection)
 *
 * YAML usage in any detector rule:
 *   rules:
 *     - id: revenue_declining
 *       condition: "data.revenue_minor > 0"
 *       cusum:
 *         field: data.revenue_minor
 *         slack: 0.5
 *         threshold: 4.0
 *         direction: down   # 'up' | 'down' | 'both'
 *         min_observations: 10  # don't alarm before this many points
 *
 * Per-tenant, per-field state is stored in MongoDB and cached in memory.
 *
 * Usage:
 *   const detector = new ChangePointDetector(db)
 *   const result = await detector.update('tenant_abc', 'revenue_minor', 150000)
 *   if (result.alarm) {
 *     // Metric has shifted — inject into EvaluationContext
 *   }
 */

// MongoDB structural type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

// ── Types ──────────────────────────────────────────────────────────────────────

export type CUSUMDirection = 'up' | 'down' | 'both'
export type ChangePointAlgorithm = 'cusum' | 'adwin' | 'pelt'

export interface CUSUMConfig {
  field: string
  slack?: number        // k — default 0.5
  threshold?: number    // h — default 4.0
  direction?: CUSUMDirection  // default 'both'
  min_observations?: number   // default 10
  algorithm?: ChangePointAlgorithm  // default 'cusum'
}

export interface ADWINConfig {
  field: string
  delta?: number       // confidence threshold (default 0.002)
  max_clock?: number   // maximum window size (default 1000)
  min_clock?: number   // minimum window size (default 10)
}

export interface PELTConfig {
  field: string
  penalty?: number     // penalty for adding change point (default log(n))
  min_segment_length?: number  // minimum segment length (default 10)
}

export interface CUSUMState {
  tenant_id: string
  field: string
  /** Welford online mean */
  mean: number
  /** Welford M2 (sum of squared deviations — used to compute variance) */
  m2: number
  n: number           // observation count
  cusum_up: number    // upper CUSUM accumulator
  cusum_down: number  // lower CUSUM accumulator
  last_alarm_at?: Date
  updated_at: Date
}

export interface ChangePointResult {
  field: string
  value: number
  alarm: boolean
  direction?: 'up' | 'down'
  cusum_up: number
  cusum_down: number
  mean: number
  std_dev: number
  n: number
  /** Normalised deviation from mean (z-score) */
  z_score: number
  /** Algorithm used */
  algorithm?: ChangePointAlgorithm
  /** ADWIN-specific: window statistics */
  adwin_stats?: {
    window_size: number
    mean_before: number
    mean_after: number
    delta: number
  }
}

// ── Welford online mean + variance ────────────────────────────────────────────

function welfordUpdate(
  mean: number,
  m2: number,
  n: number,
  value: number,
): { mean: number; m2: number; n: number; variance: number } {
  const newN = n + 1
  const delta = value - mean
  const newMean = mean + delta / newN
  const delta2 = value - newMean
  const newM2 = m2 + delta * delta2
  const variance = newN > 1 ? newM2 / (newN - 1) : 0
  return { mean: newMean, m2: newM2, n: newN, variance }
}

// ── ChangePointDetector ────────────────────────────────────────────────────────

const DEFAULT_SLACK = 0.5
const DEFAULT_THRESHOLD = 4.0
const DEFAULT_MIN_OBS = 10

export class ChangePointDetector {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private adwinCol: any
  /** In-memory state cache: `${tenantId}:${field}` → CUSUMState */
  private cache = new Map<string, CUSUMState>()
  /** ADWIN state cache: `${tenantId}:${field}:adwin` → ADWINState */
  private adwinCache = new Map<string, ADWINState>()

  constructor(db: MongoDb) {
    this.col = db.collection('cusum_states')
    this.adwinCol = db.collection('adwin_states')
    this.col.createIndex({ tenant_id: 1, field: 1 }, { unique: true }).catch(() => {})
    this.adwinCol.createIndex({ tenant_id: 1, field: 1 }, { unique: true }).catch(() => {})
  }

  // ── Load state from MongoDB ────────────────────────────────────────────────

  async load(tenantId: string, fields: string[]): Promise<void> {
    // Load CUSUM states
    const docs = await this.col
      .find({ tenant_id: tenantId, field: { $in: fields } })
      .toArray() as CUSUMState[]

    for (const doc of docs) {
      this.cache.set(`${tenantId}:${doc.field}`, doc)
    }

    // Load ADWIN states
    const adwinDocs = await this.adwinCol
      .find({ tenant_id: tenantId, field: { $in: fields } })
      .toArray() as ADWINState[]

    for (const doc of adwinDocs) {
      this.adwinCache.set(`${tenantId}:${doc.field}:adwin`, doc)
    }
  }

  // ── Update — observe a new value, return result ────────────────────────────

  async update(
    tenantId: string,
    field: string,
    value: number,
    config: Partial<CUSUMConfig> = {},
  ): Promise<ChangePointResult> {
    const algorithm = config.algorithm ?? 'cusum'

    // Route to appropriate algorithm
    if (algorithm === 'adwin') {
      return this.updateADWIN(tenantId, field, value, config)
    }

    // Default to CUSUM
    const key = `${tenantId}:${field}`
    const state = this.cache.get(key) ?? this.emptyState(tenantId, field)

    const slack     = config.slack     ?? DEFAULT_SLACK
    const threshold = config.threshold ?? DEFAULT_THRESHOLD
    const minObs    = config.min_observations ?? DEFAULT_MIN_OBS
    const direction = config.direction ?? 'both'

    // Welford online update
    const { mean, m2, n, variance } = welfordUpdate(state.mean, state.m2, state.n, value)
    const std = Math.sqrt(variance)

    // Normalised deviation (z-score)
    const z = std > 0 ? (value - mean) / std : 0

    // CUSUM update (upper = detects increases, lower = detects decreases)
    const cusumUp   = Math.max(0, state.cusum_up   + z - slack)
    const cusumDown = Math.max(0, state.cusum_down - z - slack)

    // Alarm check — only after min_observations
    let alarm = false
    let alarmDirection: 'up' | 'down' | undefined

    if (n >= minObs) {
      if ((direction === 'up' || direction === 'both') && cusumUp > threshold) {
        alarm = true
        alarmDirection = 'up'
      } else if ((direction === 'down' || direction === 'both') && cusumDown > threshold) {
        alarm = true
        alarmDirection = 'down'
      }
    }

    // Update state
    const newState: CUSUMState = {
      tenant_id: tenantId,
      field,
      mean,
      m2,
      n,
      // Reset accumulator on alarm (steady-state)
      cusum_up:   alarm ? 0 : cusumUp,
      cusum_down: alarm ? 0 : cusumDown,
      ...(alarm && { last_alarm_at: new Date() }),
      updated_at: new Date(),
    }

    this.cache.set(key, newState)

    // Async persist (fire-and-forget on hot path)
    this.persistState(newState).catch(() => {})

    return {
      field,
      value,
      alarm,
      ...(alarmDirection && { direction: alarmDirection }),
      cusum_up:   cusumUp,
      cusum_down: cusumDown,
      mean,
      std_dev: std,
      n,
      z_score: Math.round(z * 1000) / 1000,
      algorithm: 'cusum',
    }
  }

  // ── Batch update for multiple numeric fields in one event ─────────────────

  async updateMany(
    tenantId: string,
    data: Record<string, unknown>,
    fields: string[],
    configs: Record<string, Partial<CUSUMConfig>> = {},
  ): Promise<Map<string, ChangePointResult>> {
    const results = new Map<string, ChangePointResult>()

    for (const field of fields) {
      const value = this.extractNumeric(data, field)
      if (value === null) continue
      const result = await this.update(tenantId, field, value, configs[field] ?? {})
      results.set(field, result)
    }

    return results
  }

  // ── Build context map for injection into EvaluationContext ────────────────

  buildContext(results: Map<string, ChangePointResult>): Record<string, unknown> {
    const ctx: Record<string, unknown> = {}
    for (const [field, result] of results) {
      ctx[`${field}.cusum_up`]   = result.cusum_up
      ctx[`${field}.cusum_down`] = result.cusum_down
      ctx[`${field}.z_score`]    = result.z_score
      ctx[`${field}.alarm`]      = result.alarm ? 1 : 0
      ctx[`${field}.direction`]  = result.direction ?? 'none'
    }
    return ctx
  }

  // ── Reset state for a tenant+field (e.g. after a known structural break) ──

  async reset(tenantId: string, field: string): Promise<void> {
    const key = `${tenantId}:${field}`
    const empty = this.emptyState(tenantId, field)
    this.cache.set(key, empty)
    await this.persistState(empty)
  }

  // ── Get current state ──────────────────────────────────────────────────────

  getState(tenantId: string, field: string): CUSUMState | null {
    return this.cache.get(`${tenantId}:${field}`) ?? null
  }

  getADWINState(tenantId: string, field: string): ADWINState | null {
    return this.adwinCache.get(`${tenantId}:${field}:adwin`) ?? null
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private emptyState(tenantId: string, field: string): CUSUMState {
    return {
      tenant_id: tenantId,
      field,
      mean: 0,
      m2: 0,
      n: 0,
      cusum_up: 0,
      cusum_down: 0,
      updated_at: new Date(),
    }
  }

  private async persistState(state: CUSUMState): Promise<void> {
    await this.col.replaceOne(
      { tenant_id: state.tenant_id, field: state.field },
      state,
      { upsert: true },
    )
  }

  // ── ADWIN Algorithm (Adaptive Windowing) ───────────────────────────────────────

  async updateADWIN(
    tenantId: string,
    field: string,
    value: number,
    config: Partial<ADWINConfig> = {},
  ): Promise<ChangePointResult> {
    const delta = config.delta ?? 0.002
    const maxClock = config.max_clock ?? 1000
    const minClock = config.min_clock ?? 10

    const key = `${tenantId}:${field}:adwin`
    let state = this.adwinCache.get(key) as ADWINState | undefined

    if (!state) {
      // Try to load from database
      const doc = await this.adwinCol.findOne({ tenant_id: tenantId, field }) as ADWINState | null
      state = doc ?? {
        tenant_id: tenantId,
        field,
        window: [value],
        mean: value,
        variance: 0,
        n: 1,
        last_change_at: null,
        updated_at: new Date(),
        algorithm: 'adwin',
      }
    }

    // Add new value to window
    state.window.push(value)
    if (state.window.length > maxClock) {
      state.window.shift()
    }

    // Update statistics
    const n = state.window.length
    const mean = state.window.reduce((a, b) => a + b, 0) / n
    const variance = state.window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1)

    // Check for change point using ADWIN
    let alarm = false
    let deltaVal = 0

    if (n >= minClock) {
      // Try to find a cut point that maximizes the difference
      let maxDiff = 0
      let bestCut = -1

      for (let i = minClock; i < n - minClock; i++) {
        const w1 = state.window.slice(0, i)
        const w2 = state.window.slice(i)
        const m1 = w1.reduce((a, b) => a + b, 0) / w1.length
        const m2 = w2.reduce((a, b) => a + b, 0) / w2.length
        const diff = Math.abs(m1 - m2)

        if (diff > maxDiff) {
          maxDiff = diff
          bestCut = i
        }
      }

      // If difference exceeds threshold, trigger alarm
      if (maxDiff > delta) {
        alarm = true
        deltaVal = maxDiff
        // Reset window to post-change segment
        if (bestCut >= 0) {
          state.window = state.window.slice(bestCut)
        }
        state.last_change_at = new Date()
      }
    }

    state.mean = mean
    state.variance = variance
    state.n = n
    state.updated_at = new Date()

    this.adwinCache.set(key, state)
    await this.persistADWINState(state)

    return {
      field,
      value,
      alarm,
      cusum_up: 0,
      cusum_down: 0,
      mean,
      std_dev: Math.sqrt(variance),
      n,
      z_score: 0,
      algorithm: 'adwin',
      adwin_stats: {
        window_size: n,
        mean_before: alarm ? mean - deltaVal : mean,
        mean_after: mean,
        delta: deltaVal,
      },
    }
  }

  private async persistADWINState(state: ADWINState): Promise<void> {
    await this.adwinCol.replaceOne(
      { tenant_id: state.tenant_id, field: state.field },
      state,
      { upsert: true },
    )
  }

  private extractNumeric(data: Record<string, unknown>, dotPath: string): number | null {
    const parts = dotPath.replace(/^data\./, '').split('.')
    let cur: unknown = data
    for (const part of parts) {
      if (cur === null || typeof cur !== 'object') return null
      cur = (cur as Record<string, unknown>)[part]
    }
    return typeof cur === 'number' ? cur : null
  }
}

// ── ADWIN State ───────────────────────────────────────────────────────────────

interface ADWINState {
  tenant_id: string
  field: string
  window: number[]
  mean: number
  variance: number
  n: number
  last_change_at: Date | null
  updated_at: Date
  algorithm: 'adwin'
}
