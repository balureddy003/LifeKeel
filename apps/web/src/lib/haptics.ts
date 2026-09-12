export function haptic(pattern: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light') {
  if (typeof window === 'undefined') return
  if (!('vibrate' in navigator)) return

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
}
