/**
 * Tenant storage quotas as shared atomic reservations (CLOUDFLARE_INTEGRATION.md §7.12).
 *
 * Replaces the per-instance concurrency Map and the GridFS-only usage sum,
 * which stop meaning anything once bytes live in R2 and more than one
 * instance runs.
 *
 *   tenant_quota       { tenant_id, bytes_reserved, bytes_committed, inflight }
 *   tenant_quota_days  { _id: "<tenant>:<yyyymmdd>", uploads, expires_at }   TTL 48 h
 *
 * Each document row carries `reservation: { size, state }`; every transition
 * (held → committed, held → released, committed → released) is a conditional
 * update on that state, so a reservation is applied and undone exactly once
 * whatever crashes or races in between. A nightly reconcile recomputes the
 * truth from document rows and corrects drift.
 */
import type { Collection, Db } from 'mongodb'
import { setQuotaDrift } from '../observability/security-metrics.js'

export const MAX_TENANT_STORAGE_BYTES = () =>
  Number(process.env['MAX_TENANT_STORAGE_BYTES'] ?? 2 * 1024 ** 3)
export const MAX_UPLOADS_PER_DAY = () => Number(process.env['MAX_TENANT_UPLOADS_PER_DAY'] ?? 200)
export const MAX_INFLIGHT = 3
/** An init that never completes holds its reservation this long. */
export const RESERVATION_TTL_MS = 15 * 60 * 1000

interface TenantQuota {
  tenant_id: string
  bytes_reserved: number
  bytes_committed: number
  inflight: number
}
interface QuotaDay {
  _id: string
  uploads: number
  expires_at: Date
}

const quotas = (db: Db): Collection<TenantQuota> => db.collection<TenantQuota>('tenant_quota')
const days = (db: Db): Collection<QuotaDay> => db.collection<QuotaDay>('tenant_quota_days')
const docs = (db: Db) => db.collection('documents')

export async function ensureQuotaIndexes(db: Db): Promise<void> {
  await Promise.all([
    quotas(db).createIndex({ tenant_id: 1 }, { unique: true }),
    days(db).createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
  ])
}

/** States that still hold bytes somewhere (quarantine or clean or GridFS). */
const HOLDING = { $nin: ['awaiting_upload', 'failed', 'rejected', 'infected', 'deleting'] }

/** What the rows say a tenant stores right now (vault included). */
export async function measureTenantUsage(db: Db, tenantId: string): Promise<number> {
  const [row] = await docs(db)
    .aggregate<{ bytes: number }>([
      { $match: { tenant_id: tenantId, status: HOLDING, 'reservation.state': { $ne: 'held' } } },
      { $group: { _id: null, bytes: { $sum: { $ifNull: ['$storage.size', '$size'] } } } },
    ])
    .toArray()
  return row?.bytes ?? 0
}

/** First touch seeds committed bytes from the rows, so GridFS-era usage counts. */
async function ensureTenantQuota(db: Db, tenantId: string): Promise<void> {
  if (await quotas(db).findOne({ tenant_id: tenantId }, { projection: { _id: 1 } })) return
  const seeded = await measureTenantUsage(db, tenantId)
  await quotas(db)
    .updateOne(
      { tenant_id: tenantId },
      { $setOnInsert: { bytes_reserved: 0, bytes_committed: seeded, inflight: 0 } },
      { upsert: true },
    )
    .catch((err: { code?: number }) => {
      if (err?.code !== 11000) throw err
    })
}

export type ReserveRefusal = {
  status: 413 | 429
  error: 'storage_limit' | 'too_many_uploads' | 'daily_limit'
  message: string
}

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '')

/**
 * Reserve `size` bytes and one in-flight slot, plus today's upload count.
 * Returns null on success; the caller writes `reservation: { size, state:
 * 'held' }` onto the row. On refusal nothing stays reserved.
 */
