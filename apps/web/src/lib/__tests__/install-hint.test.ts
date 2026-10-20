/** PRD-147: when the install hint may appear. */
import { describe, expect, it } from 'vitest'
import { chooseHint, dismissalActive, isIOSInAppBrowser } from '../install-hint'

const NOW = Date.UTC(2026, 9, 20)
const base = {
  authenticated: true,
  standalone: false,
  nativeShell: false,
  ios: false,
  ua: 'Mozilla/5.0 Chrome',
  visits: 2,
  dismissedAt: null,
  now: NOW,
  hasPrompt: true,
}

describe('chooseHint', () => {
  it('offers the install prompt from the second visit', () => {
    expect(chooseHint(base)).toBe('prompt')
    expect(chooseHint({ ...base, visits: 1 })).toBeNull()
  })
  it('stays hidden when signed out, installed, in the native shell, or with no prompt', () => {
    expect(chooseHint({ ...base, authenticated: false })).toBeNull()
    expect(chooseHint({ ...base, standalone: true })).toBeNull()
    expect(chooseHint({ ...base, nativeShell: true })).toBeNull()
    expect(chooseHint({ ...base, hasPrompt: false })).toBeNull()
  })
  it('gives iOS steps, and an open-in-Safari note inside in-app browsers', () => {
    expect(chooseHint({ ...base, ios: true, hasPrompt: false })).toBe('ios')
    expect(
      chooseHint({ ...base, ios: true, ua: 'Mozilla/5.0 Instagram 300', hasPrompt: false }),
    ).toBe('ios_in_app')
  })
  it('honours a dismissal for 90 days, then asks again', () => {
    const day = 86_400_000
    expect(chooseHint({ ...base, dismissedAt: String(NOW - 89 * day) })).toBeNull()
    expect(chooseHint({ ...base, dismissedAt: String(NOW - 91 * day) })).toBe('prompt')
    expect(dismissalActive('garbage', NOW)).toBe(false)
  })
  it('detects in-app browsers', () => {
    expect(isIOSInAppBrowser('Mozilla/5.0 FBAV/400')).toBe(true)
    expect(isIOSInAppBrowser('Mozilla/5.0 Safari/604')).toBe(false)
  })
})
