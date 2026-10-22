/**
 * Server-side session ending (R06).
 *
 * Two mechanisms, both checked by the auth hook in server.ts:
 * - `users.sessions_revoked_at`: every token issued at or before that
 *   second is dead. Used when a password or second factor changes.
 * - `revoked_sessions`: one signed-out token, by hash. Used by logout so a
 *   copied token stops working without signing out the user's other devices.
 */
import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'

/** Longest session we issue is 30 days (remember me); keep a day of slack. */
const MAX_SESSION_MS = 31 * 24 * 60 * 60 * 1000

export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function revokeSessionToken(db: Db, token: string): Promise<void> {
  await db.collection('revoked_sessions').updateOne(
    { token_hash: sessionTokenHash(token) },
    { $setOnInsert: { expires_at: new Date(Date.now() + MAX_SESSION_MS), revoked_at: new Date() } },
    { upsert: true },
  )
}

export async function isSessionTokenRevoked(db: Db, token: string): Promise<boolean> {
  const hit = await db
    .collection('revoked_sessions')
    .findOne({ token_hash: sessionTokenHash(token) }, { projection: { _id: 1 } })
  return hit !== null
}

/**
 * Value for `sessions_revoked_at`. With `keepNewSession`, the cut-off is
 * the previous second, so a token minted right after this call (the
 * replacement session for the user who made the change) stays valid while
 * every earlier one is rejected.
 */
export function sessionsRevokedAt(keepNewSession: boolean): Date {
  if (!keepNewSession) return new Date()
  return new Date(Math.floor(Date.now() / 1000) * 1000 - 1)
}
