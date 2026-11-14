/**
 * Daily audit-log seal (G-SEC-03). Seals closed UTC days, logs each anchor
 * hash to the external log sink, then re-verifies the whole chain and pages
 * ops if it no longer holds.
 */
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { sealAuditDays, verifyAuditChain, type VerifyResult } from '../audit/audit-seal.js'
import { sendOpsAlert } from '../operator/ops-alerts.js'

const log = createLogger({ service: 'audit-seal', version: '0.0.0' })

export async function runAuditSeal(
  db: Db,
  now: Date = new Date(),
): Promise<{ sealed: number; verify: VerifyResult }> {
  const sealed = await sealAuditDays(db, now)
  for (const a of sealed) {
    log.info(
      { day: a._id, count: a.count, anchor_hash: a.anchor_hash, prev: a.prev_anchor_hash },
      'audit.anchor',
    )
  }
  const verify = await verifyAuditChain(db, { now })
  if (!verify.ok) {
    await sendOpsAlert({
      title: 'Audit log integrity check failed',
      message: `Audit day ${verify.day} failed verification (${verify.reason}). Treat as a security incident.`,
      severity: 'critical',
      fingerprint: 'audit-seal',
    })
  }
  return { sealed: sealed.length, verify }
}
