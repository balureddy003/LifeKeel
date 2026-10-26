/**
 * Shared pieces for the read-only Google read-back (intent 47): Search Console and GA4.
 *
 * Both integrations only ever read. The key is a service account added to the property as a restricted
 * (Search Console) or Viewer (GA4) user, and tokens are minted for the read-only scopes below, so even a
 * leaked key cannot change anything in Google. Nothing here returns the key; configuration is reported
 * as booleans only.
 */

export const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly'

export type GoogleReadErrorKind = 'forbidden' | 'quota' | 'not_found' | 'failed'

/** A failed read. The message is safe to show an operator: it never carries a token or key. */
export class GoogleReadError extends Error {
  constructor(
    readonly kind: GoogleReadErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'GoogleReadError'
  }
}

export interface ReadbackConfig {
  /** Service-account key JSON. Never exposed beyond the token provider. */
  credentialsJson: string | undefined
  siteUrl: string | undefined
  propertyId: string | undefined
}

export function readbackConfig(env: NodeJS.ProcessEnv = process.env): ReadbackConfig {
  const clean = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined)
  return {
    credentialsJson: clean(env['GOOGLE_READONLY_SERVICE_ACCOUNT_JSON']),
    siteUrl: clean(env['SEARCH_CONSOLE_SITE_URL']),
    propertyId: clean(env['GA4_PROPERTY_ID'])?.replace(/^properties\//, ''),
  }
}

/** Booleans only: what is set, never the values. */
export function readbackPresence(cfg: ReadbackConfig): {
  credentials: boolean
  search_console: boolean
  ga4: boolean
} {
  return {
    credentials: Boolean(cfg.credentialsJson),
    search_console: Boolean(cfg.credentialsJson && cfg.siteUrl),
    ga4: Boolean(cfg.credentialsJson && cfg.propertyId && /^\d+$/.test(cfg.propertyId)),
  }
}

/** Turn a non-OK Google response into a typed error, using only Google's own error message. */
export async function googleErrorFrom(res: Response, what: string): Promise<GoogleReadError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    if (typeof body.error?.message === 'string') detail = body.error.message.slice(0, 200)
  } catch {
    // no JSON body
  }
  const kind: GoogleReadErrorKind =
    res.status === 401 || res.status === 403
      ? 'forbidden'
      : res.status === 429
        ? 'quota'
        : res.status === 404
          ? 'not_found'
          : 'failed'
  return new GoogleReadError(
    kind,
    `${what} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ''}`,
    res.status,
  )
}

/** A date as YYYY-MM-DD in UTC, `daysAgo` days before `from`. */
export function isoDay(from: Date, daysAgo = 0): string {
  return new Date(from.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
const LONG_DIGITS = /\d{6,}/
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/
const MAX_QUERY_CHARS = 200

/**
 * A search query is kept only if it is safe to store: anything containing an email address, a phone number
 * or a long run of digits is dropped (it may identify a person), the rest is lower-cased, trimmed, and
 * cut to 200 characters. Returns null when the query must not be stored.
 */
export function sanitizeQuery(raw: string): string | null {
  const q = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (q === '') return null
  if (EMAIL.test(q) || PHONE.test(q) || LONG_DIGITS.test(q)) return null
  return q.slice(0, MAX_QUERY_CHARS)
}
