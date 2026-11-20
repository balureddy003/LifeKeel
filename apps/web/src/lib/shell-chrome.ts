/**
 * Which top-of-page chrome the app shell draws. Pure, so it can be tested without rendering the
 * shell.
 */
export function shouldShowBrandHeader(s: {
  showNav: boolean
  isMarketingPage: boolean
  isOperatorRoute: boolean
  ownsLayout: boolean
  signedOutFallback: boolean
  /** Sign-in is still being checked, or the household is still being fetched. */
  isLoading: boolean
}): boolean {
  return (
    !s.isLoading &&
    !s.showNav &&
    !s.isMarketingPage &&
    !s.isOperatorRoute &&
    !s.ownsLayout &&
    !s.signedOutFallback
  )
}
