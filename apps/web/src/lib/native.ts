/**
 * Capacitor bridge — the web app detects it's running inside the native
 * shell (apps/mobile) via window.Capacitor and upgrades three behaviors:
 *
 * 1. Camera capture — Camera plugin instead of <input capture>
 * 2. Push — PushNotifications plugin (APNs) instead of web-push
 * 3. Biometric unlock — BiometricAuth before showing content
 *
 * Plugins are reached through `window.Capacitor.Plugins`, which the native
 * runtime injects into the webview — NOT through npm imports. That's the
 * only mechanism that works for a server.url shell: the page is served
 * from lifekeel.co.uk, so the web bundle can't bundle the plugin modules.
 * In a plain browser `window.Capacitor` is absent and everything no-ops.
 */

interface CameraPhoto { webPath?: string; format?: string }

interface CapacitorPlugins {
  Camera?: {
    getPhoto: (opts: {
      source: string
      resultType: string
      quality: number
      correctOrientation: boolean
    }) => Promise<CameraPhoto>
  }
  BiometricAuth?: {
    authenticate: (opts: { reason: string }) => Promise<void>
    checkBiometry: () => Promise<{ isAvailable: boolean }>
  }
}

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean
      getPlatform?: () => string
      Plugins?: CapacitorPlugins
    }
  }
}

export function isNativeShell(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

export function nativePlatform(): 'ios' | 'android' | 'web' {
  if (!isNativeShell()) return 'web'
  const p = window.Capacitor?.getPlatform?.()
  return p === 'ios' || p === 'android' ? p : 'web'
}

/** Take a document photo natively. Returns null on any failure/cancel —
 *  callers fall back to the <input capture> path. */
export async function takeNativePhoto(): Promise<File | null> {
  const camera = isNativeShell() ? window.Capacitor?.Plugins?.Camera : undefined
  if (!camera) return null
  try {
    const photo = await camera.getPhoto({
      source: 'CAMERA',
      resultType: 'uri',
      quality: 90,
      correctOrientation: true,
    })
    const url = photo.webPath
    if (!url) return null
    const blob = await (await fetch(url)).blob()
    return new File([blob], `scan-${Date.now()}.${photo.format || 'jpeg'}`, { type: blob.type || 'image/jpeg' })
  } catch {
    return null
  }
}

/** Prompt for Face ID / Touch ID / Android biometric. Callers gate on
 *  isBiometricAvailable first — a device without a sensor must never be
 *  locked out of its own data. */
export async function verifyBiometric(reason: string): Promise<boolean> {
  const auth = isNativeShell() ? window.Capacitor?.Plugins?.BiometricAuth : undefined
  if (!auth) return false
  try {
    await auth.authenticate({ reason })
    return true
  } catch {
    return false
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  const auth = isNativeShell() ? window.Capacitor?.Plugins?.BiometricAuth : undefined
  if (!auth) return false
  try {
    const result = await auth.checkBiometry()
    return result.isAvailable === true
  } catch {
    return false
  }
}

const BIOMETRIC_PREF_KEY = 'lifekeel_biometric_lock'

export function biometricLockEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(BIOMETRIC_PREF_KEY) === 'true'
}

export function setBiometricLockEnabled(enabled: boolean): void {
  localStorage.setItem(BIOMETRIC_PREF_KEY, String(enabled))
}
