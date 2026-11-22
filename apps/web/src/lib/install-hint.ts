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

/** Pages where a person is typing; a floating hint would cover the field they are on. */
const FORM_ROUTES = ['/policies/new', '/financial-profile']

export function onFormRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const p = pathname.replace(/\/+$/, '')
  return FORM_ROUTES.includes(p)
}

/**
 * Where the hint may appear. A floating hint covers whatever sits at the bottom of the screen, which on Home is
 * the "who has looked" row and on a brief is the result's buttons, so it is offered only on the screens that end
 * in settings rather than an action. When no path is known it is not restricted.
 */
const HINT_ROUTES = ['/family', '/settings']

function onHintRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return true
  return HINT_ROUTES.includes(pathname.replace(/\/+$/, ''))
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
  /** The current page path; the hint stays off form pages. */
  pathname?: string | null
}): InstallPlatform | null {
  if (!input.authenticated || input.standalone || input.nativeShell) return null
  if (onFormRoute(input.pathname) || !onHintRoute(input.pathname)) return null
  if (input.visits < MIN_VISITS) return null
  if (dismissalActive(input.dismissedAt, input.now)) return null
  if (input.ios) return isIOSInAppBrowser(input.ua) ? 'ios_in_app' : 'ios'
  return input.hasPrompt ? 'prompt' : null
}
