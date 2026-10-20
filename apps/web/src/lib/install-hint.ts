/**
 * PRD-147 install hint rules, kept pure so they can be tested without a
 * browser. A per-device preference only: nothing here is sent to the server
 * except the platform, via the growth event.
 */
export const DISMISS_KEY = 'lifekeel_install_dismissed_at'
export const VISITS_KEY = 'lifekeel_visits'
export const DISMISS_DAYS = 90
/** Shown from the second visit, so the first one is about the product. */
export const MIN_VISITS = 2

export type InstallPlatform = 'prompt' | 'ios' | 'ios_in_app'

export function dismissalActive(raw: string | null, now: number): boolean {
  if (!raw) return false
  const at = Number(raw)
  if (!Number.isFinite(at)) return false
  return now - at < DISMISS_DAYS * 86_400_000
}

/** In-app browsers (Instagram, Facebook, Gmail and similar) cannot add to the home screen. */
export function isIOSInAppBrowser(ua: string): boolean {
  return /(FBAN|FBAV|Instagram|Line\/|GSA\/|LinkedInApp|Twitter|MicroMessenger)/i.test(ua)
}

export function chooseHint(input: {
  authenticated: boolean
  standalone: boolean
  nativeShell: boolean
  ios: boolean
  ua: string
  visits: number
  dismissedAt: string | null
  now: number
  hasPrompt: boolean
}): InstallPlatform | null {
  if (!input.authenticated || input.standalone || input.nativeShell) return null
  if (input.visits < MIN_VISITS) return null
  if (dismissalActive(input.dismissedAt, input.now)) return null
  if (input.ios) return isIOSInAppBrowser(input.ua) ? 'ios_in_app' : 'ios'
  return input.hasPrompt ? 'prompt' : null
}
