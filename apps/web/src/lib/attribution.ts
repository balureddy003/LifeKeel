/**
 * First-touch marketing attribution — captures UTM params, referrer, and
 * landing path once, persists in localStorage, and is attached to signup
 * and lead-capture requests so the operator console can answer "where did
 * this account come from?".
 *
 * First-touch wins on purpose: a visitor who arrived via a social post and
 * later returned via Google still attributes to the post. Deliberately
 * minimal — five utm_* fields plus referrer/path, no fingerprinting.
 */

const KEY = 'lifekeel_attribution'
/** Most recent attributed visit — overwritten on each one, unlike the first touch. */
const LAST_KEY = 'lifekeel_last_touch'

export interface Attribution {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer?: string
  landing_path?: string
  captured_at: string
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

/** True when `referrer` is a different site (a same-site click is not a new touch). */
function isExternalReferrer(referrer: string): boolean {
  try {
    return !!referrer && new URL(referrer).hostname !== window.location.hostname
  } catch {
    return false
  }
}

/**
 * Read current URL params. The first attributed visit is kept as first touch;
 * every attributed visit (UTM params or an external referrer) replaces the
 * last touch. A direct visit with nothing to say claims neither slot.
 */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return
  try {
    const params = new URLSearchParams(window.location.search)
    const attribution: Attribution = {
      landing_path: window.location.pathname.slice(0, 200),
      captured_at: new Date().toISOString(),
    }
    let any = false
    for (const key of UTM_KEYS) {
      const value = params.get(key)?.slice(0, 120)
      if (value) {
        attribution[key] = value
        any = true
      }
    }
    const referrer = document.referrer.slice(0, 300)
    if (referrer && isExternalReferrer(referrer)) {
      attribution.referrer = referrer
      any = true
    }
    // Only persist when there's something to say — a direct visit with no
    // params shouldn't permanently claim a slot before a later attributed visit.
    if (!any) return
    localStorage.setItem(LAST_KEY, JSON.stringify(attribution))
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(attribution))
  } catch {
    // Locked-down browser contexts — attribution is best-effort, never fatal.
  }
}

export function getAttribution(): Attribution | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return undefined
    return JSON.parse(raw) as Attribution
  } catch {
    return undefined
  }
}

/** The most recent attributed visit, for last-touch comparison. */
export function getLastTouch(): Attribution | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (!raw) return undefined
    return JSON.parse(raw) as Attribution
  } catch {
    return undefined
  }
}
