#!/usr/bin/env node
/**
 * Keep firebase.json's Content-Security-Policy `connect-src` in step with the API origin that the web build
 * has baked in (NEXT_PUBLIC_API_URL). If they drift, the browser refuses EVERY API call and the app looks
 * dead; verified by loading the real export in a browser with a mismatched API origin.
 *
 *   NEXT_PUBLIC_API_URL=https://api.example.com node scripts/sync-csp.mjs [path/to/firebase.json]
 *
 * Run by deploy-web.yml before `firebase deploy`. Idempotent; changes only the connect-src of the CSP header.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Return the CSP with `origin` added to connect-src (unchanged if already allowed, or covered by a wildcard). */
export function withConnectOrigin(csp, origin) {
  const directives = csp.split(';').map((d) => d.trim()).filter(Boolean)
  const i = directives.findIndex((d) => d.startsWith('connect-src'))
  if (i === -1) return csp
  const sources = directives[i].split(/\s+/).slice(1)
  const host = new URL(origin).host
  const covered = sources.some((s) => {
    if (s === origin) return true
    const m = /^https:\/\/\*\.(.+)$/.exec(s) // https://*.run.app covers any subdomain of run.app
    return m ? host.endsWith('.' + m[1]) && origin.startsWith('https://') : false
  })
  if (!covered) directives[i] = `${directives[i]} ${origin}`
  return directives.join('; ')
}

/** The origin (scheme + host + port) of an API URL, or null for local/unset values. */
export function apiOrigin(url) {
  if (!url) return null
  const u = new URL(url)
  return u.origin
}

export function syncFirebaseConfig(config, apiUrl) {
  const origin = apiOrigin(apiUrl)
  if (!origin) return { config, changed: false }
  let changed = false
  for (const group of config.hosting.headers ?? []) {
    for (const h of group.headers ?? []) {
      if (h.key !== 'Content-Security-Policy') continue
      const next = withConnectOrigin(h.value, origin)
      if (next !== h.value) { h.value = next; changed = true }
    }
  }
  return { config, changed }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? new URL('../firebase.json', import.meta.url).pathname
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  if (!apiUrl) { console.error('NEXT_PUBLIC_API_URL is not set'); process.exit(1) }
  if (!apiUrl.startsWith('https://')) {
    // The CSP also sets upgrade-insecure-requests, and a production API must be served over TLS.
    console.error(`NEXT_PUBLIC_API_URL must be an https:// URL for a deploy (got ${apiUrl})`)
    process.exit(1)
  }
  const { config, changed } = syncFirebaseConfig(JSON.parse(readFileSync(file, 'utf8')), apiUrl)
  if (changed) writeFileSync(file, JSON.stringify(config, null, 2) + '\n')
  console.log(changed ? `CSP connect-src now allows ${apiOrigin(apiUrl)}` : `CSP connect-src already allows ${apiOrigin(apiUrl)}`)
}
