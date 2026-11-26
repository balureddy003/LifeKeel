/**
 * How long savings cover spending, in words. One rule for every server sentence (readiness, playbook steps,
 * Keel's saved-records answers) and the web's matching helper (apps/web/src/lib/months.ts): whole months,
 * rounded down. The income-stops estimate is a month-by-month simulation that can only count whole months,
 * so rounding down everywhere keeps one figure across screens ("2.5" and "about 2" read as two answers).
 */
export function coverMonths(months: number): string {
  if (!Number.isFinite(months) || months < 1) return 'less than a month'
  const whole = Math.floor(months)
  return `about ${whole} ${whole === 1 ? 'month' : 'months'}`
}
