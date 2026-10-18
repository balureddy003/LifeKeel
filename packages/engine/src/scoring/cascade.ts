/**
 * Tiered Inference Cascade + Conformal Escalation Gate (ADR-0068).
 *
 * The engine historically gated LLM enrichment with a single magic constant
 * (`or_score < 0.90`). That number is not calibrated, not per-tenant, and gives
 * no statistical guarantee on how often a *skip* (resolving deterministically,
 * without escalating to an LLM) is wrong.
 *
 * This module replaces that constant with a **per-tenant conformal escalation
 * threshold** `tau`:
 *
 *   escalate(insight) ⇔ or_score < tau
 *
 * `tau` is derived by split-conformal calibration over the tenant's labelled
 * history so that the wrong-skip rate is bounded:
 *
 *   P( not escalated | rule result wrong ) ≤ alpha          (default 2%)
 *
 * i.e. of the cases that genuinely needed an LLM, the gate misses at most an
 * `alpha` fraction (escalates at least 1 − alpha of them).
 *
 * Construction: among the calibration samples whose rule result was *wrong*
 * (i.e. they genuinely needed escalation), `tau` is the (1 − alpha) empirical
 * quantile of their `or_score` (with the standard finite-sample correction).
 * By construction at most an `alpha` fraction of wrong-result samples land at or
 * above `tau` and would therefore be skipped — bounding the wrong-skip rate.
 *
 * Determinism: `computeConformalThreshold` and `CascadeScorer.decide` are pure
 * functions of their inputs. Identical inputs + identical calibration version ⇒
 * identical tier decisions. Tiers above the deterministic floor (T2 local LLM,
 * T3 frontier) remain *non-authoritative advisors*; the authoritative blend and
 * achievement decision never depend on them. Only *which* insights escalate is
 * governed here.
 */

/** The cascade tiers (ADR-0068). T0/T1 are deterministic (~0 cost). */
export type CascadeTier = 'T0_rules' | 'T1_predictor' | 'T2_local_llm' | 'T3_frontier'

/**
 * One labelled calibration observation: a rule fired with `or_score`, and
 * `rule_correct` records whether the deterministic result alone was correct
 * (true) or actually needed escalation (false).
 */
export interface ConformalCalibrationSample {
  or_score: number
  rule_correct: boolean
}

/** Result of conformal calibration — the escalation threshold + provenance. */
export interface ConformalThresholdResult {
  /** Escalate to an LLM tier when `or_score < tau`. */
  tau: number
  /** Target wrong-skip bound used to derive `tau`. */
  alpha: number
  /** Number of wrong-result samples the quantile was computed over. */
  calibration_n: number
  /** True when too few samples were available and `fallbackTau` was used. */
  fallback: boolean
  /** Deterministic fingerprint of the calibration inputs (for replay/version). */
  version: string
}

export interface ConformalThresholdOptions {
  /** Target wrong-skip rate bound. Default 0.02. */
  alpha?: number
  /** Threshold used until enough calibration data exists. Default 0.90. */
  fallbackTau?: number
  /** Minimum wrong-result samples required before trusting the quantile. Default 20. */
  minSamples?: number
}

/**
 * Deterministic 32-bit FNV-1a hash → hex string. Used to version a calibration
 * set so that a given (samples, alpha) pair always yields the same `version`,
 * and tier decisions are replayable.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Split-conformal escalation threshold.
 *
 * Returns the smallest sensible `tau` such that skipping escalation for
 * `or_score ≥ tau` is wrong at most an `alpha` fraction of the time, estimated
 * from `samples`. With fewer than `minSamples` wrong-result observations we
 * cannot make a distribution-free claim, so we fall back to `fallbackTau`
 * (preserving the legacy gate's behaviour) and flag `fallback: true`.
 */
export function computeConformalThreshold(
  samples: readonly ConformalCalibrationSample[],
  options: ConformalThresholdOptions = {},
): ConformalThresholdResult {
  const alpha = options.alpha ?? 0.02
  const fallbackTau = options.fallbackTau ?? 0.9
  const minSamples = options.minSamples ?? 20

  // Nonconformity scores = or_score of samples the rules got WRONG. We must
  // escalate those, so tau has to sit above (1 - alpha) of them.
  const wrongScores = samples
    .filter((sample) => !sample.rule_correct)
    .map((sample) => sample.or_score)
    .sort((a, b) => a - b)

  const version = fnv1a(
    `a=${alpha};f=${fallbackTau};m=${minSamples};n=${samples.length};w=${wrongScores.join(',')}`,
  )

  if (wrongScores.length < minSamples) {
    return { tau: fallbackTau, alpha, calibration_n: wrongScores.length, fallback: true, version }
  }

  // Finite-sample conformal quantile: index = ceil((n + 1)(1 - alpha)).
  const n = wrongScores.length
  const rank = Math.ceil((n + 1) * (1 - alpha))
  // rank can exceed n (when alpha is tiny relative to n) → escalate everything
  // that the rules might get wrong, i.e. tau at the top of the score range.
  const tau = rank > n ? Math.max(1, wrongScores[n - 1]!) : wrongScores[rank - 1]!

  return { tau, alpha, calibration_n: n, fallback: false, version }
}

/** Supplies a per-tenant escalation threshold. Deterministic given a version. */
export interface ConformalGateProvider {
  getThreshold(tenant_id: string): ConformalThresholdResult
}

/**
 * In-memory gate built from labelled samples (or pre-computed thresholds) keyed
 * by tenant. Thresholds are computed once and cached; the cache key is the
 * calibration `version` so re-calibration is explicit.
 */
export class StaticConformalGate implements ConformalGateProvider {
  private readonly cache = new Map<string, ConformalThresholdResult>()

