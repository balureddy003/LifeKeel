/**
 * One scan job: quarantine → checks → ClamAV → parse/normalize → clean
 * (CLOUDFLARE_INTEGRATION.md §7.5). Runs only in the scan worker.
 *
 * TOCTOU: the worker promotes bytes derived from what IT read and scanned,
 * recording the source hash. The quarantine object is re-checked (size and
 * ETag recorded at /complete) before reading, so a replacement after
 * /complete is rejected; an overwrite after the read cannot change the
 * clean copy. The commit is conditional on lease and generation; if it is
 * refused (deleted, or the lease was lost) the clean key just written is
 * deleted again (compensating delete).
 *
 * Promotion order: (1) PUT clean (idempotent, deterministic key)
 * (2) conditional commit scanning → clean (3) delete quarantine
 * (4) ocr_pending. A crash after any step is finished by the reconciler.
 */
import { createHash } from 'node:crypto'
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { scanRequired, scanUpload, type ScanResult } from '../extraction/scan.js'
import { recordDocScan } from '../observability/security-metrics.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { signatureMatches } from './formats.js'
import { runParser } from './parse-sandbox.js'
import { objectStore, type ObjectStore } from './r2.js'
import {
  commitClean,
  commitScanError,
  commitTerminal,
  markPromoted,
  objectKey,
  renewLease,
  type ClaimedRow,
} from './pipeline.js'
import { commitReservation, releaseReservation } from './quota.js'
import { raiseDocumentsSchemaFloor } from './storage.js'

const log = createLogger({ service: 'scan-job', version: '0.0.0' })

export interface ScanDeps {
  store?: ObjectStore
  scan?: (bytes: Buffer) => Promise<ScanResult>
  parse?: typeof runParser
  /** Definitions older than this make every scan an error, never clean. */
  definitionsStale?: () => boolean
}

export type ScanOutcome = 'clean' | 'infected' | 'rejected' | 'scan_error' | 'failed' | 'lost'

function audit(row: ClaimedRow, result: string, extra: Record<string, unknown> = {}) {
  getAuditLogger()?.log({
    tenant_id: row.tenant_id,
    user_id: 'system:scan-worker',
    action: 'document.scan_result',
    resource_type: 'document',
    resource_id: row.id,
    metadata: { result, ...extra },
    ip: '',
    user_agent: 'scan-worker',
    timestamp: new Date(),
  })
}

export async function processScanJob(
  db: Db,
  row: ClaimedRow,
  deps: ScanDeps = {},
): Promise<ScanOutcome> {
  const started = performance.now()
  const store = deps.store ?? objectStore('scan')
  const qKey = row.quarantine.key
  const finishTerminal = async (
    status: 'infected' | 'rejected' | 'failed',
    detail: Record<string, unknown>,
  ): Promise<ScanOutcome> => {
    const ok = await commitTerminal(db, row, status, detail)
    if (!ok) return 'lost'
    await releaseReservation(db, row.tenant_id, row.id)
    await store.delete('quarantine', qKey).catch(() => {})
    await db
      .collection('documents')
      .updateOne({ tenant_id: row.tenant_id, id: row.id }, { $set: { quarantine_present: false } })
    recordDocScan(status, (performance.now() - started) / 1000)
    audit(row, status, { reason: detail['reason'] })
    if (status === 'infected')
      log.warn({ documentId: row.id, tenant_id: row.tenant_id }, 'Upload blocked by malware scan')
    return status
  }
  const retry = async (reason: string): Promise<ScanOutcome> => {
    const r = await commitScanError(db, row, reason)
    recordDocScan('scan_error', (performance.now() - started) / 1000)
    if (r === 'exhausted') {
      await releaseReservation(db, row.tenant_id, row.id)
      log.error({ documentId: row.id, reason }, 'Scan attempts exhausted; document failed')
      audit(row, 'failed', { reason })
      return 'failed'
    }
    return r === 'lost' ? 'lost' : 'scan_error'
  }

  try {
    // Re-check the object recorded at /complete: same size, same ETag.
    const head = await store.head('quarantine', qKey)
    if (!head) return retry('quarantine_missing')
    if (head.size !== row.declared.size)
      return finishTerminal('rejected', { reason: 'size_mismatch' })
    if (row.quarantine.etag && head.etag && head.etag !== row.quarantine.etag)
      return finishTerminal('rejected', { reason: 'object_replaced' })

    const source = await store.get('quarantine', qKey)
    if (!source) return retry('quarantine_missing')
    if (source.length !== row.declared.size)
      return finishTerminal('rejected', { reason: 'size_mismatch' })
    const sourceSha256 = createHash('sha256').update(source).digest('hex')
    if (row.declared.sha256 && row.declared.sha256.toLowerCase() !== sourceSha256)
      return finishTerminal('rejected', { reason: 'sha256_mismatch' })
    if (!signatureMatches(source, row.declared.mime))
      return finishTerminal('rejected', { reason: 'signature_mismatch' })

    await renewLease(db, row)

    // Malware scan on the exact bytes that will be promoted (or re-encoded).
    if (deps.definitionsStale?.()) return retry('clamav_definitions_stale')
    const scan = await (deps.scan ?? scanUpload)(source)
    if (scan.result === 'infected')
      return finishTerminal('infected', { result: 'infected', engine: 'clamav', signature: scan.signature })
    if (scan.result === 'error') return retry(`clamav_${scan.reason}`)
    if (scan.result === 'not_performed' && scanRequired()) return retry('scanner_not_configured')

    // Structure checks and image normalization in the credential-less child.
    const parsed = await (deps.parse ?? runParser)(row.declared.kind, row.declared.mime, source)
    if (parsed.header.outcome === 'rejected')
      return finishTerminal('rejected', { reason: parsed.header.reason ?? 'structure' })
    if (parsed.header.outcome !== 'ok') return retry(parsed.header.reason ?? 'parser_error')

    const isImage = row.declared.kind === 'image'
    const promoted = isImage ? parsed.out : source
    if (isImage && promoted.length === 0) return retry('empty_normalized_image')
    const storedMime = isImage ? 'image/webp' : row.declared.mime
    const sha256 = isImage ? createHash('sha256').update(promoted).digest('hex') : sourceSha256

    await renewLease(db, row)
    const cleanKey = objectKey(row.tenant_id, row.id)
    await store.put('clean', cleanKey, promoted, storedMime) // (1)
    const committed = await commitClean(db, row, {
      cleanKey,
      storedMime,
      storedSize: promoted.length,
      sha256,
      sourceSha256,
      scan: scan.result === 'clean' ? { result: 'clean', engine: 'clamav' } : { result: 'not_performed' },
      stored: parsed.header.stored,
    }) // (2)
    if (!committed) {
      await store.delete('clean', cleanKey).catch(() => {})
      return 'lost'
    }
    await raiseDocumentsSchemaFloor(db)
    await commitReservation(db, row.tenant_id, row.id, promoted.length)
    await store.delete('quarantine', qKey).catch(() => {}) // (3), reconciler retries
    await markPromoted(db, row.tenant_id, row.id) // (4)
    recordDocScan('clean', (performance.now() - started) / 1000)
    audit(row, 'clean', { stored_mime: storedMime })
    return 'clean'
  } catch (err) {
    log.error({ err, documentId: row.id }, 'Scan job error')
    return retry(String((err as Error).message ?? 'error').slice(0, 80))
  }
}
