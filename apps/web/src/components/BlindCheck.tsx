'use client'

/**
 * Blind check (innovation scan idea 1). The adult a brief was shared with gives their own figures before
 * seeing the other adult's; then both see them side by side. It states what each person typed and how far
 * apart they are, never which is right or what to do with the money.
 */
import { useState } from 'react'
import {
  answerBlindCheck,
  type BlindCheckView,
  type BlindField,
  type HouseholdBrief,
} from '@/lib/api'
import { haptic } from '@/lib/haptics'

const inputCls =
  'mt-1 w-full min-h-[48px] rounded-xl border border-haze bg-surface-1 pl-7 pr-3 text-ink-primary focus:outline-none focus:ring-2 focus:ring-family-500'

/** What each figure is called when someone is asked for their own. */
export const BLIND_QUESTIONS: Array<{ field: BlindField; label: string }> = [
  { field: 'monthly_income_minor', label: 'Take-home income coming in each month' },
  { field: 'monthly_essentials_minor', label: 'Spending each month' },
  { field: 'liquid_savings_minor', label: 'Savings you could use now' },
]

const gbp = (minor: number) =>
  `£${(minor / 100).toLocaleString('en-GB', { maximumFractionDigits: minor % 100 ? 2 : 0 })}`

/** Pounds typed by a person to whole pence; null when blank or not a sensible amount. */
const toMinor = (s: string): number | null => {
  const n = Number(s.replace(/[£,\s]/g, ''))
  return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

export function BlindCheckForm({
  briefId,
  fromName,
  onAnswered,
}: {
  briefId: string
  fromName?: string | null | undefined
  onAnswered: (brief: HouseholdBrief) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const who = fromName ?? 'the other adult'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = Object.fromEntries(
      BLIND_QUESTIONS.map((q) => [q.field, toMinor(values[q.field] ?? '')]),
    )
    if (Object.values(parsed).some((v) => v === null)) {
      setError('Enter an amount for each, using 0 where it applies.')
      return
    }
    setBusy(true)
    setError(null)
    const r = await answerBlindCheck(briefId, parsed as Record<BlindField, number>)
    setBusy(false)
    if (!r.ok || !r.data) {
      setError(
        r.status === 409
          ? 'Your figures were already given. Reload to see both sets.'
          : 'Your figures did not save. Try again.',
      )
      return
    }
    haptic('success')
    onAnswered(r.data.brief)
  }

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="blind-check-form">
      <div>
        <h3 className="font-medium text-ink-primary">First, your own figures</h3>
        <p className="mt-1 text-sm text-ink-secondary">
          Before you see {who}&apos;s figures, what do you think they are? Your best guess is fine.
          You will both see the two sets side by side.
        </p>
      </div>
      {BLIND_QUESTIONS.map((q) => (
        <label
          key={q.field}
          htmlFor={`blind-${q.field}`}
          className="block text-sm font-medium text-ink-primary"
        >
          {q.label}
          <span className="relative block">
            <span
              aria-hidden="true"
              className="absolute left-3 top-1/2 mt-0.5 -translate-y-1/2 text-ink-tertiary"
            >
              £
            </span>
            <input
              id={`blind-${q.field}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={values[q.field] ?? ''}
              onChange={(e) => setValues({ ...values, [q.field]: e.target.value })}
              className={inputCls}
            />
          </span>
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-[rgb(var(--on-cta))] disabled:opacity-50"
      >
        {busy ? 'Saving…' : `Show ${who}'s figures`}
      </button>
    </form>
  )
}

/** How far apart two figures are, in words a person would say. */
export function differenceText(pct: number | null): string {
  if (pct === null) return ''
  if (pct === 0) return 'the same'
  return `${Math.abs(pct)}% ${pct > 0 ? 'higher' : 'lower'}`
}

export function BlindCheckCompare({
  view,
  viewerIsCreator,
  otherName,
}: {
  view: BlindCheckView
  viewerIsCreator: boolean
  otherName: string
}) {
  if (view.status !== 'answered' || !view.rows?.length) return null
  const anyApart = view.rows.some((r) => r.difference_pct !== 0)
  return (
    <div data-testid="blind-check-compare" className="rounded-2xl border border-haze p-4">
      <h3 className="font-medium text-ink-primary">Your figures side by side</h3>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-tertiary">
            <th className="py-1 pr-2 font-medium">Figure</th>
            <th className="py-1 pr-2 font-medium">You</th>
            <th className="py-1 pr-2 font-medium">{otherName}</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r) => {
            // The brief holds the creator's figures; the note sits under the other adult's own figure.
            const note =
              r.difference_pct !== null && r.difference_pct !== 0 ? (
                <span className="block text-xs text-ink-tertiary">
                  {differenceText(r.difference_pct)} than the brief
                </span>
              ) : null
            const cell = (minor: number, isRecipient: boolean) => (
              <td className="py-2 pr-2 tabular-nums text-ink-primary">
                {gbp(minor)}
                {isRecipient && note}
              </td>
            )
            return (
              <tr key={r.field} className="border-t border-haze align-top">
                <td className="py-2 pr-2 text-ink-secondary">{r.label}</td>
                {cell(viewerIsCreator ? r.creator_minor : r.recipient_minor, !viewerIsCreator)}
                {cell(viewerIsCreator ? r.recipient_minor : r.creator_minor, viewerIsCreator)}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-ink-secondary">
        {anyApart
          ? 'Different figures are normal. Agree one set, then update the brief so you both see the same answer.'
          : 'You both entered the same figures.'}
      </p>
    </div>
  )
}
