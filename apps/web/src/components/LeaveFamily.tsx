'use client'

import { useState } from 'react'

/**
 * For someone who needs to get out of a family without asking the organizer.
 * The page decides what leaving does (confirm first, sign out after); this
 * shows the button, says what it means, and shows why when it is not allowed.
 */
export function LeaveFamily({ onLeave }: { onLeave: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="mt-6">
      <p className="text-sm text-ink-secondary">
        You will lose access to the family list straight away. You do not need the organizer&apos;s
        help.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return
          setBusy(true)
          setError(null)
          try {
            await onLeave()
          } catch (err) {
            setError(err instanceof Error ? err.message : 'We could not do that. Try again.')
          } finally {
            setBusy(false)
          }
        }}
        className="mt-2 inline-flex min-h-[48px] items-center rounded-full border border-danger/40 px-5 text-base font-medium text-danger disabled:opacity-50"
      >
        Leave this family
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
