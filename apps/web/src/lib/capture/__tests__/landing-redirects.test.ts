/**
 * The landing sites send app routes to the app. Every top-level app page has
 * to be in that list, or a link to it from a landing domain lands on a 404.
 * This checks the new family-list pages; add a route to the regex when you add
 * a top-level page.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'firebase.json'), 'utf8'),
)
const landings = config.hosting.filter((h: { target: string }) =>
  String(h.target).startsWith('landing'),
)

describe('landing redirects to the app', () => {
  it('there is at least one landing target with an app-route redirect', () => {
    expect(landings.length).toBeGreaterThan(0)
  })

  for (const route of ['/domains', '/domains/', '/domains/?d=car']) {
    it(`sends ${route} to the app on every landing target`, () => {
      for (const h of landings as Array<{
        target: string
        redirects?: Array<{ regex?: string }>
      }>) {
        const re = (h.redirects ?? []).filter((r) => r.regex).map((r) => new RegExp(r.regex!))
        const path_ = route.split('?')[0]!
        expect(
          re.some((r) => r.test(path_)),
          `${h.target}: ${route}`,
        ).toBe(true)
      }
    })
  }
})
