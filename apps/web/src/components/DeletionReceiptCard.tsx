'use client'

/**
 * PRD-146 — what a deletion removed, whether the check afterwards found
 * anything left, and what it does not cover (backups, processors). Counts and
 * categories only; the API never sends content.
 */
import { GlassCard } from '@/components/Glass'
import type { DeletionReceipt } from '@/lib/api'
import { RECEIPT_TITLE, STATUS_LINE } from '@/lib/deletion-receipt-copy'

export function DeletionReceiptCard({ receipt }: { receipt: DeletionReceipt }) {
  return (
    <GlassCard className="p-4">
      <h2 className="text-base font-semibold text-ink-primary">{RECEIPT_TITLE[receipt.kind]}</h2>
      <p className="text-xs text-ink-secondary mt-1">
        {receipt.live_data_erased ? STATUS_LINE.erased : STATUS_LINE.finishing}
      </p>

      {receipt.removed.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-ink-primary mt-3">Removed</h3>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-secondary">
            {receipt.removed.map((r) => (
              <li key={r.category}>
                {r.count} × {r.category}
              </li>
            ))}
          </ul>
        </>
      )}

      {receipt.kept.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-ink-primary mt-3">Not covered</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-secondary">
            {receipt.kept.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </>
      )}

      <h3 className="text-xs font-semibold text-ink-primary mt-3">Backups</h3>
      <p className="text-xs text-ink-secondary mt-1">{receipt.backups.statement}</p>

      {receipt.processors.length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-ink-primary mt-3">AI providers</h3>
          <ul className="mt-1 space-y-1 text-xs text-ink-secondary">
            {receipt.processors.map((p) => (
              <li key={p.id}>
                {p.name}: {p.stated_retention}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[11px] text-ink-tertiary mt-3">
        Receipt {receipt.id.slice(0, 8)} · {new Date(receipt.requested_at).toLocaleString()}
      </p>
    </GlassCard>
  )
}
