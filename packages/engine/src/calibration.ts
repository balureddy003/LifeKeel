/**
 * Confidence Score Calibration — Temperature Scaling per Detector.
 *
 * Problem: LLM confidence scores are systematically overconfident.
 * A model that says "0.95" is right ~70% of the time, not 95%.
 * Uncalibrated scores inflate ROI estimates and erode user trust.
 *
 * Solution: Platt Scaling (temperature scaling variant)
 *   calibrated = sigmoid(logit(raw) / T)
 *
 * where T > 1 softens overconfidence, T < 1 sharpens underconfidence.
 *
 * Algorithm:
 *   1. Collect (raw_score, outcome) pairs from attribution data
 *   2. Find T that minimises Binary Cross-Entropy (1D optimisation)
 *   3. Store T per (detector_id) in MongoDB
 *   4. Apply at score time — zero overhead, one multiply + sigmoid
 *
 * Calibration quality metrics (computed at fit time):
 *   - ECE  (Expected Calibration Error) — primary metric, lower is better
 *   - MCE  (Maximum Calibration Error) — worst-case bucket
 *   - Brier Score — proper scoring rule combining accuracy + calibration
 *
 * Usage:
 *   const cal = new ScoreCalibrator(db)
 *   await cal.fit('invoice_detector', trainingPairs)
 *   const adjusted = await cal.calibrate('invoice_detector', rawScore)
 *
 * Auto-integration with Engine:
 *   Pass calibrator to EngineOptions.calibrator — it's applied to every
 *   LLM-enriched combined_score before the insight is stored.
 *
 * References:
 *   Platt (1999), Guo et al. (2017) "On Calibration of Modern Neural Networks"
 */

// MongoDB types — injected at runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CalibrationPair {
  /** Raw score from LLM or rule (0–1). */
  raw_score: number
  /** Actual outcome: 1 = converted/correct, 0 = dismissed/wrong. */
  outcome: 0 | 1
}

export interface CalibrationParams {
  tenant_id: string
  detector_id: string
  /** Temperature T in Platt scaling: sigmoid(logit(p) / T). T=1 = no change. */
  temperature: number
  /**
   * Isotonic regression breakpoints — preferred over Platt when sample_count >= 200.
   * Absent when sample_count < 200 (not enough data to fit a step function reliably).
   */
  isotonic_breakpoints?: IsotonicBreakpoint[]
  /** Expected Calibration Error over 10 buckets (lower is better). */
  ece: number
  /** Maximum Calibration Error (worst-case bucket). */
  mce: number
  /** Brier score (mean squared error of probabilities). */
  brier_score: number
  /** Number of samples used for fitting. */
  sample_count: number
  /** Which calibrator is active: 'platt' (< 200 samples) or 'isotonic' (≥ 200 samples). */
  active_calibrator: 'platt' | 'isotonic' | 'none'
  fitted_at: Date
  /** Previous ECE for drift detection */
  previous_ece: number | null
  /** Previous Brier score for drift detection */
  previous_brier_score: number | null
  /** Drift detected flag */
  drift_detected: boolean
}

export interface CalibrationBucket {
  confidence_low: number
  confidence_high: number
  mean_confidence: number
  mean_accuracy: number
  count: number
  /** Calibration gap = |mean_confidence − mean_accuracy|. */
  gap: number
}

// ── Math helpers ───────────────────────────────────────────────────────────────

const EPS = 1e-7  // prevent log(0)

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

function logit(p: number): number {
  const clipped = Math.max(EPS, Math.min(1 - EPS, p))
  return Math.log(clipped / (1 - clipped))
}

/** Platt-scaled probability: sigmoid(logit(p) / T) */
function plattScale(p: number, temperature: number): number {
  if (temperature === 1) return p
  return sigmoid(logit(p) / temperature)
}

/**
 * Binary cross-entropy loss for a given temperature T.
 * Minimised to find the optimal T via golden-section search.
 */
