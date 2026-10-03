/**
 * Ad-platform conversion events — thin wrappers over the tag globals
 * loaded by components/AdPixels.tsx + GoogleAnalytics.tsx. Every call
 * no-ops when its tag isn't configured, so call sites never need to
 * check env vars.
 *
 * First-party attribution (growth_events → operator funnel) remains the
 * source of truth; these exist so the ad platforms' own optimizers can
 * see conversions and bid toward them instead of clicks.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    lintrk?: (action: string, data?: Record<string, unknown>) => void
    gtag?: (...args: unknown[]) => void
  }
}

export type AdConversion = 'signup' | 'lead'

/** Google Ads conversion labels are per-action strings from the Ads UI
 *  (send_to: 'AW-XXXXX/<label>') — configured via env, absent = skip. */
const GADS_SEND_TO: Partial<Record<AdConversion, string | undefined>> = {
  signup: process.env.NEXT_PUBLIC_GADS_SEND_TO_SIGNUP,
  lead: process.env.NEXT_PUBLIC_GADS_SEND_TO_LEAD,
}
const LINKEDIN_CONV: Partial<Record<AdConversion, string | undefined>> = {
  signup: process.env.NEXT_PUBLIC_LINKEDIN_CONV_SIGNUP,
  lead: process.env.NEXT_PUBLIC_LINKEDIN_CONV_LEAD,
}

export function trackConversion(event: AdConversion): void {
  try {
    if (typeof window === 'undefined') return
    // Meta's standard event names map cleanly: CompleteRegistration for
    // account creation, Lead for the quiz email capture.
    window.fbq?.('track', event === 'signup' ? 'CompleteRegistration' : 'Lead')
    const sendTo = GADS_SEND_TO[event]
    if (sendTo) window.gtag?.('event', 'conversion', { send_to: sendTo })
    const liConv = LINKEDIN_CONV[event]
    if (liConv) window.lintrk?.('track', { conversion_id: liConv })
  } catch {
    // Tracking must never break the user flow it observes.
  }
}
