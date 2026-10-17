/**
 * Credentialed fetch — every API call goes through here so the httpOnly
 * session cookie is always attached (`credentials: 'include'`). The Bearer
 * header is still sent by callers as a fallback for browsers that block
 * third-party cookies (the API is cross-site to lifekeel.co.uk today —
 * Safari ITP). Once the API is served same-origin (Firebase Hosting
 * rewrite to Cloud Run, or an api.lifekeel.co.uk CNAME), the localStorage
 * token fallback can be deleted and the cookie carries the whole session.
 *
 * Same signature as fetch — a drop-in replacement at existing call sites.
 */
export function credFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { credentials: 'include', ...init })
}
