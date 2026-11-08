/**
 * The ink-tertiary colour is tuned to pass WCAG AA (4.5:1) in both themes
 * (see apps/web/tailwind.config.js). Dimming it further with an opacity
 * suffix on TEXT (text-ink-tertiary/60) takes it back below AA: that is how the
 * disclaimer footer failed on every page (2.65:1). Text must use the token as
 * is; the one remaining use is a decorative icon, which is not text.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const SRC = path.join(ROOT, 'apps/web/src')
/** Decorative icons only; not text. */
const ALLOWED = new Set(['apps/web/src/app/inbox/page.tsx'])

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'node_modules' ? [] : walk(p)
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : []
  })
}

describe('dimmed text colour', () => {
  it('no text is dimmed below the AA-tuned token', () => {
    const offenders = walk(SRC)
      .filter((f) => /\btext-ink-tertiary\/\d+/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((f) => !ALLOWED.has(f))
    expect(offenders).toEqual([])
  })

  it('the allow-list is not stale', () => {
    for (const f of ALLOWED)
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).toMatch(/\btext-ink-tertiary\/\d+/)
  })
})
