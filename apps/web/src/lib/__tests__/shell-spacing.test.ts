import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bottomPaddingClass } from '../shell-spacing'

// The floating SOS button sits above the tab bar, so the last lines of every page (the disclaimer
// included) ended up underneath it with nothing to scroll them clear.
describe('bottomPaddingClass', () => {
  it('leaves room for the tab bar, and for SOS when it is showing', () => {
    expect(bottomPaddingClass({ showNav: true, showEmergency: true })).toBe(
      'app-nav-space app-sos-space',
    )
  })

  it('leaves room for the tab bar only when SOS is switched off', () => {
    expect(bottomPaddingClass({ showNav: true, showEmergency: false })).toBe('app-nav-space')
  })

  it('adds nothing without app navigation', () => {
    expect(bottomPaddingClass({ showNav: false, showEmergency: false })).toBe('')
    expect(bottomPaddingClass({ showNav: false, showEmergency: true })).toBe('')
  })
})

describe('SOS clearance in the stylesheet', () => {
  const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')

  it('adds the SOS height to the dock space on phones', () => {
    const rule = css.match(/\.app-nav-space\.app-sos-space\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/padding-bottom:\s*calc\(var\(--app-dock-space\)\s*\+\s*64px\)/)
  })

  it('takes it away again where the SOS button is hidden (desktop rail)', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 1400px)'))
    expect(desktop).toMatch(/\.app-nav-space\.app-sos-space\s*\{[^}]*padding-bottom:\s*40px/)
  })
})
