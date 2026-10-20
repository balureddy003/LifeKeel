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

import { isRegion, type Region } from './region'

interface CameraPhoto {
  webPath?: string
  format?: string
}

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
  Preferences?: {
    get: (opts: { key: string }) => Promise<{ value: string | null }>
    set: (opts: { key: string; value: string }) => Promise<void>
  }
  PushNotifications?: {
    requestPermissions: () => Promise<{ receive: string }>
    register: () => Promise<void>
    addListener: (
      event: 'registration' | 'registrationError',
      cb: (data: { value?: string; error?: string }) => void,
    ) => Promise<{ remove: () => Promise<void> }>
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
    return new File([blob], `scan-${Date.now()}.${photo.format || 'jpeg'}`, {
      type: blob.type || 'image/jpeg',
    })
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

// The shell's region (which app host it starts on). Held in the native
// Preferences plugin rather than localStorage: the WebView can evict web
// storage, and this is a device setting, not user data — purgeClientData()
// deliberately leaves it alone.
const REGION_PREF_KEY = 'lifekeel_region'

export async function getSavedRegion(): Promise<Region | null> {
  const prefs = isNativeShell() ? window.Capacitor?.Plugins?.Preferences : undefined
  if (!prefs) return null
  try {
    const { value } = await prefs.get({ key: REGION_PREF_KEY })
    return isRegion(value) ? value : null
  } catch {
    return null
  }
}

export async function saveRegion(region: Region): Promise<void> {
  const prefs = isNativeShell() ? window.Capacitor?.Plugins?.Preferences : undefined
  if (!prefs) return
  try {
    await prefs.set({ key: REGION_PREF_KEY, value: region })
  } catch {
    // Not persisted: the locale guess runs again next launch.
  }
}

// ── Native push (PRD-140) ────────────────────────────────────────────────
// NOT VERIFIED ON A REAL DEVICE: needs the push capability and entitlement in
// the generated Xcode project, a Firebase iOS SDK, and a google-services.json
// on Android (see apps/mobile/README.md). Without them the plugin reports no
// permission or never returns a token and this resolves null.
//
// The device token is kept in the native Preferences plugin so sign-out can
// unregister it. It is a credential for the signed-in user's alerts, so it is
// cleared on unregister.
const PUSH_TOKEN_KEY = 'lifekeel_push_token'

/** Ask for permission and resolve with the device's push token, or null. */
export async function requestNativePushToken(timeoutMs = 10_000): Promise<string | null> {
  const push = isNativeShell() ? window.Capacitor?.Plugins?.PushNotifications : undefined
  if (!push) return null
  try {
    const perm = await push.requestPermissions()
    if (perm.receive !== 'granted') return null
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs)
      const done = (v: string | null) => {
        clearTimeout(timer)
        resolve(v)
      }
      void push.addListener('registration', (d) => done(d.value ?? null))
      void push.addListener('registrationError', () => done(null))
      push.register().catch(() => done(null))
    })
  } catch {
    return null
  }
}

export async function getStoredPushToken(): Promise<string | null> {
  const prefs = isNativeShell() ? window.Capacitor?.Plugins?.Preferences : undefined
  if (!prefs) return null
  try {
    const { value } = await prefs.get({ key: PUSH_TOKEN_KEY })
    return value || null
  } catch {
    return null
  }
}

/** Pass null to forget the token (an empty value reads back as none). */
export async function storePushToken(token: string | null): Promise<void> {
  const prefs = isNativeShell() ? window.Capacitor?.Plugins?.Preferences : undefined
  if (!prefs) return
  try {
    await prefs.set({ key: PUSH_TOKEN_KEY, value: token ?? '' })
  } catch {
    // best effort
  }
}
