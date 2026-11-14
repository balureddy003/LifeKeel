/**
 * Tamper evidence for audit_log (G-SEC-03, ISO 27001 A.8.15).
 *
 * Every entry carries `entry_hash`, a SHA-256 over its canonical content.
 * A daily job seals each closed UTC day into `audit_anchors`: the digest of
 * that day's entry hashes, chained to the previous anchor. Changing,
 * inserting or deleting an entry in a sealed day — or rewriting an anchor —
 * breaks verification from that day on.
 *
 * The anchor hash is also written to the structured log, which is retained
 * outside MongoDB. Someone with database write access can rewrite both
 * collections consistently; they cannot rewrite the log sink, so the logged
 * chain is the external witness an auditor compares against.
 */
import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import type { AuditEntry } from './audit-log.js'

export const ANCHOR_COLLECTION = 'audit_anchors'
const DAY_MS = 24 * 60 * 60 * 1000
/** Entries are written up to ~1s after their timestamp (retry backoff); wait well past that. */
const SEAL_GRACE_MS = 60 * 60 * 1000
const GENESIS = '0'.repeat(64)

export interface AuditAnchor {
  _id: string
  from: Date
  to: Date
  count: number
  digest: string
  prev_anchor_hash: string
  anchor_hash: string
  sealed_at: Date
}

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Hash of the entry's content. `_id` and `entry_hash` itself are excluded. */
export function entryHash(entry: AuditEntry): string {
  const { _id, entry_hash, ...content } = entry as AuditEntry & {
    _id?: unknown
    entry_hash?: unknown
  }
  return sha256(canonical(content))
}

function anchorHash(a: Omit<AuditAnchor, 'anchor_hash' | 'sealed_at'>): string {
  return sha256(
    canonical({
      day: a._id,
      from: a.from,
      to: a.to,
      count: a.count,
      digest: a.digest,
      prev: a.prev_anchor_hash,
    }),
  )
}

const dayKey = (d: Date): string => d.toISOString().slice(0, 10)
const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** Digest of every entry in [from, to), in a deterministic order. */
async function windowDigest(
  db: Db,
  from: Date,
  to: Date,
): Promise<{ count: number; digest: string; mismatched: number }> {
  const rows = (await db
    .collection('audit_log')
    .find({ timestamp: { $gte: from, $lt: to } })
    .sort({ timestamp: 1, _id: 1 })
    .toArray()) as unknown as Array<AuditEntry & { entry_hash?: string }>
  const h = createHash('sha256')
  let mismatched = 0
  for (const row of rows) {
    const recomputed = entryHash(row)
    if (row.entry_hash !== undefined && row.entry_hash !== recomputed) mismatched++
    h.update(recomputed)
  }
  return { count: rows.length, digest: h.digest('hex'), mismatched }
}

async function latestAnchor(db: Db): Promise<AuditAnchor | null> {
  const rows = (await db
    .collection<AuditAnchor>(ANCHOR_COLLECTION)
    .find({})
    .sort({ _id: -1 })
    .limit(1)
    .toArray()) as AuditAnchor[]
  return rows[0] ?? null
}

/**
 * Seal every closed UTC day not yet sealed, oldest first. The first run
 * starts at the oldest audit entry. Idempotent: a day already sealed is
 * never resealed (the `_id` is the day).
 */
export async function sealAuditDays(
  db: Db,
  now: Date = new Date(),
  maxDays = 31,
): Promise<AuditAnchor[]> {
  const last = await latestAnchor(db)
  let from: Date
  if (last) {
    from = last.to
  } else {
    const oldest = (await db
      .collection('audit_log')
      .find({})
      .sort({ timestamp: 1 })
      .limit(1)
      .toArray()) as unknown as AuditEntry[]
    if (!oldest[0]) return []
    from = startOfUtcDay(oldest[0].timestamp)
  }

  const sealed: AuditAnchor[] = []
  let prev = last?.anchor_hash ?? GENESIS
  for (let i = 0; i < maxDays; i++) {
    const to = new Date(from.getTime() + DAY_MS)
    if (to.getTime() + SEAL_GRACE_MS > now.getTime()) break
    const { count, digest } = await windowDigest(db, from, to)
    const base = { _id: dayKey(from), from, to, count, digest, prev_anchor_hash: prev }
    const anchor: AuditAnchor = { ...base, anchor_hash: anchorHash(base), sealed_at: now }
    await db.collection<AuditAnchor>(ANCHOR_COLLECTION).insertOne(anchor)
    sealed.push(anchor)
    prev = anchor.anchor_hash
    from = to
  }
  return sealed
}

export type VerifyResult =
  | { ok: true; checked: number }
  | {
      ok: false
      checked: number
      day: string
      reason: 'chain_broken' | 'anchor_altered' | 'entries_changed' | 'entry_hash_mismatch'
    }

/**
 * Re-derive every anchor from audit_log and the chain. Days whose window
 * has passed the audit_log retention TTL are skipped for content (their
 * entries are gone by design) but still checked for chain integrity.
 */
export async function verifyAuditChain(
  db: Db,
  opts: { retentionMs?: number; now?: Date } = {},
): Promise<VerifyResult> {
  const now = opts.now ?? new Date()
  const retentionMs = opts.retentionMs ?? 365 * 7 * DAY_MS
  const anchors = (await db
    .collection<AuditAnchor>(ANCHOR_COLLECTION)
    .find({})
    .sort({ _id: 1 })
    .toArray()) as AuditAnchor[]

  let prev = GENESIS
  let checked = 0
  for (const a of anchors) {
    if (a.prev_anchor_hash !== prev) {
      return { ok: false, checked, day: a._id, reason: 'chain_broken' }
    }
    const { anchor_hash, sealed_at, ...base } = a
    if (anchorHash(base) !== anchor_hash) {
      return { ok: false, checked, day: a._id, reason: 'anchor_altered' }
    }
    if (now.getTime() - a.from.getTime() < retentionMs) {
      const w = await windowDigest(db, a.from, a.to)
      if (w.mismatched > 0) {
        return { ok: false, checked, day: a._id, reason: 'entry_hash_mismatch' }
      }
      if (w.count !== a.count || w.digest !== a.digest) {
        return { ok: false, checked, day: a._id, reason: 'entries_changed' }
      }
    }
    prev = anchor_hash
    checked++
  }
  return { ok: true, checked }
}
