/**
 * One place that reads JWT_SECRET (R41).
 *
 * Session JWTs keep using the root secret directly so a deploy doesn't sign
 * everyone out. Every other signed artifact (OAuth state, unsubscribe links)
 * uses a key derived per purpose, so a weakness in one use can't forge
 * another.
 *
 * Outside dev/test a missing or short secret is a boot error. NODE_ENV is
 * checked rather than "is production" so a 'staging' or 'qa' deploy can't
 * quietly run with a weak key. Dev/test without a secret gets a random
 * per-process value instead of a constant that is public in this repo.
 */
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

export function isDevOrTest(): boolean {
  const env = process.env['NODE_ENV']
  return !env || env === 'development' || env === 'test'
}

let devFallback: string | undefined

export function rootSigningSecret(): string {
  const secret = process.env['JWT_SECRET'] ?? ''
  if (secret.length >= 32) return secret
  if (!isDevOrTest()) {
    throw new Error('JWT_SECRET must be set to at least 32 characters outside dev/test')
  }
  if (secret) return secret
  devFallback ??= randomBytes(32).toString('hex')
  return devFallback
}

export type SigningPurpose =
  | 'connector-oauth-state'
  | 'social-oauth-state'
  | 'lead-unsubscribe'
  | 'user-unsubscribe'
  | 'heartbeat-unsubscribe'
  /** Email-OTP pending token (CLOUDFLARE_INTEGRATION.md D11): never a session key. */
  | 'otp-pending'
  /** Dev/test-only fallback for OTP_PEPPER; production reads the secret. */
  | 'otp-pepper'

export function purposeKey(purpose: SigningPurpose): Buffer {
  return Buffer.from(
    hkdfSync('sha256', rootSigningSecret(), Buffer.alloc(0), `lifekeel:${purpose}`, 32),
  )
}

export function hmacFor(purpose: SigningPurpose, message: string): string {
  return createHmac('sha256', purposeKey(purpose)).update(message).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Verifies a link HMAC. Unsubscribe links already sitting in inboxes were
 * signed with the root secret, and an opt-out link must keep working, so
 * those are still accepted. New links are only ever signed per purpose.
 */
export function verifyLinkHmac(purpose: SigningPurpose, message: string, given: string): boolean {
  if (safeEqual(hmacFor(purpose, message), given)) return true
  const legacy = createHmac('sha256', rootSigningSecret()).update(message).digest('base64url')
  return safeEqual(legacy, given)
}

/** `base64url(json).hmac` — short-lived state for OAuth round trips. */
export function signState(purpose: SigningPurpose, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmacFor(purpose, body)}`
}

/** Returns the parsed payload, or throws. `exp` (ms epoch) is mandatory. */
export function verifyState(purpose: SigningPurpose, state: unknown): Record<string, unknown> {
  if (typeof state !== 'string') throw new Error('Malformed OAuth state')
  const [body, sig] = state.split('.')
  if (!body || !sig) throw new Error('Malformed OAuth state')
  if (!safeEqual(hmacFor(purpose, body), sig)) throw new Error('Invalid OAuth state signature')
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>
  const exp = parsed['exp']
  if (typeof exp !== 'number' || Date.now() > exp) throw new Error('OAuth state expired')
  return parsed
}
