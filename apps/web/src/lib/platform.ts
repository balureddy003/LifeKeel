/**
 * Platform detection for PWA install/push behavior.
 *
 * Two facts drive several UX decisions in one place rather than scattering
 * UA-sniffing through pages:
 *
 * - iOS only supports web push (and the app-badge API) from an *installed*
 *   PWA — in regular Safari the PushManager surface exists but subscribing
 *   fails, so a plain "enable push" toggle there is a dead control.
 * - There is no programmatic install prompt on iOS at all; the only path is
 *   Share → "Add to Home Screen", which the UI has to describe in words.
 */

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS reports as MacIntel with touch points — the standard check.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** True when running as an installed home-screen app rather than a tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari pre-display-mode — still the reliable check there.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
