/**
 * Email-OTP pending token (CLOUDFLARE_INTEGRATION.md §6.1, D11).
 *
 * A JWT `{ sub, tid, cid, purpose }` with `aud: lifekeel:otp-pending`,
 * signed with a key derived from the JWT secret for this purpose only
 * (HKDF, see signing-key.ts). The session verifier (`AuthService.verify`)
 * uses the root secret, so this token fails its signature check everywhere
 * a session is accepted: protected routes, the opportunistic check on open
 * routes, and the session cookie. That key separation is the boundary.
 * `AuthContext` is deliberately not extended for OTP.
 *
 * Expiry is the chain's absolute expiry; a resend never re-issues it.
 */
import { SignJWT, jwtVerify } from 'jose'
import { purposeKey } from './signing-key.js'

export type OtpPurpose = 'signup' | 'login'

export interface OtpPendingClaims {
  user_id: string
  tenant_id: string
  chain_id: string
  purpose: OtpPurpose
}

const AUDIENCE = 'lifekeel:otp-pending'

export async function signOtpPending(claims: OtpPendingClaims, expiresAt: Date): Promise<string> {
  return new SignJWT({ tid: claims.tenant_id, cid: claims.chain_id, purpose: claims.purpose })
    .setProtectedHeader({ alg: 'HS256', typ: 'otp-pending' })
    .setSubject(claims.user_id)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(purposeKey('otp-pending'))
}

/** Throws on a bad signature, wrong audience, expiry or a malformed payload. */
export async function verifyOtpPending(token: string): Promise<OtpPendingClaims> {
  const { payload } = await jwtVerify(token, purposeKey('otp-pending'), {
    audience: AUDIENCE,
    algorithms: ['HS256'],
  })
  const { sub, tid, cid, purpose } = payload as Record<string, unknown>
  if (
    typeof sub !== 'string' ||
    !sub ||
    typeof tid !== 'string' ||
    !tid ||
    typeof cid !== 'string' ||
    !cid ||
    (purpose !== 'signup' && purpose !== 'login')
  ) {
    throw new Error('Malformed OTP pending token')
  }
  return { user_id: sub, tenant_id: tid, chain_id: cid, purpose }
}