function crossEntropyLoss(pairs: CalibrationPair[], T: number): number {
  let loss = 0
  for (const { raw_score, outcome } of pairs) {
    const p = plattScale(raw_score, T)
    loss += -(outcome * Math.log(Math.max(EPS, p)) + (1 - outcome) * Math.log(Math.max(EPS, 1 - p)))
  }
  return loss / pairs.length
}

/**
 * Golden-section search for T that minimises cross-entropy.
 * Searches T ∈ [0.1, 10] — covers any realistic miscalibration.
 * Converges in ~50 iterations, O(1) per iteration.
 */
function fitTemperature(pairs: CalibrationPair[]): number {
  const PHI = (1 + Math.sqrt(5)) / 2
  let a = 0.1, b = 10
  const tol = 1e-5

  let c = b - (b - a) / PHI
  let d = a + (b - a) / PHI

  while (Math.abs(b - a) > tol) {
    if (crossEntropyLoss(pairs, c) < crossEntropyLoss(pairs, d)) {
      b = d
    } else {
      a = c
    }
    c = b - (b - a) / PHI
    d = a + (b - a) / PHI
  }

  return (a + b) / 2
}

// ── Calibration metrics ────────────────────────────────────────────────────────

function computeECE(pairs: CalibrationPair[], T: number, nBuckets = 10): number {
  const buckets: { sumConf: number; sumAcc: number; n: number }[] = Array.from(
    { length: nBuckets },
    () => ({ sumConf: 0, sumAcc: 0, n: 0 }),
  )

  for (const { raw_score, outcome } of pairs) {
    const p = plattScale(raw_score, T)
    const idx = Math.min(nBuckets - 1, Math.floor(p * nBuckets))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const b = buckets[idx]!
    b.sumConf += p
    b.sumAcc  += outcome
    b.n       += 1
  }

  let ece = 0
  for (const b of buckets) {
    if (b.n === 0) continue
    ece += (b.n / pairs.length) * Math.abs(b.sumConf / b.n - b.sumAcc / b.n)
  }
  return ece
}

function computeMCE(pairs: CalibrationPair[], T: number, nBuckets = 10): number {
  const buckets: { sumConf: number; sumAcc: number; n: number }[] = Array.from(
    { length: nBuckets },
    () => ({ sumConf: 0, sumAcc: 0, n: 0 }),
  )

  for (const { raw_score, outcome } of pairs) {
    const p = plattScale(raw_score, T)
    const idx = Math.min(nBuckets - 1, Math.floor(p * nBuckets))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const b = buckets[idx]!
    b.sumConf += p
    b.sumAcc  += outcome
    b.n       += 1
  }

  return buckets.reduce((max, b) => {
    if (b.n === 0) return max
    return Math.max(max, Math.abs(b.sumConf / b.n - b.sumAcc / b.n))
  }, 0)
}

function computeBrier(pairs: CalibrationPair[], T: number): number {
  return pairs.reduce((s, { raw_score, outcome }) => {
    const p = plattScale(raw_score, T)
    return s + Math.pow(p - outcome, 2)
  }, 0) / pairs.length
}

/** Generate reliability diagram data (calibration curve). */
function buildCalibrationCurve(pairs: CalibrationPair[], T: number, nBuckets = 10): CalibrationBucket[] {
  const buckets: { confs: number[]; outcomes: number[] }[] = Array.from(
    { length: nBuckets },
    () => ({ confs: [], outcomes: [] }),
  )

  for (const { raw_score, outcome } of pairs) {
    const p = plattScale(raw_score, T)
    const idx = Math.min(nBuckets - 1, Math.floor(p * nBuckets))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const b = buckets[idx]!
    b.confs.push(p)
    b.outcomes.push(outcome)
  }

  return buckets.map((b, i) => {
    const low  = i / nBuckets
    const high = (i + 1) / nBuckets
    if (b.confs.length === 0) {
      return { confidence_low: low, confidence_high: high, mean_confidence: (low + high) / 2, mean_accuracy: 0, count: 0, gap: 0 }
    }
    const meanConf = b.confs.reduce((s, x) => s + x, 0) / b.confs.length
    const meanAcc  = b.outcomes.reduce((s, x) => s + x, 0) / b.outcomes.length
    return {
      confidence_low: low,
      confidence_high: high,
      mean_confidence: Math.round(meanConf * 1000) / 1000,
      mean_accuracy:   Math.round(meanAcc  * 1000) / 1000,
      count: b.confs.length,
      gap: Math.round(Math.abs(meanConf - meanAcc) * 1000) / 1000,
    }
  }).filter(b => b.count > 0)
}

