'use client'

/**
 * /resilience/sharing — opt in to share one range of months, anonymously, with other households (intent 96).
 * Tier 0. The server decides everything: whether this exists at all (it is switched off by default), who may
 * see it, and when a household counts as contributing. This page explains plainly what is and is not shared,
 * and records one adult's choice. Every adult has to agree, and any adult can stop at any time.
 */

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PageHeader, GlassCard } from '@/components/Glass'
import {
  fetchFamilyLearning,
  fetchLearningBenchmark,
  setFamilyLearning,
  type FamilyLearning,
  type LearningBenchmark,
} from '@/lib/api'

const BAND_LABEL = {
  '0-3': '0 to 3 months',
  '3-6': '3 to 6 months',
  '6-12': '6 to 12 months',
  '12+': '12 months or more',
} as const

export default function SharingPage() {
  const [state, setState] = useState<FamilyLearning | null>(null)
  const [bench, setBench] = useState<LearningBenchmark | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const reload = async () => {
    const s = await fetchFamilyLearning()
    setState(s)
    setBench(s?.contributing ? await fetchLearningBenchmark() : null)
    setLoaded(true)
  }
  useEffect(() => {
    void reload()
  }, [])

  const change = async (optIn: boolean) => {
    setBusy(true)
    setFailed(false)
    const ok = await setFamilyLearning(optIn)
    if (ok) await reload()
    else setFailed(true)
    setBusy(false)
  }

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader
        title="Share anonymously"
        backHref="/resilience"
        subtitle="Compare your household with others, if every adult agrees"
      />

      {!loaded && (
        <div className="flex justify-center py-10 text-ink-tertiary">
          <Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" />
        </div>
      )}

      {loaded && !state && (
        <GlassCard className="p-4 text-sm text-ink-secondary">
          This is not available right now.
        </GlassCard>
      )}

      {loaded && state && (
        <>
          <GlassCard className="p-4 space-y-3 text-sm text-ink-secondary">
            <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
              What is shared
            </h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                One range of months, such as &ldquo;3 to 6&rdquo;, taken from your income-stops
                estimate.
              </li>
              <li>Never your figures, names or documents.</li>
              <li>It is stored against your household only so it can be deleted when you stop.</li>
              <li>
                It is counted with other households. You only see totals, and only when enough have
                joined.
              </li>
              <li>It is not used to train any AI model.</li>
            </ul>
            <p>
              Every adult in your family has to agree before anything is shared. You can stop at any
              time, and stopping removes your household&apos;s range straight away.
            </p>
          </GlassCard>

          <GlassCard className="p-4 space-y-3">
            <p className="text-sm text-ink-primary">
              {state.adultsOptedIn} of {state.adultsTotal} adults have agreed.
            </p>
            {state.contributing ? (
              <p className="text-sm text-success">Your household is sharing its range.</p>
            ) : state.optedIn ? (
              <p className="text-sm text-ink-secondary">You agreed. Waiting for the other adult.</p>
            ) : null}
            {state.optedIn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => change(false)}
                className="rounded-xl border border-line px-4 py-2 text-sm text-ink-primary disabled:opacity-60"
              >
                Stop sharing
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => change(true)}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Share my household&apos;s range
              </button>
            )}
            {failed && (
              <p className="text-sm text-danger">
                Could not save that. Check your savings, spend and income are entered, then try
                again.
              </p>
            )}
          </GlassCard>

          {state.contributing && bench && (
            <GlassCard className="p-4 space-y-3">
              <h2 className="text-sm font-semibold text-ink-tertiary uppercase tracking-wide">
                Other households
              </h2>
              {bench.available && bench.bands ? (
                <>
                  <p className="text-sm text-ink-secondary">
                    {bench.total} households have shared a range.
                  </p>
                  <dl className="space-y-1 text-sm">
                    {(Object.keys(BAND_LABEL) as (keyof typeof BAND_LABEL)[]).map((b) => (
                      <div key={b} className="flex justify-between">
                        <dt className="text-ink-secondary">{BAND_LABEL[b]}</dt>
                        <dd className="text-ink-primary">
                          {bench.bands?.[b] ?? (
                            <span className="text-ink-tertiary">fewer than 5</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="text-sm text-ink-secondary">
                  Not enough households yet. Totals appear once enough have joined.
                </p>
              )}
            </GlassCard>
          )}
        </>
      )}
    </div>
  )
}
