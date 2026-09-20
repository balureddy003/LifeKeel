'use client'

import { useState } from 'react'

/**
 * Inline reason capture for destructive operator actions — every privileged
 * mutation requires a reason that lands in the operator audit trail.
 */
export function ReasonAction({
  label,
  destructive = false,
  onConfirm,
}: {
  label: string
  destructive?: boolean
  onConfirm: (reason: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
          destructive ? 'border-danger/25 text-danger' : 'border-tint/[0.1] text-ink-secondary hover:text-ink-primary'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, audited)"
        className="glass-input w-full rounded-lg px-3 py-2 text-xs"
        autoFocus
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy || reason.trim().length < 5}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onConfirm(reason.trim())
              setOpen(false)
              setReason('')
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Action failed')
            } finally {
              setBusy(false)
            }
          }}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
            destructive ? 'bg-danger/15 text-danger' : 'bg-family-500/15 text-family-400'
          }`}
        >
          {busy ? 'Working…' : `Confirm ${label}`}
        </button>
        <button onClick={() => { setOpen(false); setReason(''); setError(null) }} className="rounded-lg border border-tint/[0.08] px-3 py-1.5 text-xs text-ink-tertiary">
          Cancel
        </button>
      </div>
    </div>
  )
}
