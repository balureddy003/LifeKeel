/**
 * Erasure replay — the backup↔erasure reconciliation mechanism.
 *
 * The backup↔erasure contradiction: restoring a backup taken before an
 * account deletion can reintroduce data the family was told was gone. The
 * recorded decision (docs/intents/04) is tombstone replay — the `tenants`
 * row already carries the durable marker (status:'deleted'), so a restore
 * that resurrects family rows ALSO resurrects the tombstone, and this job
 * re-applies the wipe. No separate erasure ledger to lose.
 *
 * Runs daily via server.ts cron and manually after any restore:
 *   MONGODB_URL=mongodb://... pnpm exec tsx src/jobs/erasure-replay.ts
 *
 * Per-tenant DEK crypto-shredding supersedes this for vault/connector
 * secrets when the envelope-key work lands (Stage B4) — replay remains the
 * belt-and-braces check for everything else.
 */
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { eraseTenantDataReport } from '../erasure.js'
import { closeReceipt, loadReceipt, openReceipt, saveReceipt } from '../deletion/receipt.js'
import { ACCOUNT_DELETION_KEPT } from '../routes/account.js'
import { cancelSubscriptionForDeletedTenant } from '../billing/cancel-on-delete.js'

const log = createLogger({ service: 'erasure-replay', version: '0.0.0' })

/**
 * Re-apply the full erasure wipe to every tenant tombstoned status:'deleted'.
 * Idempotent: running it when nothing is tombstoned (the common case) is a
 * single indexed read.
 */
export async function runErasureReplay(
  db: Db,
): Promise<{ tenants_replayed: number; tenants_resumed: number }> {
  // 'deleting' = an account deletion that did not finish (PRD-146): resume it
  // and complete its receipt. 'deleted' = the post-restore tombstone replay.
  const tombstoned = await db
    .collection('tenants')
    .find(
      { status: { $in: ['deleting', 'deleted'] } },
      { projection: { tenant_id: 1, status: 1, deletion_receipt_id: 1 } },
    )
    .toArray()

  let replayed = 0
  let resumed = 0
  for (const t of tombstoned) {
    const tenantId = String(t['tenant_id'])
    try {
      // Billing first (R09): a deleted household must never be charged again.
      await cancelSubscriptionForDeletedTenant(db, tenantId)
      const report = await eraseTenantDataReport(db, tenantId)
      if (t['status'] === 'deleting') {
        const existing = t['deletion_receipt_id']
          ? await loadReceipt(db, String(t['deletion_receipt_id']))
          : null
        const closed = closeReceipt(existing ?? openReceipt(tenantId, 'account'), {
          ...report,
          kept: ACCOUNT_DELETION_KEPT,
        })
        await saveReceipt(db, closed)
        if (closed.live_data_erased) {
          await db
            .collection('tenants')
            .updateOne(
              { tenant_id: tenantId },
              { $set: { status: 'deleted', deleted_at: new Date(), updated_at: new Date() } },
            )
          resumed++
        }
      } else {
        replayed++
      }
    } catch (err) {
      // One tenant's replay failure must not skip the rest — log loudly and
      // continue; the next run retries.
      log.error({ err, tenant_id: tenantId }, 'Erasure replay failed for tombstoned tenant')
    }
  }

  if (replayed > 0) {
    log.info({ tenants_replayed: replayed }, 'Erasure replay re-wiped tombstoned tenants')
  }
  if (resumed > 0) {
    log.info({ tenants_resumed: resumed }, 'Erasure replay finished interrupted deletions')
  }
  return { tenants_replayed: replayed, tenants_resumed: resumed }
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// Run with: MONGODB_URL=mongodb://... pnpm exec tsx src/jobs/erasure-replay.ts
if (process.argv[1]?.endsWith('erasure-replay.ts')) {
  ;(async () => {
    const { MongoClient } = await import('mongodb')
    const url = process.env['MONGODB_URL']
    if (!url) {
      log.error({}, 'MONGODB_URL is required')
      process.exit(1)
    }
    const client = await MongoClient.connect(url)
    const db = client.db()
    const result = await runErasureReplay(db)
    log.info(result, 'Erasure replay complete')
    await client.close()
  })().catch((err) => {
    log.error({ err }, 'Erasure replay failed')
    process.exit(1)
  })
}
