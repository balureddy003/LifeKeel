/**
 * Tap targets are 48px. jsdom has no layout, so this reads the source: the one
 * global rule every button and link inherits, and the hard-coded 44px classes
 * that would undercut it. Measured on staging at 375px on 2026-11-08: most
 * controls were 44px because of this rule.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.join(__dirname, '..', '..')
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'operator') continue
      walk(p, out)
    } else if (/\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

describe('48px tap targets (source)', () => {
  it('the global button and link rule asks for 48px, not 44px', () => {
    const css = read('app/globals.css')
    const rule = css.match(/\nbutton, a \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/min-height:\s*48px/)
    expect(rule).toMatch(/min-width:\s*48px/)
  })

  it('selects and text fields are at least 48px tall', () => {
    const css = read('app/globals.css')
    expect(css).toMatch(/select,[^{]*\{[^}]*min-height:\s*48px/)
  })

  it('no screen outside the operator console hard-codes a 44px target', () => {
    const offenders = walk(SRC)
      .filter((f) => /min-h-\[44px\]|\bmin-h-11\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
