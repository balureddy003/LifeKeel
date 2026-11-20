import { describe, expect, it } from 'vitest'
import { shouldShowBrandHeader } from '../shell-chrome'

const base = {
  showNav: false,
  isMarketingPage: false,
  isOperatorRoute: false,
  ownsLayout: false,
  signedOutFallback: false,
  isLoading: false,
}

// The brand header frames only the screens before a household exists. While the household is
// still loading the shell cannot tell "no household" from "not here yet", and showing it then made
// it appear for a few seconds and vanish, jumping the whole page up.
describe('shouldShowBrandHeader', () => {
  it('shows for a signed-in person with no household yet', () => {
    expect(shouldShowBrandHeader(base)).toBe(true)
  })

  it('does not show while the household is still loading', () => {
    expect(shouldShowBrandHeader({ ...base, isLoading: true })).toBe(false)
  })

  it('does not show once the app navigation is up (each page has its own title)', () => {
    expect(shouldShowBrandHeader({ ...base, showNav: true })).toBe(false)
  })

  it.each(['isMarketingPage', 'isOperatorRoute', 'ownsLayout', 'signedOutFallback'] as const)(
    'does not show when %s',
    (flag) => {
      expect(shouldShowBrandHeader({ ...base, [flag]: true })).toBe(false)
    },
  )
})
