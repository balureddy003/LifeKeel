/**
 * Receipt Chain (PRD-214, M7) — the family-visible record of what Keel did.
 *
 *   GET /family/receipts           — the chained receipt list (adults only)
 *   GET /family/receipts?format=csv — the same ledger as a CSV download
 *
 * Read-only over the existing action_receipts ledger: every receipt row is
 * written by the real approve/dismiss/execute paths — nothing is fabricated
 * for display here.
 *
 * The chain: receipts are ordered by executed_at (then id) and each gets a
 * `chain_hash` — sha256 over a canonical encoding of the previous chain hash and
 * every field a family relies on: the receipt id and tenant, payload hash,
 * action type and label, outcome and reason, time, WHO approved it and HOW,
 * the detector and insight it came from, and whether it was a dry run. Editing
 * any of those on an earlier receipt, or deleting one, changes every
 * downstream hash and the chain head. The scheme is versioned
 * (CHAIN_VERSION) so a head a family exported can be matched to the scheme that
 * produced it.
 *
 * What this is and is not: it is tamper-evidence over the stored ledger, derived
 * at read time. The head is not stored or anchored anywhere, so tampering is
 * only visible against a head the family exported earlier. A receipt that is
 * still `pending` is finalised once by the executor (outcome, executed_at and
 * reason change), so a head taken while one is pending will not match later.
 *
 * Cost: verifying the chain means hashing every receipt, so CPU is linear in
 * the household's history by design. Memory is not: receipts stream from a
 * cursor, the JSON page keeps only offset+limit rows, and the CSV streams
 * out in chain order (review F12).
 *
 * Member scoping: visible to active adult family members only — a youth
 * twin's view must never carry the household's action ledger.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ActionReceipt } from '@lifekeel/workflows'
import { isFamilyAdult } from '../family/family-permissions.js'

const GENESIS = 'genesis'

/** Bump when the set of hashed fields or their encoding changes. */
export const CHAIN_VERSION = 2

export interface ChainedReceipt extends ActionReceipt {
  chain_index: number
  chain_hash: string
}

/**
 * The exact bytes hashed for one receipt. A JSON array, not a delimited string:
 * free-text fields (label, reason) can contain any delimiter, so a joined string
 * lets two different receipts encode identically. Absent optional fields encode
 * as null, which differs from an empty string, so "no approver recorded" and
 * "approver is the empty string" are different records.
 */
export function receiptChainInput(prev: string, r: ActionReceipt): string {
  return JSON.stringify([
    `lifekeel-receipt-chain-v${CHAIN_VERSION}`,
    prev,
    r.id,
    r.tenant_id,
    r.payload_hash,
    r.action_type,
    r.action_label ?? null,
    r.outcome,
    r.outcome_reason ?? null,
    new Date(r.executed_at).toISOString(),
    r.approved_by ?? null,
    r.approved_via ?? null,
    r.detector_id ?? null,
    r.insight_id ?? null,
    r.dry_run,
  ])
}

/** Deterministic hash chain over an executed_at-ordered receipt list. */
export function deriveReceiptChain(receipts: ActionReceipt[]): ChainedReceipt[] {
  const ordered = [...receipts].sort(
    (a, b) =>
      new Date(a.executed_at).getTime() - new Date(b.executed_at).getTime() ||
      a.id.localeCompare(b.id),
  )
  let prev = GENESIS
  return ordered.map((r, i) => {
    const chain_hash = createHash('sha256').update(receiptChainInput(prev, r)).digest('hex')
    prev = chain_hash
    return { ...r, chain_index: i, chain_hash }
  })
}

const CHAIN_FIELDS = {
  _id: 0,
  id: 1,
  tenant_id: 1,
  payload_hash: 1,
  action_type: 1,
  action_label: 1,
  outcome: 1,
  outcome_reason: 1,
  executed_at: 1,
  approved_by: 1,
  approved_via: 1,
  detector_id: 1,
  insight_id: 1,
  dry_run: 1,
} as const

/**
 * Streams the tenant's chain in order, calling `visit` once per chained
 * receipt. Same order and hashes as deriveReceiptChain: rows sharing an
 * executed_at are re-sorted by id with localeCompare before hashing.
 */
