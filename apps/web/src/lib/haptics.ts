// The most recently touched interactive element — haptic() fires from
// click/tap handlers that don't carry an element ref, so we remember the
// pointerdown target for the iOS visual fallback below.
let lastTapped: Element | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastTapped = e.target instanceof Element ? e.target : null
    },
    { passive: true, capture: true },
  )
}

function nativeHaptic(pattern: string): boolean {
  try {
    const cap = (
      window as unknown as {
        Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> }
      }
    ).Capacitor
    if (cap?.isNativePlatform?.() !== true) return false
    const h = cap.Plugins?.['Haptics'] as
      | {
          impact: (o: { style: string }) => Promise<void> | void
          notification: (o: { type: string }) => Promise<void> | void
        }
      | undefined
    if (!h) return false
    const swallow = (r: unknown) => void (r as Promise<void> | undefined)?.catch?.(() => {})
    if (pattern === 'success' || pattern === 'warning' || pattern === 'error') {
      swallow(h.notification({ type: pattern.toUpperCase() }))
    } else {
      swallow(
        h.impact({
          style: pattern === 'medium' ? 'MEDIUM' : pattern === 'heavy' ? 'HEAVY' : 'LIGHT',
        }),
      )
    }
    return true
  } catch {
    return false
  }
}

export function haptic(
  pattern: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light',
) {
  if (typeof window === 'undefined') return

  // Inside the native shell, use the phone's Taptic engine like any iOS app.
  if (nativeHaptic(pattern)) return

  if ('vibrate' in navigator) {
    const patterns: Record<string, number | number[]> = {
      light: 10,
      medium: 20,
      heavy: 30,
      success: [10, 30, 10],
      warning: [20, 40, 20],
      error: [30, 60, 30, 60, 30],
    }
    const p = patterns[pattern]
    if (p !== undefined) navigator.vibrate(p)
    return
  }

  // iOS Safari has no Vibration API at all — without this branch the whole
  // haptic vocabulary silently does nothing for most users. Mirror it
  // visually: a quick press-depth pulse on the tapped control, weighted by
  // the pattern. Skipped under reduced-motion and on non-interactive taps.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const el =
    lastTapped instanceof HTMLElement
      ? lastTapped.closest(
          'button, a, [role="button"], [role="switch"], [role="tab"], input, label',
        )
      : null
  if (!(el instanceof HTMLElement) || typeof el.animate !== 'function') return
  const depth = pattern === 'light' ? 0.97 : pattern === 'medium' ? 0.94 : 0.9
  el.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${depth})` }, { transform: 'scale(1)' }],
    { duration: pattern === 'light' ? 120 : 180, easing: 'ease-out' },
  )
}