  constructor(
    private readonly samplesByTenant: Record<string, readonly ConformalCalibrationSample[]> = {},
    private readonly options: ConformalThresholdOptions = {},
  ) {}

  getThreshold(tenant_id: string): ConformalThresholdResult {
    const cached = this.cache.get(tenant_id)
    if (cached) return cached
    const result = computeConformalThreshold(this.samplesByTenant[tenant_id] ?? [], this.options)
    this.cache.set(tenant_id, result)
    return result
  }
}

/** Minimal view of an insight the cascade needs to make a decision. */
export interface CascadeScorable {
  id: string
  confidence_breakdown: { or_score: number }
}

/** Per-insight escalation decision. */
export interface CascadeDecision {
  insight_id: string
  or_score: number
  tau: number
  escalate: boolean
  tier: CascadeTier
}

/** Aggregate cascade outcome for a batch — including the north-star DRR. */
export interface CascadeTelemetry {
  total: number
  /** Resolved at the deterministic floor (T0/T1), zero LLM cost. */
  deterministic: number
  /** Escalated to an LLM tier (T2/T3). */
  escalated: number
  /** Deterministic Resolution Rate = deterministic / total (1 when total = 0). */
  drr: number
  tau: number
  alpha: number
  calibration_version: string
}

export interface CascadePolicy {
  /** Feature flag. When false the engine keeps the legacy `maxOrScoreToEnrich` gate. Default false. */
  enabled?: boolean
  /** Target wrong-skip bound passed through to calibration. Default 0.02. */
  alpha?: number
  /** Threshold used before calibration data exists. Default 0.90. */
  fallbackTau?: number
  /** Cap escalations per batch (cost guard). Default 10. */
  batchCap?: number
  /**
   * Deterministic Mode: cap the cascade at the deterministic floor — never
   * escalate, results fully reproducible. Used for regulated tenants or
   * budget exhaustion. Never blocks. Default false.
   */
  deterministicMode?: boolean
  /** Tier label recorded for escalated insights. Default 'T3_frontier'. */
  escalationTier?: CascadeTier
}

/**
 * Partitions a batch of insights into a deterministic floor and an escalation
 * set using a conformal threshold, and records DRR telemetry. Pure and
 * order-stable: escalations are taken in input order and capped at `batchCap`.
 */
export class CascadeScorer {
  private readonly alpha: number
  private readonly fallbackTau: number
  private readonly batchCap: number
  private readonly deterministicMode: boolean
  private readonly escalationTier: CascadeTier

  constructor(policy: CascadePolicy = {}) {
    this.alpha = policy.alpha ?? 0.02
    this.fallbackTau = policy.fallbackTau ?? 0.9
    this.batchCap = policy.batchCap ?? 10
    this.deterministicMode = policy.deterministicMode ?? false
    this.escalationTier = policy.escalationTier ?? 'T3_frontier'
  }

  /** Resolve the escalation threshold for a sample set under this policy. */
  threshold(samples: readonly ConformalCalibrationSample[]): ConformalThresholdResult {
    return computeConformalThreshold(samples, {
      alpha: this.alpha,
      fallbackTau: this.fallbackTau,
    })
  }

  /**
   * Decide which insights escalate. `escalate` are the insights below `tau`
   * (capped at `batchCap`, in input order); `deterministic` are the rest, which
   * are authoritative as-is. In Deterministic Mode nothing escalates.
   */
  decide<T extends CascadeScorable>(
    insights: readonly T[],
    threshold: ConformalThresholdResult,
  ): {
    decisions: CascadeDecision[]
    escalate: T[]
    deterministic: T[]
    telemetry: CascadeTelemetry
  } {
    const tau = threshold.tau
    const decisions: CascadeDecision[] = []
    const escalate: T[] = []
    const deterministic: T[] = []

    for (const insight of insights) {
      const orScore = insight.confidence_breakdown.or_score
      const wantsEscalation = !this.deterministicMode && orScore < tau
      const hasCapacity = escalate.length < this.batchCap
      const escalated = wantsEscalation && hasCapacity

      if (escalated) {
        escalate.push(insight)
      } else {
        deterministic.push(insight)
      }
      decisions.push({
        insight_id: insight.id,
        or_score: orScore,
        tau,
        escalate: escalated,
        tier: escalated ? this.escalationTier : 'T0_rules',
      })
    }

    const total = insights.length
    const escalatedCount = escalate.length
    const deterministicCount = total - escalatedCount
    return {
      decisions,
      escalate,
      deterministic,
      telemetry: {
        total,
        deterministic: deterministicCount,
        escalated: escalatedCount,
        drr: total === 0 ? 1 : deterministicCount / total,
        tau,
        alpha: threshold.alpha,
        calibration_version: threshold.version,
      },
    }
  }
}

/**
 * Empirical wrong-skip rate on a held-out labelled set under threshold `tau`.
 *
 * This is the quantity the conformal construction bounds: among the samples the
 * rules got *wrong* (i.e. that genuinely needed escalation), the fraction that
 * were nonetheless *skipped* (or_score ≥ tau, so not escalated) —
 * `P(skipped | needs-escalation)`. The split-conformal `tau` keeps this ≤ alpha,
 * i.e. the gate escalates at least a (1 − alpha) fraction of the cases that
 * truly needed an LLM. Used by the conformance coverage test.
 */
export function empiricalWrongSkipRate(
  samples: readonly ConformalCalibrationSample[],
  tau: number,
): number {
  const needEscalation = samples.filter((sample) => !sample.rule_correct)
  if (needEscalation.length === 0) return 0
  const wronglySkipped = needEscalation.filter((sample) => sample.or_score >= tau).length
  return wronglySkipped / needEscalation.length
}
