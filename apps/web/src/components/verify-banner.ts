/**
 * The verify-email banner is a trust nudge, not a promo, so it comes back: but not on every
 * screen of every visit. After "dismiss" it stays quiet for three days, then asks again until the
 * address is verified.
 */
export const BANNER_QUIET_MS = 3 * 24 * 60 * 60 * 1000

/** `stored` is the time (ms since epoch) of the last dismissal, as saved. */
export function bannerDismissed(stored: string | null, now: number): boolean {
  if (!stored) return false
  const at = Number(stored)
  if (!Number.isFinite(at) || at < 1e12) return false
  return now - at < BANNER_QUIET_MS
}
