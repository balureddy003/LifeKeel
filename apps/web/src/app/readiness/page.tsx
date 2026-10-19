'use client'

/**
 * Public, unauthenticated "Family Readiness Check" quiz (PRD-201) — the
 * detector engine as a growth loop. Six quick questions run through the
 * exact same rules a real account's data would, via POST /readiness-quiz.
 * No signup, no lead-capture gate before the score renders: the score and
 * reasoning show first, the signup CTA comes after.
 *
 * Named "Check", not "Score", on purpose: the in-app Family Readiness
 * Score is a different metric computed from a real account's linked data
 * and open insights — sharing the name invited "why is my score different
 * here?" confusion.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Share2, Check } from 'lucide-react'
import { GlassCard, GlassButton, PageHeader, ScoreRing } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { track } from '@/lib/growth-track'
import { trackConversion } from '@/lib/ad-track'
import {
  submitReadinessQuiz,
  captureLead,
  readinessShareUrl,
  type ReadinessQuizResult,
} from '@/lib/api'
import { learnMoreHref } from '@/lib/detector-content'
import { appUrl } from '@/lib/region'

// (Share links route through readinessShareUrl → the API's per-score OG
// card, not a hardcoded site URL — see lib/api.ts.)

// The quiz's own pitch is "no signup, no email required" — sharing has to
// hold to that: only the score itself, never any of the six numbers behind
// it, so a shared link never leaks the household finances that produced it.
function ShareScore({ score }: { score: number }) {
  const [copied, setCopied] = useState(false)
  // Per-score share URL — the API serves per-score OG tags to scrapers and
  // redirects humans to the quiz with share-attribution UTMs.
  const shareUrl = readinessShareUrl(score)
  const shareText = `I scored ${score}/100 on LifeKeel's Family Readiness Check. What's yours?`

  async function handleShare() {
    haptic('light')
    track('readiness_share_click', { method: 'native' })
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: shareUrl })
      } catch {
        // User dismissed the share sheet — not an error worth surfacing.
      }
      return
    }
    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`)
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
          href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            haptic('light')
            track('readiness_share_click', { method: 'whatsapp' })
          }}
          className="w-12 flex items-center justify-center rounded-xl bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary flex-shrink-0"
          aria-label="Share on WhatsApp"
        >
          <span className="text-footnote font-bold">WA</span>
        </a>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            haptic('light')
            track('readiness_share_click', { method: 'x' })
          }}
          className="w-12 flex items-center justify-center rounded-xl bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary flex-shrink-0"
          aria-label="Share on X"
        >
          <span className="text-subhead font-bold">𝕏</span>
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
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base text-ink-tertiary">
            {prefix}
          </span>
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

/**
 * Optional post-score email capture. The quiz promise is "no email
 * required", so this sits below the results and is strictly opt-in: a lead
 * is only created when the visitor types an address and ticks consent.
 * Nothing about the quiz answers themselves is sent.
 */
