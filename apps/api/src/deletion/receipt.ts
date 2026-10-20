/**
 * Deletion receipts (PRD-146). A receipt is the user's and the operator's
 * evidence that a deletion ran: what was removed by category and how many,
 * whether a check afterwards found anything left, and what the deletion does
 * not cover. It holds counts and category names only, never content.
 *
 * It states three things honestly (amendment 1):
 *   1. live data erased: true only when the post-deletion check found nothing;
 *   2. backups: erasure covers backups, but a backup taken before the deletion
 *      can keep a copy until it is overwritten, so the receipt names the
 *      window in days (BACKUP_RETENTION_DAYS) or says it is not confirmed;
 *   3. processors: what each processor that could have received content
 *      states about its retention. LifeKeel cannot verify a negative at a
 *      provider, so an unreviewed one reads "not confirmed", never "none".
 * The wording never says "permanent", "instant" or "none exist".
 *
 * Receipts are retained after an account is erased (like audit_log) so the
 * operator can answer a deletion request; they identify the tenant by id only.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { getProcessorRegistry } from '../ai/task-gateway.js'

export type ReceiptKind = 'document' | 'mailbox' | 'account'
export type ReceiptStatus = 'completed' | 'partial' | 'in_progress'

export interface DeletionReceipt {
  id: string
  tenant_id: string
  kind: ReceiptKind
  status: ReceiptStatus
  requested_at: Date
  completed_at: Date | null
  /** Removed items by category, counts only. */
  removed: { category: string; count: number }[]
  /** What the deletion deliberately does not touch, in plain words. */
  kept: string[]
  /** Result of the check run after deleting; null while in progress. */
  verification: { passed: boolean; residual: { category: string; count: number }[] } | null
  /** True only when verification passed. */
  live_data_erased: boolean
  backups: { retention_days: number | null; statement: string }
  processors: { id: string; name: string; stated_retention: string }[]
}

const COLLECTION = 'deletion_receipts'
const RETENTION_TEXT: Record<string, string> = {
  none: 'keeps nothing',
  zero_data_retention: 'keeps no copy, by contract',
  service_transient: 'keeps it only while processing',
  limited_abuse_log: 'may keep it briefly for abuse monitoring',
}

export function backupStatement(raw: string | undefined = process.env['BACKUP_RETENTION_DAYS']): {
  retention_days: number | null
  statement: string
} {
  const days = raw ? Number(raw) : NaN
  if (Number.isInteger(days) && days > 0) {
    return {
      retention_days: days,
      statement: `Erasure also covers backups, but a backup taken before this deletion can keep a copy until it is overwritten, up to ${days} days.`,
    }
  }
  return {
    retention_days: null,
    statement:
      'Erasure also covers backups, but a backup taken before this deletion can keep a copy until it is overwritten. How long backups are kept is not yet confirmed.',
  }
}

/** What each hosted processor states about retention; self-hosted ones are not third parties. */
export function processorStatements(): DeletionReceipt['processors'] {
  const out: DeletionReceipt['processors'] = []
  for (const p of getProcessorRegistry().values()) {
    if (p.hosting !== 'hosted') continue
    const classes = [...new Set(Object.values(p.retention))]
    out.push({
      id: p.id,
      name: p.name,
      stated_retention:
        p.status === 'unreviewed'
          ? 'Not confirmed: its terms have not been reviewed yet.'
          : `States that it ${classes.map((c) => RETENTION_TEXT[c] ?? c).join(', or ')}.`,
    })
  }
  return out
}

const merge = (rows: { category: string; count: number }[]) => {
  const by = new Map<string, number>()
  for (const r of rows) by.set(r.category, (by.get(r.category) ?? 0) + r.count)
  return [...by].filter(([, n]) => n > 0).map(([category, count]) => ({ category, count }))
}

export function openReceipt(
  tenantId: string,
  kind: ReceiptKind,
  now: Date = new Date(),
): DeletionReceipt {
  return {
    id: randomUUID(),
    tenant_id: tenantId,
    kind,
    status: 'in_progress',
    requested_at: now,
    completed_at: null,
    removed: [],
    kept: [],
    verification: null,
    live_data_erased: false,
    backups: backupStatement(),
    processors: processorStatements(),
  }
}

export function closeReceipt(
  receipt: DeletionReceipt,
  result: {
    removed: { category: string; count: number }[]
    residual: { category: string; count: number }[]
    kept?: string[]
  },
  now: Date = new Date(),
): DeletionReceipt {
  const residual = merge(result.residual)
  const passed = residual.length === 0
  return {
    ...receipt,
    status: passed ? 'completed' : 'partial',
    completed_at: passed ? now : null,
    removed: merge([...receipt.removed, ...result.removed]),
    kept: result.kept ?? receipt.kept,
    verification: { passed, residual },
    live_data_erased: passed,
  }
}

/** Receipts are best-effort bookkeeping: a failure to save one never undoes or blocks a deletion. */
export async function saveReceipt(db: Db, receipt: DeletionReceipt): Promise<void> {
  try {
    const col = db.collection<DeletionReceipt>(COLLECTION)
    await col.replaceOne({ id: receipt.id }, receipt, { upsert: true })
    // 7 years, the same as audit_log: the compliance record of what was deleted and when.
    await col
      .createIndex({ requested_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 * 7 })
      .catch(() => {})
    await col.createIndex({ tenant_id: 1, requested_at: -1 }).catch(() => {})
  } catch {
    // bookkeeping only
  }
}

export async function loadReceipt(db: Db, id: string): Promise<DeletionReceipt | null> {
  try {
    return (await db
      .collection<DeletionReceipt>(COLLECTION)
      .findOne({ id })) as DeletionReceipt | null
  } catch {
    return null
  }
}

/** A receipt for display: no tenant id, no internal fields. */
export function publicReceipt(r: DeletionReceipt) {
  const { tenant_id: _t, ...rest } = r as DeletionReceipt & { _id?: unknown }
  const { _id: _i, ...clean } = rest as typeof rest & { _id?: unknown }
  return clean
}