// ── Isotonic Regression (Pool Adjacent Violators) ─────────────────────────────
//
// Shape-constrained non-parametric calibration — no temperature parameter,
// just a monotone step function fitted from (score, outcome) pairs.
//
// Advantages over Platt scaling:
//   - No distributional assumption (Platt assumes logistic shape)
//   - Exact on training data (no temperature hyper-parameter to tune)
//   - Preferred when sample_count > 200 (Zadrozny & Elkan, 2002)
//
// Algorithm: Pool Adjacent Violators (PAV) — O(n log n)
//   1. Sort pairs by raw_score ASC
//   2. Scan left→right; if a pool's mean > next pool's mean, merge and average
//   3. Result: monotone non-decreasing step function
//
// At inference: binary search the breakpoints to map raw_score → calibrated.

export interface IsotonicBreakpoint {
  score_low: number
  score_high: number
  calibrated: number   // mean outcome in this bucket
  count: number
}

export function fitIsotonic(pairs: CalibrationPair[]): IsotonicBreakpoint[] {
  if (pairs.length === 0) return []

  // Sort by raw_score
  const sorted = [...pairs].sort((a, b) => a.raw_score - b.raw_score)

  // PAV: each pool = { sum, count, score_low, score_high }
  const pools: Array<{ sum: number; count: number; score_low: number; score_high: number }> = []

  for (const { raw_score, outcome } of sorted) {
    pools.push({ sum: outcome, count: 1, score_low: raw_score, score_high: raw_score })

    // Merge while violating monotonicity
    while (pools.length >= 2) {
      const prev = pools[pools.length - 2]!
      const curr = pools[pools.length - 1]!
      if (prev.sum / prev.count <= curr.sum / curr.count) break
      // Merge curr into prev
      prev.sum   += curr.sum
      prev.count += curr.count
      prev.score_high = curr.score_high
      pools.pop()
    }
  }

  return pools.map(p => ({
    score_low:  p.score_low,
    score_high: p.score_high,
    calibrated: p.sum / p.count,
    count: p.count,
  }))
}

export function applyIsotonic(breakpoints: IsotonicBreakpoint[], rawScore: number): number {
  if (breakpoints.length === 0) return rawScore

  // Below all breakpoints
  if (rawScore <= breakpoints[0]!.score_high) return breakpoints[0]!.calibrated
  // Above all breakpoints
  if (rawScore >= breakpoints[breakpoints.length - 1]!.score_low) {
    return breakpoints[breakpoints.length - 1]!.calibrated
  }

  // Binary search for enclosing breakpoint
  let lo = 0, hi = breakpoints.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (breakpoints[mid]!.score_high < rawScore) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return breakpoints[lo]!.calibrated
}

// ── ScoreCalibrator ───────────────────────────────────────────────────────────

const MIN_CALIBRATION_SAMPLES  = 20   // below this → pass-through (T=1). Lowered from 30 to enable faster calibration for low-volume tenants like reddy003 (38 receipts).
const ISOTONIC_MIN_SAMPLES     = 200  // at or above this → prefer isotonic over Platt

