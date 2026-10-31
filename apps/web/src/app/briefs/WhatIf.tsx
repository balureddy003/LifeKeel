'use client'

/**
 * "Try a what-if" on a finished brief: move a figure, watch the answer move.
 * The sliders change the household's own entered numbers; the new answer comes
 * from the same solver via the preview endpoint, so nothing is saved, shared or
 * recommended. The original answer stays on the chart as a dashed line.
 */
import { useEffect, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Skeleton } from '@/components/Glass'
import { previewBrief, type BriefPreview, type HouseholdBrief } from '@/lib/api'
import { track } from '@/lib/growth-track'
import { briefHeadline, runsOutAround, splitBriefSentence } from '@/lib/brief-text'
import { RunwayChart } from './RunwayChart'
import {
  applyWhatIf,
  biggestLever,
  hasChanged,
  leverNudge,
  runwayOf,
  whatIfSliders,
  type SliderKey,
} from './what-if'

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

export function WhatIf({ brief }: { brief: HouseholdBrief }) {
  const sliders = brief.result && brief.inputs ? whatIfSliders(brief.inputs) : []
  const [values, setValues] = useState<Partial<Record<SliderKey, number>>>({})
  const [state, setState] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error'
    data?: BriefPreview
    error?: string
  }>({ status: 'idle' })
  const [used, setUsed] = useState(false)
  const [lead, setLead] = useState<SliderKey | undefined>(undefined)
  const [probed, setProbed] = useState(false)
  const changed = hasChanged(sliders, values)

  useEffect(() => {
    if (!changed) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading' }))
    const timer = setTimeout(async () => {
      const res = await previewBrief({
        problem_type: brief.problem_type,
        inputs: applyWhatIf(brief.inputs, values),
      })
      if (cancelled) return
      if (res.ok) setState({ status: 'ready', data: res.data!.preview })
      else
        setState({
          status: 'error',
          error:
            res.status === 400
              ? ((res.data as { error?: string } | undefined)?.error ?? 'Check the figures')
              : 'The what-if is not available right now.',
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [changed, values, brief.problem_type, brief.inputs])

  // On first open, try a 10% move on each figure and start from the one that
  // shifts the answer most. Same solver, nothing saved.
  const probe = async () => {
    if (probed || sliders.length < 2) return
    setProbed(true)
    const base = runwayOf(brief.result)
    const moved = await Promise.all(
      sliders.map(async (s) => {
        const res = await previewBrief({
          problem_type: brief.problem_type,
          inputs: applyWhatIf(brief.inputs, { [s.key]: leverNudge(s) }),
        })
        return { key: s.key, runway: res.ok ? runwayOf(res.data!.preview.result) : base }
      }),
    )
    const key = biggestLever(base, moved)
    const lever = sliders.find((s) => s.key === key)
    if (!lever) return
    setLead(lever.key)
    setValues((cur) => (Object.keys(cur).length === 0 ? { [lever.key]: leverNudge(lever) } : cur))
  }

  if (sliders.length === 0) return null
  const savingsNow = values.liquid_savings_minor ?? Number(brief.inputs.liquid_savings_minor ?? 0)
  const original = {
    result: brief.result,
    startSavings: Number(brief.inputs.liquid_savings_minor ?? 0),
  }

  return (
    <details
      className="rounded-2xl border border-haze bg-surface-1 p-4"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) void probe()
        if ((e.target as HTMLDetailsElement).open && !used) {
          setUsed(true)
          track('brief_whatif_used', { problem_type: brief.problem_type })
        }
      }}
    >
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium text-ink-primary">
        <SlidersHorizontal size={16} aria-hidden="true" /> Try a what-if
      </summary>
      <p className="mt-2 text-sm text-ink-secondary">
        Move a figure to see how the answer changes. Nothing here is saved or shared.
      </p>

      {lead && (
        <p className="mt-2 text-sm text-ink-primary">
          Starting with “{sliders.find((x) => x.key === lead)?.label.toLowerCase()}”: a 10% change
          there moves your date the most.
        </p>
      )}

      <div className="mt-4 space-y-5">
        {[...sliders]
          .sort((a, b) => Number(b.key === lead) - Number(a.key === lead))
          .map((s) => {
            const v = values[s.key] ?? s.base
            const diff = v - s.base
            return (
              <div key={s.key}>
                <label
                  htmlFor={`wi-${s.key}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="text-sm text-ink-primary">{s.label}</span>
                  <span className="text-sm font-medium text-ink-primary">
                    {gbp(v)}
                    {diff !== 0 && (
                      <span className="ml-2 text-xs font-normal text-ink-tertiary">
                        {diff > 0 ? '+' : '−'}
                        {gbp(Math.abs(diff))} from what you entered
                      </span>
                    )}
                  </span>
                </label>
                <input
                  id={`wi-${s.key}`}
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={v}
                  aria-valuetext={gbp(v)}
                  onChange={(e) => setValues({ ...values, [s.key]: Number(e.target.value) })}
                  className="mt-2 h-8 w-full accent-family-500"
                />
              </div>
            )
          })}
      </div>

      {changed && (
        <div aria-live="polite" className="mt-4 rounded-xl bg-surface-2 p-4">
          {state.status === 'loading' && !state.data && <Skeleton className="h-14 w-full" />}
          {state.status === 'error' && <p className="text-sm text-ink-secondary">{state.error}</p>}
          {state.data && state.status !== 'error' && (
            <div className={state.status === 'loading' ? 'opacity-60' : ''}>
              <p className="text-lg font-medium text-ink-primary">
                {briefHeadline(splitBriefSentence(state.data.template_sentence).main)}
              </p>
              <RunwayChart
                result={state.data.result}
                startSavings={savingsNow}
                runsOutLabel={runsOutAround(state.data.template_sentence)}
                baseline={original}
              />
            </div>
          )}
        </div>
      )}

      {changed && (
        <button
          type="button"
          onClick={() => setValues({})}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-haze px-4 text-sm font-medium text-ink-secondary"
        >
          <RotateCcw size={16} aria-hidden="true" /> Back to what I entered
        </button>
      )}
    </details>
  )
}
