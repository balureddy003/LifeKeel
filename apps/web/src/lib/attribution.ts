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

/** Read current URL params and persist attribution if not already stored. */
export function captureAttribution(): void {
  if (typeof window === 'undefined') return
  try {
    if (localStorage.getItem(KEY)) return
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
    if (referrer) {
      attribution.referrer = referrer
      any = true
    }
    // Only persist when there's something to say — a direct visit with no
    // params shouldn't permanently claim the first-touch slot before a
    // later attributed visit.
    if (any) localStorage.setItem(KEY, JSON.stringify(attribution))
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
