/**
 * Consent for non-essential cookies and similar storage (PECR reg. 6, R36).
 *
 * Advertising and analytics tags (GA4, Google Ads, Meta Pixel, LinkedIn)
 * load only after an explicit "Accept", only on public marketing pages,
 * and only for signed-out visitors. Nothing loads by default, and
 * "Reject" is offered with the same weight as "Accept". The choice can be
 * changed at any time from the privacy page.
 *
 * The choice is kept on this device. That is the conventional place for a
 * cookie preference, and it is read before any tag could load.
 */

export type ConsentChoice = 'accepted' | 'rejected'

const KEY = 'lk_cookie_consent_v1'
const EVENT = 'lk-consent-change'

/** True when any tracker ID was configured at build time; otherwise there is nothing to consent to. */
export const TRACKERS_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ||
  process.env.NEXT_PUBLIC_GADS_CONVERSION_ID ||
  process.env.NEXT_PUBLIC_META_PIXEL_ID ||
  process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID,
)

/**
 * Pages a tag may run on. Anything else (the signed-in app, recovery and
 * invite links, which carry tokens in the URL) never loads one.
 */
const TRACKABLE_PREFIXES = ['/blog', '/guides', '/readiness', '/trust', '/security', '/support']

export function isTrackablePath(pathname: string, signedIn: boolean): boolean {
  if (signedIn) return false
  if (pathname === '/' || pathname === '/signup') return true
  return TRACKABLE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function readConsent(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'accepted' || value === 'rejected' ? value : null
  } catch {
    return null
  }
}

export function writeConsent(choice: ConsentChoice): void {
  const previous = readConsent()
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* storage blocked: the choice applies to this page view only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: choice }))
  // A script that already loaded can't be unloaded; a reload is the only
  // way withdrawal takes effect immediately.
  if (previous === 'accepted' && choice === 'rejected') window.location.reload()
}

/** Re-opens the banner (the privacy page's "Cookie settings" button). */
export function reopenConsent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing stored */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: null }))
}

export function onConsentChange(handler: () => void): () => void {
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
