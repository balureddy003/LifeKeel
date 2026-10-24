/**
 * Is this account allowed to hold a session right now? One function shared
 * by the opportunistic check on open routes (server.ts) and the email-OTP
 * verify step (routes/auth-otp.ts), so the two can't drift
 * (CLOUDFLARE_INTEGRATION.md §6.3.1 step 5).
 */
import type { Db } from 'mongodb'

/** Users who exist as rows but must not hold a session (R03). */
export const INACTIVE_USER_STATUSES = new Set(['erased', 'removed'])

export type LivenessResult =
  | { ok: true; user: Record<string, unknown> | null }
  | {
      ok: false
      reason:
        | 'no_such_user'
        | 'user_suspended'
        | 'user_inactive'
        | 'session_revoked'
        | 'tenant_not_active'
        | 'registration_pending'
    }

export interface LivenessOptions {
  /** Seconds-since-epoch the credential was issued (JWT iat), compared to sessions_revoked_at. */
  issuedAtSeconds?: number
  /** Millisecond start of a non-JWT credential (an OTP chain); a revocation at or after it wins. */
  issuedAtMs?: number
  /** A row-less user is accepted (demo tokens, local dev). */
  allowMissingUser?: boolean
  /** Skip the tenant status lookup (local dev mode has no tenant rows). */
  skipTenantCheck?: boolean
}

export async function checkAccountLiveness(
  db: Db,
  ids: { tenant_id: string; user_id: string },
  opts: LivenessOptions = {},
): Promise<LivenessResult> {
  const user = await db
    .collection('users')
    .findOne(
      { tenant_id: ids.tenant_id, id: ids.user_id },
      { projection: { status: 1, sessions_revoked_at: 1, registration_status: 1 } },
    )
  if (!user && !opts.allowMissingUser) return { ok: false, reason: 'no_such_user' }
  if (user?.['status'] === 'suspended') return { ok: false, reason: 'user_suspended' }
  if (INACTIVE_USER_STATUSES.has(user?.['status'] as string))
    return { ok: false, reason: 'user_inactive' }
  // An unverified signup never holds a session (§6.3.2).
  if (user?.['registration_status'] === 'pending')
    return { ok: false, reason: 'registration_pending' }
  const revokedAt = user?.['sessions_revoked_at'] as Date | undefined
  // <= guards a credential minted in the same second the revocation landed.
  if (
    revokedAt &&
    opts.issuedAtSeconds !== undefined &&
    opts.issuedAtSeconds <= Math.floor(revokedAt.getTime() / 1000)
  )
    return { ok: false, reason: 'session_revoked' }
  if (revokedAt && opts.issuedAtMs !== undefined && revokedAt.getTime() >= opts.issuedAtMs)
    return { ok: false, reason: 'session_revoked' }
  if (!opts.skipTenantCheck) {
    const tenant = await db.collection('tenants').findOne({
      $or: [{ tenant_id: ids.tenant_id }, { id: ids.tenant_id }],
      status: { $in: ['active', 'trial'] },
    })
    if (!tenant) return { ok: false, reason: 'tenant_not_active' }
  }
  return { ok: true, user }
}