export async function* streamReceiptChain(
  db: Db,
  tenantId: string,
): AsyncGenerator<ChainedReceipt> {
  const cursor = db
    .collection<ActionReceipt>('action_receipts')
    .find({ tenant_id: tenantId }, { projection: CHAIN_FIELDS })
    .sort({ executed_at: 1, id: 1 })
  let prev = GENESIS
  let index = 0
  let group: ActionReceipt[] = []
  const flush = function* (): Generator<ChainedReceipt> {
    group.sort((a, b) => a.id.localeCompare(b.id))
    for (const r of group) {
      const chain_hash = createHash('sha256').update(receiptChainInput(prev, r)).digest('hex')
      prev = chain_hash
      yield { ...r, chain_index: index++, chain_hash }
    }
    group = []
  }
  for await (const r of cursor) {
    if (
      group.length > 0 &&
      new Date(group[0]!.executed_at).getTime() !== new Date(r.executed_at).getTime()
    )
      yield* flush()
    group.push(r)
  }
  yield* flush()
}

/** The "policy that allowed it" in plain language, derived from real fields. */
function policyFor(r: ActionReceipt): string {
  if (r.outcome === 'policy_blocked') return r.outcome_reason ?? 'Blocked by policy'
  if (r.dry_run) return 'Dry-run mode — recorded, nothing dispatched'
  if (r.approved_by === 'auto-trust') return 'Auto-approved under your trust settings'
  if (r.approved_via === 'signed_link') return 'Approved via a signed email link'
  if (r.approved_via) return `Approved via ${r.approved_via.replace(/_/g, ' ')}`
  if (r.approved_by) return 'Approved in the app'
  return 'Recorded without an approval step'
}

function toView(r: ChainedReceipt) {
  return {
    id: r.id,
    chain_index: r.chain_index,
    chain_hash: r.chain_hash,
    payload_hash: r.payload_hash,
    action_type: r.action_type,
    action_label: r.action_label ?? null,
    outcome: r.outcome,
    outcome_reason: r.outcome_reason ?? null,
    executed_at: new Date(r.executed_at).toISOString(),
    approved_by: r.approved_by ?? null,
    approved_via: r.approved_via ?? null,
    detector_id: r.detector_id ?? null,
    insight_id: r.insight_id ?? null,
    dry_run: r.dry_run,
    policy: policyFor(r),
  }
}

/**
 * One CSV cell. Spreadsheets run a cell that starts with = + - @ (or a tab or
 * carriage return) as a formula, and several receipt fields carry free text, so
 * such a cell is prefixed with a single quote, which makes it display as text.
 * Cells with a quote, comma or line break are then quoted per RFC 4180.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function registerFamilyReceiptRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { limit?: string; offset?: string; format?: string } }>(
    '/family/receipts',
    async (request, reply) => {
      const { tenant_id, user_id } = request.authContext
      if (!(await isFamilyAdult(db, tenant_id, user_id))) {
        return reply.status(403).send({
          error: 'The receipt chain is visible to adult family members only.',
        })
      }

      if (request.query.format === 'csv') {
        const header =
          'chain_index,executed_at,action_type,action_label,outcome,outcome_reason,approved_by,approved_via,dry_run,detector_id,insight_id,payload_hash,chain_hash,chain_version'
        const lines = async function* (): AsyncGenerator<string> {
          yield header
          for await (const r of streamReceiptChain(db, tenant_id)) {
            yield '\n' +
              [
                r.chain_index,
                new Date(r.executed_at).toISOString(),
                r.action_type,
                r.action_label ?? '',
                r.outcome,
                r.outcome_reason ?? '',
                r.approved_by ?? '',
                r.approved_via ?? '',
                r.dry_run,
                r.detector_id ?? '',
                r.insight_id ?? '',
                r.payload_hash,
                r.chain_hash,
                CHAIN_VERSION,
              ]
                .map(csvCell)
                .join(',')
          }
        }
        return reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="lifekeel-receipts.csv"')
          .send(Readable.from(lines()))
      }

      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 500)
      const offset = Math.max(Number(request.query.offset) || 0, 0)
      // Newest first: the page is the `limit` rows ending `offset` before the
      // head, so only the last offset+limit chained rows are ever held.
      const tail: ChainedReceipt[] = []
      let total = 0
      let chainHead: string | null = null
      for await (const r of streamReceiptChain(db, tenant_id)) {
        total++
        chainHead = r.chain_hash
        tail.push(r)
        if (tail.length > offset + limit) tail.shift()
      }
      const page = tail.slice(0, Math.max(tail.length - offset, 0)).reverse()

      return {
        receipts: page.map(toView),
        total,
        chain_head: chainHead,
        chain_version: CHAIN_VERSION,
        // Honest note on what the head means — the family pins it by exporting.
        chain_note:
          'Each receipt hash covers the action, its outcome and reason, the time, who approved it and how, and the hash before it. If an earlier record were altered, every hash after it, and this head, would change. Compare this head with one you exported earlier to check nothing before it changed.',
      }
    },
  )
}
