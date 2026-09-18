'use client'

/**
 * Public, unauthenticated "Family Readiness Score" quiz (PRD-201) — the
 * detector engine as a growth loop. Six quick questions run through the
 * exact same rules a real account's data would, via POST /readiness-quiz.
 * No signup, no lead-capture gate before the score renders: the score and
 * reasoning show first, the signup CTA comes after.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Share2, Check } from 'lucide-react'
import { GlassCard, GlassButton, PageHeader, ScoreRing } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { submitReadinessQuiz, type ReadinessQuizResult } from '@/lib/api'
import { learnMoreHref } from '@/lib/detector-content'

const QUIZ_URL = 'https://kairos-trellis.web.app/readiness/'

// The quiz's own pitch is "no signup, no email required" — sharing has to
// hold to that: only the score itself, never any of the six numbers behind
// it, so a shared link never leaks the household finances that produced it.
function ShareScore({ score }: { score: number }) {
  const [copied, setCopied] = useState(false)
  const shareText = `I scored ${score}/100 on Agent Oak's Family Readiness Score. What's yours?`

  async function handleShare() {
    haptic('light')
    track('readiness_share_click', { method: 'native' })
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: QUIZ_URL })
      } catch {
        // User dismissed the share sheet — not an error worth surfacing.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${QUIZ_URL}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can be unavailable (older browsers, non-secure
      // context) — the buttons below still work without it.
    }
  }

  return (
    <div className="w-full mt-3">
      <div className="flex gap-2">
        <button
          onClick={handleShare}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold bg-family-500/10 border border-family-500/20 text-family-400"
        >
          {copied ? <Check size={16} /> : <Share2 size={16} />}
          {copied ? 'Copied' : 'Share your score'}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${QUIZ_URL}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { haptic('light'); track('readiness_share_click', { method: 'whatsapp' }) }}
          className="w-12 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-ink-secondary flex-shrink-0"
          aria-label="Share on WhatsApp"
        >
          <span className="text-[11px] font-bold">WA</span>
        </a>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(QUIZ_URL)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { haptic('light'); track('readiness_share_click', { method: 'x' }) }}
          className="w-12 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.08] text-ink-secondary flex-shrink-0"
          aria-label="Share on X"
        >
          <span className="text-[13px] font-bold">𝕏</span>
        </a>
      </div>
    </div>
  )
}

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
  prefix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  prefix?: string
}) {
  return (
    <label className="block mb-4">
      <div className="text-xs text-ink-tertiary mb-1.5">{label}</div>
      <div className="relative">
        {prefix && (
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base text-ink-tertiary">{prefix}</span>
        )}
        <input
          type="number"
          inputMode="decimal"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '0'}
          className={`glass-input w-full rounded-xl py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all ${prefix ? 'pl-8 pr-4' : 'px-4'}`}
        />
      </div>
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

  // Submitting replaces the entire form (all 6 fields plus "See my score")
  // with a completely different results view — same silent-transition shape
  // fixed elsewhere this session, but on a public, unauthenticated growth
  // page where it's likely to see real, unpredictable traffic. Moving focus
  // to the results region gives a screen-reader user both an announcement
  // and a stable landmark instead of leaving focus on a button that no
  // longer exists.
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (result) resultRef.current?.focus()
  }, [result])

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
    // Backend has carried this event in its allowlist since PRD-201, but
    // nothing ever called it — the funnel could see the quiz start, never
    // whether anyone actually got a score out of it.
    if (res.score !== null) {
      track('readiness_quiz_completed', { score: res.score })
    }
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
          <p className="text-xs text-ink-tertiary mb-4">
            Used only to calculate your score right now — nothing is saved or linked to you.
          </p>
          <Field label="Monthly household income" value={form.monthlySalary} onChange={set('monthlySalary')} prefix="£" />
          <Field label="Monthly living expenses" value={form.monthlyExpenses} onChange={set('monthlyExpenses')} prefix="£" />
          <Field label="Emergency savings on hand" value={form.emergencySavings} onChange={set('emergencySavings')} prefix="£" />
          <Field label="Mortgage still outstanding" value={form.mortgageOutstanding} onChange={set('mortgageOutstanding')} prefix="£" />
          <Field label="Life insurance coverage" value={form.lifeCover} onChange={set('lifeCover')} prefix="£" />
          <Field label="Number of dependents" value={form.dependents} onChange={set('dependents')} placeholder="0" />

          <GlassButton onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Calculating…' : 'See my score'}
          </GlassButton>
        </div>
      )}

      {result && result.score !== null && (
        <div ref={resultRef} tabIndex={-1} aria-label={`Your Family Readiness Score: ${result.score} out of 100`} className="mt-6 flex flex-col items-center outline-none">
          <ScoreRing score={result.score} size={160} />
          <ShareScore score={result.score} />

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
                  {learnMoreHref(insight.rule_id) && (
                    <Link href={learnMoreHref(insight.rule_id)!} className="text-xs text-family-400 font-semibold mt-2 inline-block">
                      Learn more →
                    </Link>
                  )}
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
        <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
          <GlassCard className="p-4 mt-6">
            <p className="text-sm text-ink-secondary leading-relaxed">
              {result.error ?? "Couldn't calculate your score right now — please try again later."}
            </p>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
