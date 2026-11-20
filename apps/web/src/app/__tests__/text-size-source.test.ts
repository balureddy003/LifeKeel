/**
 * Text follows the reader's own size setting. A root size in pixels ignores a browser or phone text
 * size preference, and pixel overrides on phones ignore it again for most body text. jsdom has no
 * layout, so this reads the stylesheet. Checked at 200% on staging-like screens on 2026-11-20: the
 * layouts reflow without sideways scrolling, so the only thing missing was the link to the setting.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(path.join(__dirname, '..', 'globals.css'), 'utf8')

describe('text size follows the reader (source)', () => {
  it('sets the root size as a percentage of the reader setting, not in pixels', () => {
    const rule = css.match(/\nhtml\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/font-size:\s*\d+(\.\d+)?%/)
    expect(rule).not.toMatch(/font-size:\s*\d+(\.\d+)?px/)
  })

  it('keeps the default look: 106.25% of the usual 16px is the 17px it was', () => {
    expect(css.match(/\nhtml\s*\{([^}]*)\}/)?.[1]).toMatch(/font-size:\s*106\.25%/)
  })

  it('has no fixed pixel font sizes left in the stylesheet', () => {
    const offenders = css.split('\n').filter((l) => /font-size:\s*\d+(\.\d+)?px/.test(l))
    expect(offenders).toEqual([])
  })
})
