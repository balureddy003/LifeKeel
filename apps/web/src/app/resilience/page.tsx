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
import {
  confirmResilienceFigures,
  fetchFamilyLearning,
  fetchFamilyResilience,
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

  const reload = () =>
    fetchFamilyResilience()
      .then(setData)
      .finally(() => setLoaded(true))
  useEffect(() => {
    void reload()
    void fetchFamilyLearning().then((l) => setSharingOn(l !== null))
  }, [])

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
          <Link href="/financial-profile" className="text-accent underline">
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
              <dl className="space-y-1 text-sm">
                {data.figures.map((f) => (
                  <div key={f.label} className="flex justify-between">
                    <dt className="text-ink-secondary">{f.label}</dt>
                    <dd className="text-ink-primary">{gbp(f.valueMinor)}</dd>
                  </div>
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
                  className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  Confirm these figures
                </button>
              )}
              {failed && (
                <p className="text-sm text-danger">Could not save that. Try again in a moment.</p>
              )}
            </GlassCard>
          )}
          <GlassCard className="p-4 text-sm">
            <Link href="/resilience/businesses" className="text-accent underline">
              Does a business pay part of your income? Add it
            </Link>
          </GlassCard>
          {sharingOn && (
            <GlassCard className="p-4 text-sm">
              <Link href="/resilience/sharing" className="text-accent underline">
                Share your range anonymously with other households
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
