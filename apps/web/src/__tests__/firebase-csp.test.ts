/**
 * Guards for the Firebase Hosting Content-Security-Policy and the deploy-time sync script.
 *
 * Why these exist: loading the real static export in a browser under the old policy showed the app never
 * hydrated (0 inputs, 12 refused inline scripts), and a mismatched API origin made every API call refuse.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { withConnectOrigin, apiOrigin, syncFirebaseConfig } from '../../scripts/sync-csp.mjs'

const config = () => JSON.parse(readFileSync(path.resolve(__dirname, '../../firebase.json'), 'utf8'))
const cspOf = (c: ReturnType<typeof config>): string =>
  c.hosting.headers.flatMap((g: { headers: { key: string; value: string }[] }) => g.headers).find((h: { key: string }) => h.key === 'Content-Security-Policy').value

const directive = (csp: string, name: string): string[] =>
  (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name)) ?? '').split(/\s+/).slice(1)

describe('committed firebase.json CSP', () => {
  const csp = cspOf(config())

  it("allows inline scripts: Next's static export bootstraps with inline <script> blocks, so the app is dead without it", () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'")
  })

  it('still blocks eval, framing, plugins and foreign base/form targets', () => {
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-eval'")
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"])
    expect(directive(csp, 'object-src')).toEqual(["'none'"])
    expect(directive(csp, 'base-uri')).toEqual(["'self'"])
    expect(directive(csp, 'form-action')).toEqual(["'self'"])
  })

  it('allows the Cloud Run API by default', () => {
    expect(directive(csp, 'connect-src')).toContain('https://*.run.app')
  })
})

describe('sync-csp', () => {
  const base = "default-src 'self'; connect-src 'self' https://*.run.app; frame-ancestors 'none'"

  it('adds a custom API origin to connect-src and leaves other directives alone', () => {
    const out = withConnectOrigin(base, 'https://api.lifekeel.co.uk')
    expect(directive(out, 'connect-src')).toEqual(["'self'", 'https://*.run.app', 'https://api.lifekeel.co.uk'])
    expect(directive(out, 'frame-ancestors')).toEqual(["'none'"])
  })

  it('does not add an origin already covered by the *.run.app wildcard, or add one twice', () => {
    expect(withConnectOrigin(base, 'https://lifekeel-api-abc-nw.a.run.app')).toBe(base)
    const once = withConnectOrigin(base, 'https://api.lifekeel.co.uk')
    expect(withConnectOrigin(once, 'https://api.lifekeel.co.uk')).toBe(once)
  })

  it('does not treat a lookalike host as covered by the wildcard', () => {
    const out = withConnectOrigin(base, 'https://evilrun.app')
    expect(directive(out, 'connect-src')).toContain('https://evilrun.app') // added explicitly, not silently matched
    expect(withConnectOrigin(base, 'https://run.app.evil.com')).not.toBe(base)
  })

  it('reduces an API URL to its origin', () => {
    expect(apiOrigin('https://api.lifekeel.co.uk/v1/x?y=1')).toBe('https://api.lifekeel.co.uk')
    expect(apiOrigin('')).toBeNull()
  })

  it('syncs a whole firebase config and reports whether anything changed', () => {
    const r1 = syncFirebaseConfig(config(), 'https://api.lifekeel.co.uk')
    expect(r1.changed).toBe(true)
    expect(directive(cspOf(r1.config), 'connect-src')).toContain('https://api.lifekeel.co.uk')
    const r2 = syncFirebaseConfig(r1.config, 'https://api.lifekeel.co.uk')
    expect(r2.changed).toBe(false)
  })
})
