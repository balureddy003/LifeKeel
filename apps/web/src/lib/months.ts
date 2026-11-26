/**
 * How long savings cover spending, in words: whole months, rounded down. Mirrors the server's
 * apps/api/src/format/months.ts so the Home tile, What If and Keel never give 2.5 beside "about 2"
 * for the same figures. Over five years is stated as such.
 */
export function coverMonths(months: number): string {
  if (!Number.isFinite(months) || months < 1) return 'less than a month'
  if (months > 60) return 'more than five years'
  const whole = Math.floor(months)
  return `about ${whole} ${whole === 1 ? 'month' : 'months'}`
}
