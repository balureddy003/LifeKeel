/**
 * Drift guard for POST /growth/events.
 *
 * The route answers 400 to any event name outside KNOWN_EVENTS, and the web
 * client swallows that error, so an event the web app sends but the API does
 * not list is silently lost: `landing_quiz_click` and `promo_redeemed` were
 * being dropped this way. This test reads the web source for every literal
 * `track('event_name')` call and fails if the API would reject it.
 *
 * It is a static tripwire: it cannot see an event name built at runtime. Keep
 * event names as string literals at the call site.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { KNOWN_EVENTS } from '../routes/growth-events.js'

const WEB_SRC = path.resolve(__dirname, '..', '..', '..', 'web', 'src')

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

/** Literal event names passed to the web `track()` helper. `trackConversion(` is a different function and is not matched. */
export function trackedEvents(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\btrack\(\s*['"]([a-z0-9_]+)['"]/g)) out.push(m[1]!)
  return out
}

describe('growth events allow-list', () => {
  const found = walk(WEB_SRC).flatMap((f) =>
    trackedEvents(fs.readFileSync(f, 'utf8')).map((event) => ({
      event,
      file: path.relative(WEB_SRC, f),
    })),
  )

  it('finds the web call sites it is meant to guard', () => {
    expect(found.length).toBeGreaterThan(5)
    expect(found.map((f) => f.event)).toContain('landing_view')
  })

  it('every event the web app sends is accepted by the API', () => {
    const rejected = found
      .filter((f) => !KNOWN_EVENTS.has(f.event))
      .map((f) => `${f.file}: ${f.event}`)
    expect(rejected).toEqual([])
  })

  it('accepts the landing events planned for PRD-209', () => {
    for (const e of ['landing_cta_click', 'landing_scenario_select', 'landing_pause_click']) {
      expect(KNOWN_EVENTS.has(e)).toBe(true)
    }
  })

  it('the checker itself catches an unknown event (test would fail without it)', () => {
    const sample = "track('definitely_not_listed', { a: 1 }); trackConversion('signup')"
    expect(trackedEvents(sample)).toEqual(['definitely_not_listed'])
    expect(KNOWN_EVENTS.has('definitely_not_listed')).toBe(false)
  })
})
