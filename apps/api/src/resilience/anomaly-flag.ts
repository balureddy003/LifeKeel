/**
 * Deterministic anomaly baseline (intent 97, slice 8) — the explainable floor
 * a future learned helper (CatBoost, blocked on slice-3 fixtures) must beat.
 *
 * Flags months whose money-in or money-out total sits far from the series'
 * own median, using the median absolute deviation (MAD) and the standard
 * modified z-score (0.6745·(x−median)/MAD, threshold 3.5 — the conventional
 * robust-outlier cutoff). Pure, deterministic, read-only: input is the
 * household's own monthly totals, output is period + direction + score —
 * never the amounts themselves, so a flag can be shown without re-disclosing
 * the figure (CLAUDE.md rule 3).
 *
 * Conservative by construction: too few points, a zero MAD (a perfectly
 * steady series cannot bound a deviation), or |z| ≤ threshold all produce no
 * flag. It steers nothing and triggers nothing — a flag is information for a
 * person, like every other Tier-0 output.
 */

export interface MonthTotal {
  /** e.g. '2026-01' — an opaque period label, not content. */
  period: string
  /** Whole minor units for the month. */
  amountMinor: number
}

export type AnomalyMetric = 'money_in' | 'money_out'

export interface AnomalyFlag {
  period: string
  metric: AnomalyMetric
  direction: 'high' | 'low'
  /** Modified z-score magnitude, rounded to 3dp. */
  score: number
}

export interface AnomalyOptions {
  metric: AnomalyMetric
  /** |modified z| above this flags. Conventional robust cutoff: 3.5. */
  threshold?: number
  /** Fewer points than this → no flags (a baseline needs a baseline). */
  minSamples?: number
}

const MODIFIED_Z_SCALE = 0.6745

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/**
 * Flag unusual months in one metric's series. Returns flags sorted by period.
 * Amounts never appear in the output.
 */
export function flagUnusualTotals(
  totals: readonly MonthTotal[],
  opts: AnomalyOptions,
): AnomalyFlag[] {
  const threshold = opts.threshold ?? 3.5
  const minSamples = opts.minSamples ?? 6
  if (totals.length < minSamples) return []

  const amounts = totals.map((t) => t.amountMinor)
  const med = median(amounts)
  const mad = median(amounts.map((a) => Math.abs(a - med)))
  if (mad === 0) return [] // steady series: no robust scale to measure against

  const flags: AnomalyFlag[] = []
  for (const t of totals) {
    const z = (MODIFIED_Z_SCALE * (t.amountMinor - med)) / mad
    if (Math.abs(z) <= threshold) continue
    flags.push({
      period: t.period,
      metric: opts.metric,
      direction: z > 0 ? 'high' : 'low',
      score: Math.round(Math.abs(z) * 1000) / 1000,
    })
  }
  return flags.sort((a, b) => a.period.localeCompare(b.period))
}
