/**
 * Keeps credentials and personal data out of logs and ops alerts (R22).
 *
 * OAuth codes and state, invite and action tokens, and reset links all
 * travel in URLs. Query strings are dropped entirely, and any path segment
 * that looks like a token (long, high-entropy) is replaced.
 */

const TOKEN_SEGMENT = /^[A-Za-z0-9_.~-]{20,}$/
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi
const LONG_TOKEN = /\b[A-Za-z0-9_-]{32,}\b/g

export function redactUrl(url: string): string {
  const [path = ''] = url.split('?')
  const redacted = path
    .split('/')
    .map((segment) => (TOKEN_SEGMENT.test(segment) ? ':redacted' : segment))
    .join('/')
  return url.includes('?') ? `${redacted}?[query removed]` : redacted
}

/** For free text such as exception messages: emails, bearer tokens and long token-like strings. */
export function scrubSecrets(text: string): string {
  return text
    .replace(BEARER, '$1[redacted]')
    .replace(EMAIL, '[email]')
    .replace(LONG_TOKEN, '[redacted]')
    .slice(0, 2000)
}
