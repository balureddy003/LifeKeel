'use client'

import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { fetchFinancialProfileWithVersion, saveFamilyFigures, type BriefInputs } from '@/lib/api'
import { pendingFigures, saveBody, type PendingFigure } from '@/lib/brief-figures'
import { gbp } from '@/lib/figure-edit'
import { haptic } from '@/lib/haptics'

/**
 * After a brief: the numbers it was built on, offered to the family list in one confirmation, so the estimate,
 * the pinned tiles and the checks use the same figures instead of asking for them again. Shows only the
 * figures that differ from what is on file, and says what is on file now. Nothing is saved until it is tapped.
 */
export function SaveFiguresCard({ inputs }: { inputs: BriefInputs | undefined }) {
  const [rows, setRows] = useState<PendingFigure[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string[] | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let live = true
    fetchFinancialProfileWithVersion()
      .then(({ profile }) => live && setRows(pendingFigures(inputs, profile)))
      // If the list cannot be read, offer nothing rather than guess what is on file.
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [inputs])

  if (hidden || rows === null) return null
  if (done)
    return (
      <p role="status" className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-primary">
        Saved to your family list: {done.join(', ')}. Your estimate and checks use these figures
        now.
      </p>
    )
  if (rows.length === 0) return null

  async function save() {
    if (!rows) return
    setBusy(true)
    setError(null)
    haptic('light')
    const r = await saveFamilyFigures(saveBody(rows))
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    haptic('success')
    setDone(rows.map((x) => x.label))
  }

  return (
    <GlassCard className="space-y-3 p-5">
      <h3 className="font-medium text-ink-primary">Save these figures to your family list?</h3>
      <p className="text-sm text-ink-secondary">
        Your estimate, tiles and checks will use them, so you are not asked again. You can change
        any of them later.
      </p>
      <dl className="space-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between gap-4 border-b border-haze pb-1">
            <dt className="min-w-0 text-ink-tertiary">
              {r.label}
              {r.current !== null && (
                <span className="block text-xs">on file now {gbp(r.current)}</span>
              )}
            </dt>
            <dd className="shrink-0 whitespace-nowrap text-ink-primary">{gbp(r.minor)}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="min-h-[48px] rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          Save to the family list
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="min-h-[48px] px-2 text-sm font-medium text-ink-secondary"
        >
          Not now
        </button>
      </div>
    </GlassCard>
  )
}