export async function reserveUpload(
  db: Db,
  tenantId: string,
  size: number,
  opts: { countsInflight?: boolean } = {},
): Promise<ReserveRefusal | null> {
  const inflight = opts.countsInflight !== false
  await ensureTenantQuota(db, tenantId)
  const limit = MAX_TENANT_STORAGE_BYTES()
  const res = await quotas(db).updateOne(
    {
      tenant_id: tenantId,
      ...(inflight ? { inflight: { $lt: MAX_INFLIGHT } } : {}),
      $expr: { $lte: [{ $add: ['$bytes_reserved', '$bytes_committed', size] }, limit] },
    },
    { $inc: { bytes_reserved: size, ...(inflight ? { inflight: 1 } : {}) } },
  )
  if (res.modifiedCount !== 1) {
    const q = await quotas(db).findOne({ tenant_id: tenantId })
    if (inflight && (q?.inflight ?? 0) >= MAX_INFLIGHT)
      return {
        status: 429,
        error: 'too_many_uploads',
        message: 'Too many uploads at once. Wait for one to finish.',
      }
    return {
      status: 413,
      error: 'storage_limit',
      message: 'Your household has reached its storage limit. Remove some documents first.',
    }
  }
  const now = new Date()
  try {
    await days(db).updateOne(
      { _id: `${tenantId}:${dayKey(now)}`, uploads: { $lt: MAX_UPLOADS_PER_DAY() } },
      {
        $inc: { uploads: 1 },
        $setOnInsert: { expires_at: new Date(now.getTime() + 48 * 3600_000) },
      },
      { upsert: true },
    )
  } catch (err) {
    if ((err as { code?: number })?.code !== 11000) throw err
    await quotas(db).updateOne(
      { tenant_id: tenantId },
      { $inc: { bytes_reserved: -size, ...(inflight ? { inflight: -1 } : {}) } },
    )
    return {
      status: 429,
      error: 'daily_limit',
      message: 'Daily upload limit reached. Try again tomorrow.',
    }
  }
  return null
}

/**
 * held → committed: the reserved size becomes the stored size (for images,
 * the WebP size) and the in-flight slot frees. Exactly once per row.
 */
export async function commitReservation(
  db: Db,
  tenantId: string,
  documentId: string,
  storedSize: number,
): Promise<boolean> {
  const row = await docs(db).findOneAndUpdate(
    { tenant_id: tenantId, id: documentId, 'reservation.state': 'held' },
    { $set: { 'reservation.state': 'committed', 'reservation.committed_size': storedSize } },
  )
  if (!row) return false
  const r = row['reservation'] as { size: number; inflight?: boolean }
  await quotas(db).updateOne(
    { tenant_id: tenantId },
    {
      $inc: {
        bytes_reserved: -r.size,
        bytes_committed: storedSize,
        ...(r.inflight !== false ? { inflight: -1 } : {}),
      },
    },
  )
  return true
}

/**
 * Give back whatever the row holds: a held reservation (failure, expiry,
 * delete before scan) or committed bytes (delete). Exactly once per row.
 */
export async function releaseReservation(
  db: Db,
  tenantId: string,
  documentId: string,
): Promise<boolean> {
  const row = await docs(db).findOneAndUpdate(
    { tenant_id: tenantId, id: documentId, 'reservation.state': { $in: ['held', 'committed'] } },
    { $set: { 'reservation.state': 'released' } },
  )
  if (!row) return false
  const r = row['reservation'] as {
    size: number
    state: 'held' | 'committed'
    committed_size?: number
    inflight?: boolean
  }
  const inc: Record<string, number> =
    r.state === 'held'
      ? { bytes_reserved: -r.size, ...(r.inflight !== false ? { inflight: -1 } : {}) }
      : { bytes_committed: -(r.committed_size ?? r.size) }
  await quotas(db).updateOne({ tenant_id: tenantId }, { $inc: inc })
  return true
}

/**
 * Nightly: recompute committed bytes, reserved bytes and in-flight counts
 * from document rows, correct drift, report the largest absolute drift.
 */
export async function reconcileQuotas(db: Db): Promise<{ tenants: number; drift_bytes: number }> {
  let maxDrift = 0
  let tenants = 0
  for await (const q of quotas(db).find({})) {
    tenants++
    const committed = await measureTenantUsage(db, q.tenant_id)
    const [held] = await docs(db)
      .aggregate<{ bytes: number; inflight: number }>([
        { $match: { tenant_id: q.tenant_id, 'reservation.state': 'held' } },
        {
          $group: {
            _id: null,
            bytes: { $sum: '$reservation.size' },
            inflight: { $sum: { $cond: [{ $eq: ['$reservation.inflight', false] }, 0, 1] } },
          },
        },
      ])
      .toArray()
    const reserved = held?.bytes ?? 0
    const inflight = held?.inflight ?? 0
    const drift = Math.abs(committed - q.bytes_committed) + Math.abs(reserved - q.bytes_reserved)
    maxDrift = Math.max(maxDrift, drift)
    if (drift > 0 || inflight !== q.inflight) {
      await quotas(db).updateOne(
        { tenant_id: q.tenant_id },
        { $set: { bytes_committed: committed, bytes_reserved: reserved, inflight } },
      )
    }
  }
  setQuotaDrift(maxDrift)
  return { tenants, drift_bytes: maxDrift }
}
