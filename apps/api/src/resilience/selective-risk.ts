/**
 * Selective-risk gate (intent 97, slice 4) — Tier 0 groundwork.
 *
 * Decides `review` | `accept` for an extracted field class from the slice-1
 * engine-metric counts (confirmed-unchanged vs corrected verdicts). A class
 * may be auto-accepted only when a conservative upper confidence bound on its
 * observed error rate sits under the owner's alpha, the verified sample clears
 * the owner's minimum, the document's mechanical checks passed, and a held-out
 * verifier set exists. Everything else is `review`.
 *
 * Review-by-default until the owner sets parameters: SELECTIVE_RISK_PARAMS is
 * deliberately null/empty, so every decision is `review` today. The owner PR
 * that sets alpha/minSample/eligibleClasses is the activation gate — there is
 * no runtime switch. Money-in and money-out classes are permanently
 * review-only in the first release (NEVER_AUTO_ACCEPT), regardless of params.
 *
 * No model call, no cross-household learning, no free text: inputs are counts
 * and closed enums only. This module never mutates anything — it is a pure
 * function over counts.
 */

export interface ClassCounts {
  /** Verdicts where the person confirmed the suggestion unchanged. */
  confirmedUnchanged: number
  /** Verdicts where the person corrected at least one figure. */
  corrected: number
}

export interface SelectiveRiskParams {
  /** Max tolerated upper bound on the class error rate (e.g. 0.01 = 1%). */
  alpha: number | null
  /** Minimum verified samples before a class may qualify (proposed: 300). */
  minSample: number | null
  /** Confidence level for the bound (default 0.95). */
  confidence?: number
  /** Low-consequence field classes the owner has cleared for auto-accept. */
  eligibleClasses?: readonly string[]
}

/**
 * Owner-set gate parameters. `null` until the owner decides — the proposed
 * starting point (bound under 1%, ≥300 verified samples) lives in intent 97,
 * not here, because real verifier history does not exist yet.
 */
export const SELECTIVE_RISK_PARAMS: SelectiveRiskParams = {
  alpha: null,
  minSample: null,
  confidence: 0.95,
  eligibleClasses: [],
}

/**
 * Field classes feeding the household resilience estimate — behind the
 * both-adults confirmation gate. Permanently review-only in the first
 * release: a wrong money figure must never skip a person.
 */
export const NEVER_AUTO_ACCEPT: ReadonlySet<string> = new Set([
  'statement_money_in',
  'statement_money_out',
  'net_pay',
  'gross_pay',
  'coverage_amount',
  'premium',
  'balance',
])

/** z-score for the confidence level (two-sided). 0.95 → 1.959964. */
function zScore(confidence: number): number {
  // Acklam's inverse-normal approximation — deterministic, no dependency.
  const p = 1 - (1 - confidence) / 2
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  const phigh = 1 - plow
  let x: number
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    x =
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  } else if (p <= phigh) {
    const q = p - 0.5
    const r = q * q
    x =
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x =
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  }
  return x
}

/**
 * Wilson score upper bound on a binomial error rate — conservative for small
 * samples, monotone non-increasing in n at a fixed error rate, and never below
 * the observed rate. Returns 1 for n = 0 (callers gate on minSample anyway).
 */
export function wilsonUpperBound(errors: number, total: number, confidence = 0.95): number {
  if (total <= 0) return 1
  const z = zScore(confidence)
  const p = errors / total
  const z2 = z * z
  const denom = 1 + z2 / total
  const centre = (p + z2 / (2 * total)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom
  return Math.min(1, centre + half)
}

export type RiskDecision = 'review' | 'accept'

export interface SelectiveRiskInput {
  /** The extracted field class being decided (FieldClass from engine-metrics). */
  fieldClass: string
  /** Verified verdict counts for this class. */
  counts: ClassCounts
  /** A held-out verifier set (data the tuning never saw) exists. */
  verifierSetReady: boolean
  /** The mechanical checks passed for this document. */
  mechanicalChecksPassed: boolean
}

/**
 * The gate. Order matters: configuration, permanent exclusions, eligibility,
 * provenance gates, sample size, then the statistical bound. Any failure is
 * `review` — acceptance is earned, never defaulted.
 */
export function selectiveRiskDecision(
  input: SelectiveRiskInput,
  params: SelectiveRiskParams = SELECTIVE_RISK_PARAMS,
): RiskDecision {
  if (params.alpha === null || params.minSample === null) return 'review'
  if (params.alpha <= 0 || params.alpha > 1 || params.minSample <= 0) return 'review'
  if (NEVER_AUTO_ACCEPT.has(input.fieldClass)) return 'review'
  if (!params.eligibleClasses?.includes(input.fieldClass)) return 'review'
  if (!input.verifierSetReady || !input.mechanicalChecksPassed) return 'review'
  const total = input.counts.confirmedUnchanged + input.counts.corrected
  if (total < params.minSample) return 'review'
  const bound = wilsonUpperBound(input.counts.corrected, total, params.confidence ?? 0.95)
  return bound < params.alpha ? 'accept' : 'review'
}

/**
 * Fold slice-1 engine-metric event rows into per-class verdict counts.
 * `extraction_confirmed_unchanged` and `extraction_corrected` are the only
 * verdict events; everything else is ignored. Rows with field_class 'none'
 * carry no class and are skipped.
 */
export function classCountsFromEvents(
  events: readonly { event?: string; field_class?: string }[],
): Map<string, ClassCounts> {
  const out = new Map<string, ClassCounts>()
  for (const e of events) {
    if (e.field_class === undefined || e.field_class === 'none') continue
    const counts = out.get(e.field_class) ?? { confirmedUnchanged: 0, corrected: 0 }
    if (e.event === 'extraction_confirmed_unchanged') counts.confirmedUnchanged += 1
    else if (e.event === 'extraction_corrected') counts.corrected += 1
    else continue
    out.set(e.field_class, counts)
  }
  return out
}