export class ScoreCalibrator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private col: any
  /** In-memory cache: tenantId:detectorId → temperature (Platt) */
  private cache = new Map<string, number>()
  /** In-memory isotonic cache: detectorId → breakpoints */
  private isotonicCache = new Map<string, IsotonicBreakpoint[]>()

  constructor(db: MongoDb) {
    this.col = db.collection('calibration_params')
    this.col.createIndex({ tenant_id: 1, detector_id: 1 }, { unique: true }).catch(() => {})
  }

  // ── Fit ────────────────────────────────────────────────────────────────────

  /**
   * Fit calibration for a detector using historical outcomes.
   *   < 30 samples  → pass-through (identity)
   *   20–199 samples → Platt temperature scaling
   *   ≥ 200 samples  → Isotonic regression (PAV) — no distributional assumption
   */
  async fit(tenantId: string, detectorId: string, pairs: CalibrationPair[]): Promise<CalibrationParams> {
    const key = this.key(tenantId, detectorId)
    if (pairs.length < MIN_CALIBRATION_SAMPLES) {
      const identity: CalibrationParams = {
        tenant_id: tenantId,
        detector_id: detectorId,
        temperature: 1,
        ece: 0, mce: 0, brier_score: 0,
        sample_count: pairs.length,
        active_calibrator: 'none',
        fitted_at: new Date(),
        previous_ece: null,
        previous_brier_score: null,
        drift_detected: false,
      }
      await this.col.replaceOne({ tenant_id: tenantId, detector_id: detectorId }, identity, { upsert: true })
      this.cache.set(key, 1)
      this.isotonicCache.delete(key)
      return identity
    }

    const T = fitTemperature(pairs)
    const useIsotonic = pairs.length >= ISOTONIC_MIN_SAMPLES

    // Always fit Platt (cheap, needed for ECE metrics)
    const plattParams = {
      ece:         Math.round(computeECE(pairs, T) * 10000) / 10000,
      mce:         Math.round(computeMCE(pairs, T) * 10000) / 10000,
      brier_score: Math.round(computeBrier(pairs, T) * 10000) / 10000,
    }

    // Fit isotonic when enough data
    const isotonicBreakpoints = useIsotonic ? fitIsotonic(pairs) : undefined

    // Get previous params for drift detection
    const existing = await this.col.findOne({ tenant_id: tenantId, detector_id: detectorId }) as CalibrationParams | null

    // Detect drift - compare existing ECE/Brier with new values
    const driftDetected = this.detectDrift(
      existing?.ece ?? null,
      existing?.brier_score ?? null,
      plattParams.ece,
      plattParams.brier_score,
    )

    const params: CalibrationParams = {
      tenant_id: tenantId,
      detector_id: detectorId,
      temperature: Math.round(T * 10000) / 10000,
      ...(isotonicBreakpoints && { isotonic_breakpoints: isotonicBreakpoints }),
      ...plattParams,
      sample_count: pairs.length,
      active_calibrator: useIsotonic ? 'isotonic' : 'platt',
      fitted_at: new Date(),
      previous_ece: existing?.ece ?? null,
      previous_brier_score: existing?.brier_score ?? null,
      drift_detected: driftDetected,
    }

    await this.col.replaceOne({ tenant_id: tenantId, detector_id: detectorId }, params, { upsert: true })
    this.cache.set(key, params.temperature)
    if (isotonicBreakpoints) this.isotonicCache.set(key, isotonicBreakpoints)

    return params
  }

  /**
   * Detect calibration drift based on ECE and Brier score changes
   */
  private detectDrift(
    previousEce: number | null,
    previousBrier: number | null,
    currentEce: number,
    currentBrier: number,
  ): boolean {
    if (previousEce === null || previousBrier === null) return false

    // Drift thresholds
    const ECE_THRESHOLD = 0.02
    const BRIER_THRESHOLD = 0.05

    const eceIncrease = currentEce - previousEce
    const brierIncrease = currentBrier - previousBrier

    return eceIncrease > ECE_THRESHOLD || brierIncrease > BRIER_THRESHOLD
  }

  // ── Calibrate ─────────────────────────────────────────────────────────────

  /**
   * Apply temperature scaling to a raw confidence score.
   * Returns the raw score unchanged if no calibration params exist.
   */
  async calibrate(tenantId: string, detectorId: string, rawScore: number): Promise<number> {
    const T = await this.getTemperature(tenantId, detectorId)
    return Math.round(plattScale(rawScore, T) * 10000) / 10000
  }

  /**
   * Synchronous calibration using cache (for hot path — avoids DB round-trip).
   * Call `warmCache()` at startup to populate from DB.
   */
  calibrateSync(tenantId: string, detectorId: string, rawScore: number): number {
    const key = this.key(tenantId, detectorId)
    // Prefer isotonic when loaded (≥ 200 samples — no distributional assumption)
    const breakpoints = this.isotonicCache.get(key)
    if (breakpoints) {
      return Math.round(applyIsotonic(breakpoints, rawScore) * 10000) / 10000
    }
    const T = this.cache.get(key) ?? 1
    return Math.round(plattScale(rawScore, T) * 10000) / 10000
  }

  // ── Calibration curve ─────────────────────────────────────────────────────

  /** Return reliability diagram data for a detector. */
  async getCalibrationCurve(tenantId: string, detectorId: string, pairs: CalibrationPair[]): Promise<CalibrationBucket[]> {
    const T = await this.getTemperature(tenantId, detectorId)
    return buildCalibrationCurve(pairs, T)
  }

  // ── Warm cache ────────────────────────────────────────────────────────────

  /** Pre-load all temperatures and isotonic breakpoints into memory. */
  async warmCache(): Promise<void> {
    const all = await this.col.find({}).toArray() as CalibrationParams[]
    for (const p of all) {
      const key = this.key(p.tenant_id, p.detector_id)
      this.cache.set(key, p.temperature)
      if (p.isotonic_breakpoints && p.isotonic_breakpoints.length > 0) {
        this.isotonicCache.set(key, p.isotonic_breakpoints)
      }
    }
  }

  /** Get all stored calibration params (for monitoring dashboard). */
  async getAllParams(tenantId: string): Promise<CalibrationParams[]> {
    return this.col.find({ tenant_id: tenantId }).sort({ brier_score: 1 }).toArray()
  }

  /** Get calibration params for a specific detector. */
  async getParams(tenantId: string, detectorId: string): Promise<CalibrationParams> {
    const doc = await this.col.findOne({ tenant_id: tenantId, detector_id: detectorId }) as CalibrationParams | null
    if (!doc) {
      // Return default params if not found
      return {
        tenant_id: tenantId,
        detector_id: detectorId,
        temperature: 1,
        ece: 0,
        mce: 0,
        brier_score: 0,
        sample_count: 0,
        active_calibrator: 'none',
        fitted_at: new Date(),
        previous_ece: null,
        previous_brier_score: null,
        drift_detected: false,
      }
    }
    return doc
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getTemperature(tenantId: string, detectorId: string): Promise<number> {
    const key = this.key(tenantId, detectorId)
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached

    const stored = await this.col.findOne({ tenant_id: tenantId, detector_id: detectorId }) as CalibrationParams | null
    const T = stored?.temperature ?? 1
    this.cache.set(key, T)
    return T
  }

  private key(tenantId: string, detectorId: string): string {
    return `${tenantId}:${detectorId}`
  }
}

// ── Nightly batch job ─────────────────────────────────────────────────────────
// Collects (raw_score, outcome) pairs from attribution history and refits all detectors.

/**
 * Build calibration training data from attribution records.
 * Called by the nightly recompute job.
 *
 * Pairs raw `combined_score` from the insight against attribution outcome.
 * Requires that attribution records include `insight_score` in metadata.
 */
export function buildCalibrationPairs(
  attributions: Array<{ outcome: string; metadata?: Record<string, unknown> }>,
): CalibrationPair[] {
  const pairs: CalibrationPair[] = []
  for (const a of attributions) {
    const score = a.metadata?.['insight_score']
    if (typeof score !== 'number') continue
    // Skip non-decision outcomes — they carry no user signal.
    // policy_blocked / budget_blocked are system decisions, not user feedback.
    if (a.outcome === 'policy_blocked' || a.outcome === 'budget_blocked') continue
    // Positive signal: user approved or policy auto-approved
    // Negative signal: user dismissed or timeout auto-dismissed
    const outcome: 0 | 1 = (a.outcome === 'approved' || a.outcome === 'auto_approved' || a.outcome === 'converted') ? 1 : 0
    pairs.push({ raw_score: score, outcome })
  }
  return pairs
}
