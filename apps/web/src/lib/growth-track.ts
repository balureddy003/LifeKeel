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
    const token = localStorage.getItem('lifekeel_token')
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
