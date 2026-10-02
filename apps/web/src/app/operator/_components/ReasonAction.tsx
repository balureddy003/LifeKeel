'use client'

import { useState, type ReactNode } from 'react'

/**
 * Inline reason capture for destructive operator actions — every privileged
 * mutation requires a reason that lands in the operator audit trail.
 * `confirmPhrase` adds a typed-confirmation gate for irreversible actions
 * (e.g. erasure) so a stray click can't fire them.
 */
export function ReasonAction({
  label,
  destructive = false,
  description,
  confirmPhrase,
  onConfirm,
}: {
  label: ReactNode
  destructive?: boolean
  description?: string
  confirmPhrase?: string
  onConfirm: (reason: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const phraseOk = !confirmPhrase || phrase === confirmPhrase
  const canConfirm = reason.trim().length >= 5 && phraseOk

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
      {description && <p className="text-xs leading-relaxed text-ink-secondary">{description}</p>}
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, audited)"
        className="glass-input w-full rounded-lg px-3 py-2 text-xs"
        autoFocus
      />
      {confirmPhrase && (
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder={`Type ${confirmPhrase} to confirm`}
          className="glass-input w-full rounded-lg border-danger/25 px-3 py-2 text-xs"
        />
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          disabled={busy || !canConfirm}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await onConfirm(reason.trim())
              setOpen(false)
              setReason('')
              setPhrase('')
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
          {busy ? 'Working…' : `Confirm ${typeof label === 'string' ? label : 'action'}`}
        </button>
        <button onClick={() => { setOpen(false); setReason(''); setPhrase(''); setError(null) }} className="rounded-lg border border-tint/[0.08] px-3 py-1.5 text-xs text-ink-tertiary">
          Cancel
        </button>
      </div>
    </div>
  )
}
