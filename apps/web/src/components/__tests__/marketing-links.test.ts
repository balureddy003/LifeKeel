/**
 * Pages served on the landing hosts (lifekeel.co.uk, lifekeel.si) must reach the
 * app through `appUrl()` and a plain `<a>`. The landing hosts answer /welcome,
 * /signup and /login with a cross-origin 302 to the app host, and a `next/link`
 * to those paths makes Next fetch the RSC payload (`/welcome/index.txt`)
 * across that redirect, which fails and lands the visitor on the raw payload.
 *
 * Static tripwire over the public pages. If a new public page needs an app link,
 * add it to PUBLIC_FILES and use `appUrl()`.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..', '..')

const PUBLIC_FILES = [
  'components/MarketingLanding.tsx',
  'app/readiness/page.tsx',
  'app/blog/page.tsx',
  'app/blog/[slug]/BlogPostClient.tsx',
  'app/guides/page.tsx',
  'app/guides/[slug]/page.tsx',
]

const APP_ROUTE_LINK = /<Link\b[^>]*\bhref=\{?["'`]\/(welcome|signup|login)\b/

export function appRouteLinks(text: string): string[] {
  return text
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && APP_ROUTE_LINK.test(line))
    .map(({ line, n }) => `${n}: ${line.trim()}`)
}

describe('public pages link to the app host with appUrl()', () => {
  it('no public page uses next/link for /welcome, /signup or /login', () => {
    const offenders = PUBLIC_FILES.flatMap((f) =>
      appRouteLinks(fs.readFileSync(path.join(SRC, f), 'utf8')).map((l) => `${f}:${l}`),
    )
    expect(offenders).toEqual([])
  })

  it('the landing page builds its sign-in and get-started links with appUrl()', () => {
    const text = fs.readFileSync(path.join(SRC, 'components/MarketingLanding.tsx'), 'utf8')
    expect(text).toContain("appUrl('/welcome')")
    expect(text).toContain("appUrl('/login')")
  })

  it('the checker itself catches a router link to an app route (test would fail without it)', () => {
    expect(appRouteLinks('<Link href="/welcome" className="x">Get started</Link>')).toHaveLength(1)
    expect(appRouteLinks('<Link href={`/signup`}>x</Link>')).toHaveLength(1)
    expect(appRouteLinks("<a href={appUrl('/welcome')}>x</a>")).toHaveLength(0)
    expect(appRouteLinks('<Link href="/readiness">x</Link>')).toHaveLength(0)
  })
})
