/**
 * Guards for the P2 items in docs/reviews/e2e-gap-report-2026-10.md: every signed-in route has its
 * own page title, switches and placeholder-only inputs are named, and a few polish fixes stay fixed.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const APP = path.resolve(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(APP, ...p), 'utf8')

// Routes that have their own title elsewhere (public pages) or are not pages a person lands on.
const NO_TITLE_NEEDED = new Set(['__tests__', 'auth', 'operator', 'marketing'])

describe('page titles', () => {
  it('every top-level route has a layout with its own title', () => {
    const missing = fs
      .readdirSync(APP, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !NO_TITLE_NEEDED.has(e.name))
      .filter((e) => {
        const dir = path.join(APP, e.name)
        const hasPage =
          fs.existsSync(path.join(dir, 'page.tsx')) ||
          fs.readdirSync(dir).some((c) => c.startsWith('['))
        if (!hasPage) return false
        const layout = path.join(dir, 'layout.tsx')
        const page = path.join(dir, 'page.tsx')
        const titled = (f: string) =>
          fs.existsSync(f) && /title\s*[:=]/.test(fs.readFileSync(f, 'utf8'))
        return !(titled(layout) || titled(page))
      })
      .map((e) => e.name)
    expect(missing).toEqual([])
  })
})

describe('names and labels', () => {
  it('every settings switch has an accessible name', () => {
    const src = read('settings', 'page.tsx')
    const switches = src.split('role="switch"').slice(1)
    expect(switches.length).toBeGreaterThanOrEqual(3)
    for (const chunk of switches) expect(chunk.slice(0, 200)).toContain('aria-label=')
  })

  it('placeholder-only inputs carry an aria-label', () => {
    for (const [file, ph] of [
      [['cashflow', 'page.tsx'], 'placeholder="0"'],
      [['support', 'page.tsx'], 'placeholder="How do I…? / Why does…?"'],
      [['assistant', 'page.tsx'], 'placeholder="Ask about insurance, retirement, goals..."'],
      [['legacy', 'LegacyClient.tsx'], 'placeholder="Name"'],
    ] as const) {
      const src = read(...file)
      const at = src.indexOf(ph)
      expect(at, `${file.join('/')} ${ph}`).toBeGreaterThan(-1)
      expect(src.slice(at, at + ph.length + 40)).toContain('aria-label=')
    }
  })
})

describe('polish', () => {
  it('upgrade page lists no unevidenced benefit and no real insurer name', () => {
    const src = read('upgrade', 'page.tsx')
    expect(src).not.toContain('Priority support')
    expect(src).not.toContain('Allstate')
  })
  it('the signed-in 404 does not show a sign-in link', () => {
    const src = read('not-found.tsx')
    expect(src).toContain('isAuthenticated')
  })
  it('the referral label shows a full address, not a bare path', () => {
    expect(read('settings', 'page.tsx')).not.toContain('Your link: /signup')
  })
})
