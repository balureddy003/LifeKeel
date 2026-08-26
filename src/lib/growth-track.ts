/**
 * Minimal first-party funnel tracking — landing view, CTA clicks, signup and
 * family-setup completion, upgrade attempts. No third-party vendor, no PII
 * beyond a client-generated anonymous id; posts to POST /growth/events
 * (apps/api/src/routes/growth-events.ts), which validates the event name
 * against a server-side allowlist.
 */

const ANON_ID_KEY = 'kairos_anon_id'

function getAnonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(ANON_ID_KEY, id)
  }
  return id
}

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
}

export function track(event: string, meta?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  try {
    const token = localStorage.getItem('kairos_token')
    fetch(`${apiBase()}/growth/events`, {
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
