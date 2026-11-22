'use client'

/**
 * /resilience — how long the household's savings would cover spending if the main income stopped.
 * Tier 0, read-only. The server (GET /family/resilience) does all the arithmetic and decides who may see it;
 * this page only shows what it sends: an estimate, what the estimate leaves out, and what to check next.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader, GlassCard } from '@/components/Glass'
import { FigureRow } from '@/components/FigureRow'
import {
  confirmResilienceFigures,
  fetchConfirmationHistory,
  fetchFamilyLearning,
  fetchFamilyResilience,
  type ConfirmationHistoryEntry,
  type FamilyResilience,
  type ResilienceConfirmation,
} from '@/lib/api'

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

export default function ResiliencePage() {
  const [data, setData] = useState<FamilyResilience | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Sharing is switched off by default; only offer the link when the server says it exists.
  const [sharingOn, setSharingOn] = useState(false)

  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const [history, setHistory] = useState<ConfirmationHistoryEntry[]>([])

  const reload = () => {
    void fetchConfirmationHistory().then((h) => setHistory(h ?? []))
    return fetchFamilyResilience()
      .then(setData)
      .finally(() => setLoaded(true))
  }
  useEffect(() => {
    void reload()
    void fetchFamilyLearning().then((l) => setSharingOn(l !== null))
  }, [])

  // After a figure changes: say what changed, then show the estimate worked out from the new figure.
  const [changed, setChanged] = useState<string | null>(null)
  const afterEdit = (summary: string) => {
    setChanged(summary)
    void reload()
  }

  const confirm = async () => {
    setBusy(true)
    setFailed(false)
    const ok = await confirmResilienceFigures()
    if (ok) await reload()
    else setFailed(true)
    setBusy(false)
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="If your income stops"
        backHref="/finances"
        subtitle="An estimate from the figures you entered"
      />

      {!loaded && (
        <div className="flex justify-center py-10 text-ink-tertiary">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        </div>
      )}

      {loaded && !data && (
        <GlassCard className="p-4 text-sm text-ink-secondary">
          This is for adults in your family. If you are one, it could not load right now, so try
          again in a moment.
        </GlassCard>
      )}

      {loaded && data?.status === 'needs_figures' && (
        <GlassCard className="p-4 space-y-2 text-sm text-ink-secondary">
          <p>To work this out we need: {data.missing.join(', ')}.</p>
          <Link href="/financial-profile" className="text-family-400 underline">
            Open your financial profile
          </Link>
        </GlassCard>
      )}

      {loaded && data?.status === 'ready' && (
        <>
          <GlassCard className="p-4 space-y-3">
            <p className="text-base text-ink-primary">{data.text}</p>
            <p className="text-sm text-ink-tertiary">
              Left out of this estimate: {data.left_out.join(', ')}.
            </p>
            <EstimateStatus c={data.scenarios?.income_stops} />
          </GlassCard>
          {data.earner_dies && (
            <GlassCard className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
                If the main earner dies
              </h2>
              <p className="text-base text-ink-primary">{data.earner_dies.text}</p>
              <EstimateStatus c={data.scenarios?.earner_dies} />
              <ul className="space-y-1 text-sm text-ink-tertiary list-disc pl-5">
                {data.earner_dies.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </GlassCard>
          )}
          {data.figures && data.confirmation && (
            <GlassCard className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
                Figures used
              </h2>
              {changed && (
                <p role="status" data-testid="figure-changed" className="text-sm text-ink-primary">
                  {changed} The estimate above uses it now. Confirm the figures again below.
                </p>
              )}
              <dl className="space-y-1 text-sm">
                {data.figures.map((f) => (
                  <FigureRow key={f.label} figure={f} onSaved={afterEdit} />
                ))}
              </dl>
              {data.confirmation.confirmedBy.length > 0 && (
                <p className="text-sm text-ink-secondary">
                  Confirmed by {data.confirmation.confirmedBy.join(' and ')}.
                </p>
              )}
              {data.confirmation.allAdultsConfirmed ? (
                <p className="text-sm text-success">Both adults have confirmed these figures.</p>
              ) : data.confirmation.youConfirmed ? (
                <p className="text-sm text-ink-secondary">
                  You confirmed these figures. Waiting for the other adult.
                </p>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={confirm}
                  className="rounded-xl bg-family-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Confirm these figures
                </button>
              )}
              {failed && (
                <p className="text-sm text-danger">Could not save that. Try again in a moment.</p>
              )}
            </GlassCard>
          )}
          {history.length > 0 && <ConfirmationHistory entries={history} />}
          <GlassCard className="p-4 text-sm">
            <Link href="/resilience/businesses" className="text-family-400 underline">
              Does a business pay part of your income? Add it
            </Link>
          </GlassCard>
          {sharingOn && (
            <GlassCard className="p-4 text-sm">
              <Link href="/resilience/sharing" className="text-family-400 underline">
                Share your range anonymously with other households
              </Link>
            </GlassCard>
          )}
          {data.not_on_file && data.not_on_file.length > 0 && (
            <GlassCard className="p-4 space-y-2">
              <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
                Not on your list yet
              </h2>
              <ul className="space-y-2 text-sm text-ink-primary list-disc pl-5">
                {data.not_on_file.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <Link href="/finances" className="text-sm text-family-400 underline">
                Update your profile if either is wrong
              </Link>
            </GlassCard>
          )}
          <GlassCard className="p-4 space-y-2">
            <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
              What to check next
            </h2>
            <ul className="space-y-2 text-sm text-ink-primary list-disc pl-5">
              {data.next_checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </GlassCard>
        </>
      )}
    </div>
  )
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/** What each adult confirmed and on what date. Earlier figures stay listed after a change. */
function ConfirmationHistory({ entries }: { entries: ConfirmationHistoryEntry[] }) {
  return (
    <div data-testid="confirmation-history">
      <GlassCard className="p-4 space-y-3">
        <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
          What you have confirmed
        </h2>
        <ul className="space-y-4">
          {entries.map((e, i) => (
            <li key={i} className="space-y-1 text-sm">
              <p className="font-medium text-ink-primary">
                {e.scenario === 'earner_dies' ? 'If the main earner dies' : 'If your income stops'}
                <span className="ml-2 text-xs font-normal text-ink-tertiary">
                  {e.current ? 'figures as they are now' : 'earlier figures, since changed'}
                </span>
              </p>
              <ul className="text-ink-secondary">
                {e.confirmedBy.map((c) => (
                  <li key={c.name}>
                    {c.name} confirmed on {day(c.at)}
                  </li>
                ))}
              </ul>
              <p className="text-ink-tertiary">
                {e.figures.map((f) => `${f.label} ${gbp(f.valueMinor)}`).join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      </GlassCard>
    </div>
  )
}

/** Whether both adults have confirmed the exact figures this estimate reads. */
function EstimateStatus({ c }: { c: ResilienceConfirmation | undefined }) {
  if (!c) return null
  return (
    <p className="text-xs text-ink-tertiary" data-testid="estimate-status">
      {c.allAdultsConfirmed
        ? 'The figures behind this are confirmed by both adults.'
        : 'The figures behind this need confirming.'}
    </p>
  )
}
