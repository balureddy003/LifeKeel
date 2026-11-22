'use client'

/**
 * One figure an estimate reads, with a Change button. Saving writes it to the household's profile on the
 * version just read (so an edit from another phone is reported, not overwritten) and tells the page what changed.
 * It states what was entered and says nothing about whether the figure is enough.
 */
import { useState } from 'react'
import { fetchFinancialProfileWithVersion, submitFinancialProfile } from '@/lib/api'
import { FIGURE_FIELDS, applyFigureEdit, changeSummary, parsePounds } from '@/lib/figure-edit'
import { inputCls, primaryBtn } from '@/app/domains/AddRecordForm'

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

export function FigureRow({
  figure,
  onSaved,
}: {
  figure: { label: string; valueMinor: number; key?: string | undefined }
  onSaved: (summary: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = figure.key ? FIGURE_FIELDS[figure.key] : undefined
  const id = `figure-${figure.key ?? figure.label}`

  const save = async () => {
    const minor = parsePounds(text, field?.allowZero ?? false)
    if (minor === null) {
      setError('Enter an amount in pounds, for example 2500.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { profile, version } = await fetchFinancialProfileWithVersion()
      const next = profile && figure.key ? applyFigureEdit(profile, figure.key, minor) : null
      if (!next)
        throw new Error('Could not find your profile. Open it from Finances to change this.')
      await submitFinancialProfile(next, true, version)
      setOpen(false)
      onSaved(changeSummary(figure.label, figure.valueMinor, minor))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <dt className="min-w-0 text-ink-secondary">{figure.label}</dt>
        <dd className="flex shrink-0 items-center gap-3 whitespace-nowrap text-ink-primary">
          {gbp(figure.valueMinor)}
          {field && !open && (
            <button
              type="button"
              aria-label={`Change ${figure.label}`}
              className="min-h-[48px] px-2 text-family-400 underline"
              onClick={() => {
                setText(String(Math.round(figure.valueMinor / 100)))
                setError(null)
                setOpen(true)
              }}
            >
              Change
            </button>
          )}
        </dd>
      </div>
      {open && (
        <div className="space-y-2">
          <label htmlFor={id} className="block text-sm font-medium text-ink-primary">
            {figure.label} in £
          </label>
          <input
            id={id}
            className={inputCls}
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button type="button" className={primaryBtn} disabled={busy} onClick={save}>
              Save
            </button>
            <button
              type="button"
              className="min-h-[48px] px-3 text-family-400 underline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
