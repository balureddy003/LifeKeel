/**
 * Minimal first-party funnel tracking — landing view, CTA clicks, signup and
 * family-setup completion, upgrade attempts. No third-party vendor, no PII
 * beyond a client-generated anonymous id; posts to POST /growth/events
 * (apps/api/src/routes/growth-events.ts), which validates the event name
 * against a server-side allowlist.
 */

import { getApiBase } from './env'
import { credFetch } from './http'
import { captureAttribution } from './attribution'
import { getSessionToken } from '@/lib/session-token'

const ANON_ID_KEY = 'lifekeel_anon_id'

function getAnonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ANON_ID_KEY, id)
  }
  return id
}

export function track(event: string, meta?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  // Every marketing surface calls track() on mount, so this doubles as the
  // first-touch attribution capture point — utm_*/referrer land before any
  // later signup or lead-capture reads them.
  captureAttribution()
  try {
    const token = getSessionToken()
    credFetch(`${getApiBase()}/growth/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ event, path: window.location.pathname, anon_id: getAnonId(), meta }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // localStorage/crypto can throw in locked-down browser contexts — never
    // let tracking break the page it's tracking.
  }
}

/** The utm_* tags on the current URL, for events that start a visit (PRD-210 funnel). */
export function currentUtm(): Record<string, string> | undefined {
  if (typeof window === 'undefined') return undefined
  const out: Record<string, string> = {}
  const q = new URLSearchParams(window.location.search)
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'] as const) {
    const v = q.get(k)
    if (v) out[k] = v.slice(0, 100)
  }
  return Object.keys(out).length ? out : undefined
}
