/**
 * A query-string integer clamped to [min, max], or `fallback` when absent or
 * not a number (ISSUES M02). Raw parseInt output must never reach MongoDB:
 * limit(0) means "no limit", NaN throws, and a negative skip is an error.
 */
export function boundedQueryInt(
  raw: string | undefined,
  { fallback, min, max }: { fallback: number; min: number; max: number },
): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}
