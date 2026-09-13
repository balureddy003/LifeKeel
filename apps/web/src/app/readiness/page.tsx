'use client'

/**
 * Public, unauthenticated "Family Readiness Score" quiz (PRD-201) — the
 * detector engine as a growth loop. Six quick questions run through the
 * exact same rules a real account's data would, via POST /readiness-quiz.
 * No signup, no lead-capture gate before the score renders: the score and
 * reasoning show first, the signup CTA comes after.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GlassCard, GlassButton, PageHeader, ScoreRing } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { submitReadinessQuiz, type ReadinessQuizResult } from '@/lib/api'

function toMinor(whole: string): number {
  const n = Number(whole)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0
}

function readableHypothesis(hypothesis: string): string {
  return hypothesis.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block mb-4">
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0'}
        className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
      />
    </label>
  )
}

const EMPTY_FORM = {
  monthlySalary: '',
  emergencySavings: '',
  monthlyExpenses: '',
  mortgageOutstanding: '',
  lifeCover: '',
  dependents: '',
}

export default function ReadinessQuizPage() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ReadinessQuizResult | null>(null)

  useEffect(() => {
    track('readiness_quiz_started')
  }, [])

  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }))

  async function handleSubmit() {
    haptic('medium')
    setSubmitting(true)
    const res = await submitReadinessQuiz({
      monthly_salary_minor: toMinor(form.monthlySalary),
      emergency_savings_minor: toMinor(form.emergencySavings),
      monthly_expenses_minor: toMinor(form.monthlyExpenses),
      mortgage_outstanding_minor: toMinor(form.mortgageOutstanding),
      life_cover_minor: toMinor(form.lifeCover),
      dependents: Number(form.dependents) || 0,
    })
    setResult(res)
    setSubmitting(false)
  }

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader
        title="Family Readiness Score"
        subtitle="Six quick questions. No signup, no email required."
        action={<></>}
      />

      {!result && (
        <div className="mt-4">
          <Field label="Monthly household income ($)" value={form.monthlySalary} onChange={set('monthlySalary')} />
          <Field label="Monthly living expenses ($)" value={form.monthlyExpenses} onChange={set('monthlyExpenses')} />
          <Field label="Emergency savings on hand ($)" value={form.emergencySavings} onChange={set('emergencySavings')} />
          <Field label="Mortgage still outstanding ($)" value={form.mortgageOutstanding} onChange={set('mortgageOutstanding')} />
          <Field label="Life insurance coverage ($)" value={form.lifeCover} onChange={set('lifeCover')} />
          <Field label="Number of dependents" value={form.dependents} onChange={set('dependents')} placeholder="0" />

          <GlassButton onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Calculating…' : 'See my score'}
          </GlassButton>
        </div>
      )}

      {result && result.score !== null && (
        <div className="mt-6 flex flex-col items-center">
          <ScoreRing score={result.score} size={160} />

          {result.insights.length === 0 ? (
            <GlassCard className="p-4 mt-6 w-full">
              <p className="text-sm text-ink-secondary leading-relaxed">
                Oak didn&apos;t find an obvious gap in the two areas this quick quiz checks. A full profile covers
                four more areas, including retirement and education funding.
              </p>
            </GlassCard>
          ) : (
            <div className="w-full mt-6 space-y-3">
              {result.insights.map((insight, i) => (
                <GlassCard key={i} className="p-4">
                  <div className="text-sm font-semibold text-ink-primary mb-1">
                    {readableHypothesis(insight.hypothesis)}
                  </div>
                  <p className="text-sm text-ink-secondary leading-relaxed">{insight.reasoning}</p>
                </GlassCard>
              ))}
            </div>
          )}

          <GlassCard className="p-4 mt-4 w-full">
            <p className="text-sm text-ink-secondary leading-relaxed mb-3">
              This is based on 2 of Oak&apos;s 6 signals — protection and emergency-fund coverage. See your full
              picture, including retirement and education funding, free.
            </p>
            <Link href="/welcome" onClick={() => { haptic('light'); track('landing_get_started_click', { location: 'readiness_quiz' }) }}>
              <GlassButton>Get my full picture</GlassButton>
            </Link>
          </GlassCard>
        </div>
      )}

      {result && result.score === null && (
        <GlassCard className="p-4 mt-6">
          <p className="text-sm text-ink-secondary leading-relaxed">
            {result.error ?? "Couldn't calculate your score right now — please try again later."}
          </p>
        </GlassCard>
      )}
    </div>
  )
}
