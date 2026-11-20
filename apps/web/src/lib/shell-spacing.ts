/**
 * Bottom space the page needs under its last line. The tab bar always takes some; the floating SOS
 * button sits above it, so when SOS is showing the page needs its height too (see globals.css).
 */
export function bottomPaddingClass(s: { showNav: boolean; showEmergency: boolean }): string {
  if (!s.showNav) return ''
  return s.showEmergency ? 'app-nav-space app-sos-space' : 'app-nav-space'
}
