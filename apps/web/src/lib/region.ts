/**
 * Regions the native shell can start in. Sessions are per registrable domain
 * (auth-context.tsx, auth-social.ts), so a user's account only exists on the
 * app host of the region they signed up in — the Capacitor shell has to land
 * them there. Keep APP_HOSTS in step with LIFEKEEL_APP_HOSTS in
 * apps/api/src/routes/auth-social.ts (its OAuth return allow-list).
 */
export type Region = 'uk' | 'si'

export const APP_HOSTS: Record<Region, string> = {
  uk: 'app.lifekeel.co.uk',
  si: 'app.lifekeel.si',
}

export const REGION_LABELS: Record<Region, string> = {
  uk: 'United Kingdom',
  si: 'Slovenia',
}

export const REGIONS = Object.keys(APP_HOSTS) as Region[]

export function isRegion(value: unknown): value is Region {
  return value === 'uk' || value === 'si'
}

/** Best guess from the device language ("sl-SI" → si). Anything else is uk. */
export function regionFromLocale(language: string | undefined): Region {
  const country = language?.split(/[-_]/)[1]?.toUpperCase()
  return country === 'SI' ? 'si' : 'uk'
}

/** The region whose app host this is, or null for localhost, previews, etc. */
export function regionForHost(host: string): Region | null {
  return REGIONS.find((r) => APP_HOSTS[r] === host) ?? null
}

/** Marketing-site hosts, per region — the apex (and www.) landing domains. */
const LANDING_HOSTS: Record<Region, string> = {
  uk: 'lifekeel.co.uk',
  si: 'lifekeel.si',
}

/**
 * Absolute URL to an app route (`/welcome`, `/login`) for use from the
 * marketing pages. Those routes are Firebase-redirected to the app host on
 * landing domains — a Next <Link> there dies on the cross-origin RSC fetch
 * (/welcome/index.txt comes back as a 302 the fetch can't follow), so they
 * must be plain <a> tags pointing at the app host directly. On localhost and
 * *.web.app previews the relative path is returned instead — never bounce a
 * preview to prod.
 */
export function appUrl(path: string, host?: string): string {
  const h = (host ?? (typeof window === 'undefined' ? '' : window.location.hostname)).replace(
    /^www\./,
    '',
  )
  const region = regionForHost(h) ?? REGIONS.find((r) => LANDING_HOSTS[r] === h)
  return region ? `https://${APP_HOSTS[region]}${path}` : path
}

/**
 * Where to send the shell so it is on `region`'s app host, keeping the path,
 * query and hash. Null when it is already there or on a host that isn't one of
 * the two app hosts — localhost and preview deploys must never be redirected.
 */
export function redirectTarget(
  region: Region,
  loc: { host: string; pathname: string; search: string; hash: string },
): string | null {
  const current = regionForHost(loc.host)
  if (current === null || current === region) return null
  return `https://${APP_HOSTS[region]}${loc.pathname}${loc.search}${loc.hash}`
}

export interface RegionDecision {
  region: Region
  /** Save `region` to the device — true when nothing valid was saved yet. */
  persist: boolean
  redirectTo: string | null
}

/**
 * What the native shell should do on launch. No prompt: with nothing saved,
 * stay where an existing session lives, otherwise guess from the device
 * language — the picker on login/signup/settings corrects a wrong guess.
 * On a host that is not an app host (localhost, previews) it does nothing.
 */
export function decideRegion(input: {
  saved: Region | null
  language: string | undefined
  hasSession: boolean
  loc: { host: string; pathname: string; search: string; hash: string }
}): RegionDecision | null {
  const current = regionForHost(input.loc.host)
  if (current === null) return null

  if (input.saved) {
    return {
      region: input.saved,
      persist: false,
      redirectTo: redirectTarget(input.saved, input.loc),
    }
  }
  // Already on a region's host with a session there (every install that
  // predates region support is on uk): keep it, never bounce a signed-in user.
  const region = input.hasSession ? current : regionFromLocale(input.language)
  return { region, persist: true, redirectTo: redirectTarget(region, input.loc) }
}
