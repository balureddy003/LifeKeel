/**
 * Carries "where the person was going" across a sign-in that leaves the app,
 * such as the Google OAuth round trip. Password sign-in keeps it in the URL
 * (?next=); a full-page redirect through another origin cannot, so it is parked
 * in sessionStorage for the same tab and read back once by /auth/callback.
 *
 * Only same-site paths are accepted, so a crafted link cannot send someone
 * to another site after they sign in.
 */
const KEY = 'lifekeel_return_to'

/** A same-site path ("/b/abc"), or null. Rejects "//host", "/\\host" and full URLs. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

export function stashReturnTo(raw: string | null | undefined): void {
  try {
    const next = safeNext(raw)
    if (next) sessionStorage.setItem(KEY, next)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the person lands on the home page, as before.
  }
}

/** Reads and clears the parked path. */
export function takeReturnTo(): string | null {
  try {
    const next = safeNext(sessionStorage.getItem(KEY))
    sessionStorage.removeItem(KEY)
    return next
  } catch {
    return null
  }
}
