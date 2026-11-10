import { describe, expect, it } from 'vitest'
import { BANNER_QUIET_MS, bannerDismissed } from '../verify-banner'

describe('verify-email banner quiet period', () => {
  const now = 1_700_000_000_000
  it('stays hidden for three days after it is dismissed, then asks again', () => {
    expect(BANNER_QUIET_MS).toBe(3 * 24 * 60 * 60 * 1000)
    expect(bannerDismissed(String(now - 60_000), now)).toBe(true)
    expect(bannerDismissed(String(now - BANNER_QUIET_MS + 1000), now)).toBe(true)
    expect(bannerDismissed(String(now - BANNER_QUIET_MS - 1000), now)).toBe(false)
  })
  it('shows it when nothing was stored or the value is not a time', () => {
    expect(bannerDismissed(null, now)).toBe(false)
    expect(bannerDismissed('1', now)).toBe(false)
    expect(bannerDismissed('soon', now)).toBe(false)
  })
})
