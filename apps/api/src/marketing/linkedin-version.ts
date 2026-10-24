/**
 * LinkedIn Marketing API versioning.
 *
 * Every versioned call must send `Linkedin-Version: YYYYMM`; LinkedIn supports a
 * version for a minimum of one year and then rejects it with an error
 * (learn.microsoft.com/linkedin/marketing/versioning). A pin that is allowed to
 * go stale makes posting fail with an opaque 4xx, so:
 *   - the version lives here, overridable with LINKEDIN_API_VERSION without a deploy;
 *   - a test fails once the default is 11 months old, long before the sunset;
 *   - a rejection is turned into a message that says what to change.
 */

/** The version this code was last checked against (Marketing October 2026). */
export const LINKEDIN_API_VERSION_DEFAULT = '202610'

/** The test fails at this age; LinkedIn's guaranteed window is 12 months. */
export const LINKEDIN_VERSION_FAIL_AFTER_MONTHS = 11

export function linkedinApiVersion(env: NodeJS.ProcessEnv = process.env): string {
  const v = env['LINKEDIN_API_VERSION']?.trim()
  return v && /^\d{6}$/.test(v) ? v : LINKEDIN_API_VERSION_DEFAULT
}

/** Whole months from a YYYYMM version to `now`. Negative for a future version. */
export function versionAgeMonths(version: string, now = new Date()): number {
  const year = Number(version.slice(0, 4))
  const month = Number(version.slice(4, 6))
  return (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month)
}

export const VERSION_ERROR_PREFIX = 'linkedin_api_version_expired'

/** LinkedIn answers a missing or deprecated version header with 426 / NONEXISTENT_VERSION. */
export function isLinkedinVersionError(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null
  if (!e) return false
  if (e.status === 426) return true
  return /NONEXISTENT_VERSION|version.{0,40}(not active|deprecated|sunset|no longer (supported|active))/i.test(
    e.message ?? '',
  )
}

export function versionErrorMessage(version: string): string {
  return (
    `${VERSION_ERROR_PREFIX}: LinkedIn rejected API version ${version}. Set LINKEDIN_API_VERSION to a ` +
    'current version (see learn.microsoft.com/linkedin/marketing/versioning).'
  )
}