function EmailCapture({ score }: { score: number }) {
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')

  async function submit() {
    haptic('light')
    setState('busy')
    const band = `${Math.floor(score / 10) * 10}-${Math.floor(score / 10) * 10 + 10}`
    const ok = await captureLead({
      email: email.trim(),
      source: 'readiness_quiz',
      score_band: band,
    })
    setState(ok ? 'done' : 'error')
    if (ok) trackConversion('lead')
    // No client-side funnel event needed — POST /leads already records
    // 'lead_captured' server-side with source/score_band.
  }

  if (state === 'done') {
    return (
      <GlassCard className="p-4 mt-4 w-full">
        <p className="text-sm text-ink-secondary leading-relaxed">
          Thanks — we&apos;ll only use your email for what you opted into. You can ask us to stop
          any time.
        </p>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-4 mt-4 w-full">
      <p className="text-sm font-semibold text-ink-primary">Want us to keep in touch?</p>
      <p className="text-xs text-ink-tertiary mt-1 leading-relaxed">
        Optional — leave your email for product updates and family-readiness tips. No spam.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="glass-input w-full rounded-xl px-4 py-3 mt-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40"
      />
      <label className="mt-3 flex items-start gap-2.5 text-xs text-ink-secondary leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 accent-family-500"
        />
        I agree to LifeKeel contacting me at this address.
      </label>
      {state === 'error' && (
        <p className="text-xs text-danger mt-2">Couldn&apos;t save that — please try again.</p>
      )}
      <GlassButton
        onClick={submit}
        disabled={state === 'busy' || !email.trim() || !consent}
        className="mt-3"
      >
        {state === 'busy' ? 'Saving…' : 'Keep me posted'}
      </GlassButton>
    </GlassCard>
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

const STEPS: {
  key: keyof typeof EMPTY_FORM
  label: string
  hint: string
  prefix?: string
  placeholder?: string
}[] = [
  {
    key: 'monthlySalary',
    label: 'Monthly household income',
    hint: 'All earners combined, before tax.',
    prefix: '£',
  },
  {
    key: 'monthlyExpenses',
    label: 'Monthly living expenses',
    hint: "Rent/mortgage, food, transport, bills — the costs that don't stop.",
    prefix: '£',
  },
  {
    key: 'emergencySavings',
    label: 'Emergency savings on hand',
    hint: 'Cash you could access within a week if you needed to.',
    prefix: '£',
  },
  {
    key: 'mortgageOutstanding',
    label: 'Mortgage still outstanding',
    hint: 'The remaining balance, not the monthly payment. Enter 0 if you rent.',
    prefix: '£',
  },
  {
    key: 'lifeCover',
    label: 'Life insurance coverage',
    hint: 'The total payout amount across all policies. Enter 0 if none.',
    prefix: '£',
  },
  {
    key: 'dependents',
    label: 'Number of dependents',
    hint: "Children, elderly relatives — anyone who relies on this household's income.",
    placeholder: '0',
  },
]

function scoreBand(score: number): { label: string; color: string; description: string } {
  if (score >= 80)
    return {
      label: 'Well covered',
      color: 'text-success',
      description: 'Your household has solid buffers in the areas this quiz covers.',
    }
  if (score >= 60)
    return {
      label: 'Some gaps',
      color: 'text-warning',
      description: 'Some areas are covered, but there are gaps worth knowing about.',
    }
  if (score >= 40)
    return {
      label: 'Several gaps',
      color: 'text-orange-400',
      description: 'Meaningful gaps exist — knowing them is the first step to addressing them.',
    }
  return {
    label: 'Many gaps',
    color: 'text-danger',
    description: 'Significant gaps in coverage or savings — worth reviewing with a professional.',
  }
}

export default function ReadinessQuizPage() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [step, setStep] = useState(0)
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

  const isLastStep = step === STEPS.length - 1
  const currentStep = STEPS[step]
  const progress = result ? 100 : Math.round((step / STEPS.length) * 100)

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader
        title="Family Readiness Check"
        subtitle="Six quick questions. No signup, no email required."
        action={<></>}
      />

      {/* Progress bar — visible during quiz and on result */}
      <div className="h-1.5 rounded-full bg-tint/5 overflow-hidden mt-2 mb-4">
        <div
          className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {!result && (
        <div className="mt-2">
          <p className="text-xs text-ink-tertiary mb-4">
            Used only to calculate your score right now — nothing is saved or linked to you.
          </p>

          {/* Step-through: one question at a time on mobile, all visible on desktop */}
          <div className="hidden sm:block">
            {STEPS.map((s) => (
              <div key={s.key}>
                <Field
                  label={s.label}
                  value={form[s.key]}
                  onChange={set(s.key)}
                  {...(s.prefix ? { prefix: s.prefix } : {})}
                  {...(s.placeholder ? { placeholder: s.placeholder } : {})}
                />
                <p className="text-[11px] text-ink-tertiary -mt-3 mb-6 px-1">{s.hint}</p>
              </div>
            ))}
            <GlassButton onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Calculating…' : 'See my score'}
            </GlassButton>
          </div>

          {/* Mobile step-by-step */}
          <div className="sm:hidden">
            {currentStep && (
              <>
                <p className="text-xs font-semibold text-family-400 mb-1">
                  Question {step + 1} of {STEPS.length}
                </p>
                <Field
                  label={currentStep.label}
                  value={form[currentStep.key]}
                  onChange={set(currentStep.key)}
                  {...(currentStep.prefix ? { prefix: currentStep.prefix } : {})}
                  {...(currentStep.placeholder ? { placeholder: currentStep.placeholder } : {})}
                />
                <p className="text-[11px] text-ink-tertiary -mt-3 mb-6 px-1">{currentStep.hint}</p>
                <div className="flex gap-2">
                  {step > 0 && (
                    <button
                      onClick={() => {
                        haptic('light')
                        setStep(step - 1)
                      }}
                      className="flex-1 rounded-xl py-3 text-sm font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary"
                    >
                      Back
                    </button>
                  )}
                  {isLastStep ? (
                    <GlassButton onClick={handleSubmit} disabled={submitting} className="flex-1">
                      {submitting ? 'Calculating…' : 'See my score'}
                    </GlassButton>
                  ) : (
                    <GlassButton
                      onClick={() => {
                        haptic('light')
                        setStep(step + 1)
                      }}
                      className="flex-1"
                    >
                      Next
                    </GlassButton>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {result &&
        result.score !== null &&
        (() => {
          const band = scoreBand(result.score)
          return (
            <div
              ref={resultRef}
              tabIndex={-1}
              aria-label={`Your Family Readiness Check result: ${result.score} out of 100`}
              className="mt-6 flex flex-col items-center outline-none"
            >
              <ScoreRing score={result.score} size={160} />
              <div className="mt-3 text-center">
                <span className={`text-lg font-bold ${band.color}`}>{band.label}</span>
                <p className="text-sm text-ink-secondary mt-1 max-w-xs">{band.description}</p>
              </div>

              {/* PRD-125: the breakdown uses the same component labels + weights
              the in-app readiness score does — scored only for what the
              quiz collected. */}
              {result.components && result.components.length > 0 && (
                <GlassCard className="p-4 mt-4 w-full space-y-2">
                  {result.components
                    .filter((c) => c.score !== null)
                    .map((c) => (
                      <div key={c.key}>
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm font-medium text-ink-primary">{c.label}</span>
                          <span className="text-xs text-ink-tertiary">{c.score}/100</span>
                        </div>
                        <p className="text-xs text-ink-tertiary">{c.detail}</p>
                      </div>
                    ))}
                </GlassCard>
              )}

              <ShareScore score={result.score} />
              <EmailCapture score={result.score} />

              {result.insights.length === 0 ? (
                <GlassCard className="p-4 mt-6 w-full">
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    Keel didn&apos;t find an obvious gap in the two areas this quick quiz checks. A
                    full profile covers four more areas, including retirement and education funding.
                  </p>
                </GlassCard>
              ) : (
                <div className="w-full mt-6 space-y-3">
                  {result.insights.map((insight, i) => (
                    <GlassCard key={i} className="p-4">
                      <div className="text-sm font-semibold text-ink-primary mb-1">
                        {readableHypothesis(insight.hypothesis)}
                      </div>
                      <p className="text-sm text-ink-secondary leading-relaxed">
                        {insight.reasoning}
                      </p>
                      {learnMoreHref(insight.rule_id) && (
                        <Link
                          href={learnMoreHref(insight.rule_id)!}
                          className="text-xs text-family-400 font-semibold mt-2 inline-block"
                        >
                          Learn more →
                        </Link>
                      )}
                    </GlassCard>
                  ))}
                </div>
              )}

              <GlassCard className="p-4 mt-4 w-full">
                <p className="text-sm font-semibold text-ink-primary mb-2">
                  This was a snapshot. Keel is a system that keeps watching.
                </p>
                <p className="text-sm text-ink-secondary leading-relaxed mb-3">
                  The quiz scored two domains from six questions. A full account scores five
                  domains, monitors them continuously with 9 detectors, and alerts you when
                  something changes &mdash; even when nobody logs in.
                </p>
                <ul className="text-xs text-ink-tertiary leading-relaxed space-y-1.5 mb-3">
                  <li>
                    • Protection, wealth, goals, savings, and estate &mdash; checked
                    daily
                  </li>
                  <li>
                    • Every family member gets their own readiness view, scoped to their life stage
                  </li>
                  <li>• Crisis playbooks built from your real data, not generic checklists</li>
                  <li>
                    • Zero commissions &mdash; Keel has no financial relationship with any insurer
                  </li>
                </ul>
                {/* plain <a>: /welcome lives on the app host — a <Link>'s RSC fetch dies on the cross-origin redirect (see appUrl) */}
                <a
                  href={appUrl('/welcome')}
                  onClick={() => {
                    haptic('light')
                    track('landing_get_started_click', { location: 'readiness_quiz' })
                  }}
                >
                  <GlassButton>Start monitoring for free</GlassButton>
                </a>
                <p className="text-[11px] text-ink-tertiary mt-2">
                  No card required. Free forever for core features. Keel Plus (£7.99/mo) adds AI
                  document reading.
                </p>
              </GlassCard>
            </div>
          )
        })()}

      {result && result.score === null && (
        <div
          ref={resultRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="outline-none"
        >
          <GlassCard className="p-4 mt-6">
            <p className="text-sm text-ink-secondary leading-relaxed mb-3">
              {result.error ??
                "Your score couldn't be calculated just now — your answers are saved. Try again in a moment."}
            </p>
            <div className="flex gap-2">
              <GlassButton onClick={handleSubmit} disabled={submitting} className="flex-1">
                {submitting ? 'Calculating…' : 'Try again'}
              </GlassButton>
              <button
                onClick={() => {
                  haptic('light')
                  setResult(null)
                }}
                className="flex-1 rounded-xl py-3 text-sm font-semibold bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary"
              >
                Edit answers
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  )
}
