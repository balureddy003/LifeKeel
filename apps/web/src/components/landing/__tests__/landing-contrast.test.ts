/**
 * Token contrast for the landing page. Parses landing.css, so a token edit that
 * drops a text pair below WCAG AA fails here rather than in a browser.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const css = fs.readFileSync(path.resolve(__dirname, '..', 'landing.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + ' {')
  expect(start).toBeGreaterThan(-1)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!
  return out
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, background, minimum ratio]. 4.5 for text, 3 for UI boundaries.
const PAIRS: [string, string, number][] = [
  ['ink', 'bg', 4.5],
  ['ink', 'surface', 4.5],
  ['muted', 'bg', 4.5],
  ['muted', 'surface', 4.5],
  ['brass-text', 'bg', 4.5],
  ['brass-text', 'surface', 4.5],
  ['ok-text', 'bg', 4.5],
  ['ok-text', 'surface', 4.5],
  ['on-cta', 'cta', 4.5],
  ['field-line', 'bg', 3],
  ['field-line', 'surface', 3],
]

describe.each([
  ['light', '.landing'],
  ['dark', ":root[data-theme='dark'] .landing"],
])('landing tokens, %s', (_name, selector) => {
  const t = tokens(selector)
  it.each(PAIRS)('%s on %s is at least %s:1', (fg, bg, min) => {
    expect(t[fg], `missing token ${fg}`).toBeDefined()
    expect(t[bg], `missing token ${bg}`).toBeDefined()
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min)
  })
})

describe('contrast checker', () => {
  it('fails a low-contrast pair (test would fail without it)', () => {
    expect(ratio('#777777', '#888888')).toBeLessThan(4.5)
    expect(ratio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })
})
