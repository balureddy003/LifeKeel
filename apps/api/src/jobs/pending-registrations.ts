/**
 * Pending-registration sweep (CLOUDFLARE_INTEGRATION.md §6.9).
 *
 * A signup that never verified its emailed code leaves a `pending` user row
 * (and usually a tenant). After PENDING_REGISTRATION_DAYS those are removed,
 * with their OTP chains and send-budget windows, so an address someone
 * mistyped or abandoned is free again.
 *
 * Safeguards:
 * - only rows with `registration_status: 'pending'` and `email_verified: false`;
 *   legacy rows (no registration_status) are never touched;
 * - never a user with a successful login event;
 * - the tenant goes only if this signup created it (`created_by_registration`)
 *   and it holds no documents, family members or other users.
 */
import type { Db } from 'mongodb'

export const PENDING_REGISTRATION_DAYS = 7

const escapeRegex = (s: string): string => s.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&')

export async function sweepPendingRegistrations(
  db: Db,
  now = new Date(),
): Promise<Record<string, number>> {
  const cutoff = new Date(now.getTime() - PENDING_REGISTRATION_DAYS * 86_400_000)
  const out = { pending_users: 0, pending_tenants: 0, otp_chains: 0, otp_send_windows: 0 }
  const candidates = await db
    .collection('users')
    .find(
      {
        registration_status: 'pending',
        email_verified: false,
        registration_created_at: { $lt: cutoff },
      },
      { projection: { id: 1, tenant_id: 1 } },
    )
    .toArray()

  for (const u of candidates) {
    const userId = String(u['id'])
    const tenantId = String(u['tenant_id'])
    const everSignedIn = await db
      .collection('login_events')
      .findOne({ user_id: userId, success: true }, { projection: { _id: 1 } })
    if (everSignedIn) continue

    const removed = await db.collection('users').deleteOne({
      id: userId,
      registration_status: 'pending',
      email_verified: false,
      registration_created_at: { $lt: cutoff },
    })
    if (removed.deletedCount !== 1) continue
    out.pending_users++
    out.otp_chains += (
      await db.collection('otp_chains').deleteMany({ user_id: userId })
    ).deletedCount
    out.otp_send_windows += (
      await db
        .collection('otp_send_windows')
        .deleteMany({ _id: { $regex: `^${escapeRegex(userId)}:` } as never })
    ).deletedCount

    const [otherUsers, documents, family] = await Promise.all([
      db.collection('users').countDocuments({ tenant_id: tenantId }, { limit: 1 }),
      db.collection('documents').countDocuments({ tenant_id: tenantId }, { limit: 1 }),
      db
        .collection('family_groups')
        .countDocuments({ tenant_id: tenantId, 'members.1': { $exists: true } }, { limit: 1 }),
    ])
    if (otherUsers + documents + family === 0) {
      const t = await db
        .collection('tenants')
        .deleteOne({ tenant_id: tenantId, created_by_registration: userId })
      out.pending_tenants += t.deletedCount
    }
  }
  return out
}
