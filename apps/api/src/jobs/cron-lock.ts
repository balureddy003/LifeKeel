/**
 * Distributed cron lock — shared by every scheduled job in server.ts.
 *
 * OAK-003: only billing-cron.ts had this (hardcoded to the lock name
 * 'billing', local to that file). The other 9 `cron.schedule(...)` jobs in
 * server.ts had no lock at all, while deploy-api.yml configures Cloud Run
 * for up to 4 replicas — two replicas racing the same job (e.g. the
 * insight-escalation cron) could both act on the same overdue insight and
 * both enqueue a delivery, producing a duplicate crisis-escalation
 * notification to a family. Generalized here so every job gets the same
 * protection under its own lock name.
 *
 * Uses a MongoDB document as a lock — findOneAndUpdate with an expiry
 * timestamp. The lock auto-expires after ttlMs (default 5 minutes) in case
 * the holder crashes without releasing it.
 *
 * Note: no unique index on `name` — a genuinely simultaneous first-ever
 * acquisition of a brand-new lock name could in theory upsert two
 * documents (a narrow, known MongoDB upsert race). This adds one to close
 * that gap for real, since it didn't exist even in billing-cron.ts's
 * original version.
 */

import type { Db } from 'mongodb'

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000

export async function ensureCronLockIndex(db: Db): Promise<void> {
  await db.collection('cron_locks').createIndex({ name: 1 }, { unique: true }).catch(() => {})
}

export async function acquireCronLock(db: Db, name: string, ttlMs = DEFAULT_LOCK_TTL_MS): Promise<boolean> {
  const now = new Date()
  try {
    const result = await db.collection('cron_locks').findOneAndUpdate(
      { name, expires_at: { $lt: now } },
      { $set: { name, acquired_at: now, expires_at: new Date(now.getTime() + ttlMs) } },
      { upsert: true, returnDocument: 'after' },
    ) as Record<string, unknown> | null
    return !!result
  } catch (err) {
    // Duplicate-key error (code 11000): with a unique index on `name`,
    // an already-held (not-yet-expired) lock doc doesn't match the
    // filter, so upsert tries to INSERT a new one — which then collides
    // with the existing doc's unique key. That's just "someone else
    // holds it," not a real error. Same shape for a genuine concurrent
    // race on a brand-new lock name (two upserts, one wins, one 11000s).
    if ((err as { code?: number }).code === 11000) return false
    throw err
  }
}

export async function releaseCronLock(db: Db, name: string): Promise<void> {
  await db.collection('cron_locks').deleteOne({ name }).catch(() => {})
}

/** Runs `fn` only if the named lock is acquired; always releases on the way out. Returns false (fn not run) if the lock was already held. */
export async function withCronLock(db: Db, name: string, fn: () => Promise<unknown>, ttlMs?: number): Promise<boolean> {
  const acquired = await acquireCronLock(db, name, ttlMs)
  if (!acquired) return false
  try {
    await fn()
  } finally {
    await releaseCronLock(db, name)
  }
  return true
}
