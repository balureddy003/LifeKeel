'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, Copy, HelpCircle, Loader2, Mail, PenLine } from 'lucide-react'
import { LIFE_EVENTS } from '@/lib/life-data'
import { GlassCard, GlassButton, PageHeader, PageTransition } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useEventReadiness } from '@/lib/useFamilyData'
import { useAuth } from '@/lib/auth-context'
import { prepareInsightDraft, fetchFinancialProfile, previewScenario, saveFamilyScenario, fetchFamilyScenarios, deleteFamilyScenario, type FinancialProfilePolicy, type PolicyType, type ScenarioResult, type FamilyScenario } from '@/lib/api'
import { learnMoreHref } from '@/lib/detector-content'

export interface Action {
  id: string
  label: string
  done: boolean
  // OAK-014: when set, and a policy of one of these types exists on the
  // household's financial profile, personalize() replaces the generic
  // label with one naming the real provider — otherwise the generic label
  // (above) renders unchanged.
  policyTypes?: PolicyType[]
  personalize?: (provider: string) => string
}

export const EVENT_ACTIONS: Record<string, Action[]> = {
  bereavement: [
    {
      id: '1',
      label: 'Call your life insurance provider to start a claim',
      done: false,
      policyTypes: ['life'],
      personalize: (provider) => `Call ${provider} about your life insurance claim`,
    },
    { id: '2', label: 'Contact employer for survivor benefits', done: false },
    { id: '3', label: 'Notify pension provider for survivor pension', done: false },
    { id: '4', label: 'Check whether your mortgage has protection cover', done: false },
    { id: '5', label: 'Schedule a meeting with a financial advisor', done: false },
  ],
  medical: [
    {
      id: '1',
      label: 'Review your health insurance coverage details',
      done: false,
      policyTypes: ['health', 'critical_illness'],
      personalize: (provider) => `Review your ${provider} coverage details`,
    },
    { id: '2', label: 'Check if pre-authorization is needed for treatment', done: false },
    { id: '3', label: 'Confirm your annual out-of-pocket maximum', done: false },
    { id: '4', label: 'Check your HSA balance for eligible expenses', done: false },
  ],
  'job-loss': [
    { id: '1', label: 'Review how many months your emergency savings cover', done: false },
    { id: '2', label: 'Check if you have income protection insurance', done: false },
    { id: '3', label: 'Review budget and cut non-essential spending', done: false },
    { id: '4', label: 'Update resume and start job search', done: false },
    { id: '5', label: 'Check eligibility for unemployment benefits', done: false },
  ],
  retirement: [
    { id: '1', label: 'Review your pension progress toward your target', done: false },
    { id: '2', label: 'See whether increasing monthly contributions helps', done: false },
    { id: '3', label: 'Confirm your employer match is fully utilized', done: false },
    { id: '4', label: 'Check your state pension forecast', done: false },
    { id: '5', label: 'Schedule a retirement planning review', done: false },
  ],
  default: [
    { id: '1', label: 'Review your insurance coverage', done: false },
    { id: '2', label: 'Check emergency savings', done: false },
    { id: '3', label: 'Contact your financial advisor', done: false },
  ],
}

const EVENT_STABILITY: Record<string, number> = {
  bereavement: 85,
  medical: 92,
  'job-loss': 78,
  car: 88,
  travel: 90,
  property: 85,
  'new-child': 75,
  marriage: 80,
  university: 82,
  retirement: 65,
}

const EVENT_AI_EXPLANATION: Record<string, string> = {
  bereavement: "This is a sample scenario, not based on your data yet. Families in this situation typically lean on life insurance, employer survivor benefits, and any survivor pension to stay afloat. Connect your policies and documents so we can show your actual coverage instead of this example.",
  medical: "This is a sample scenario, not based on your data yet. Most health insurance plans cover emergencies after a deductible, up to an annual out-of-pocket maximum, with an HSA sometimes available for extra costs. Connect your insurance documents so we can show your actual coverage instead of this example.",
  'job-loss': "This is a sample scenario, not based on your data yet. Families typically lean on emergency savings and any income protection insurance to bridge a job loss. Connect your accounts and documents so we can show your actual runway instead of this example.",
  retirement: "This is a sample scenario, not based on your data yet. Retirement readiness usually comes down to pension progress, employer match, and monthly contributions. Connect your pension and investment accounts so we can show your actual progress instead of this example.",
}

// Checklist completion has no backend endpoint — persist client-side so
// "your family's response plan" doesn't forget your progress on reload.
// Scoped by tenant so a shared device doesn't leak one user's checklist
// state into another's, and by event so action ids (which repeat across
// events, e.g. '1'-'5') don't bleed into each other.
function checklistStorageKey(eventId: string): string {
  const tenant = typeof window !== 'undefined' ? localStorage.getItem('agentoak_tenant') ?? 'anon' : 'anon'
  return `agentoak:event-checklist:${tenant}:${eventId}`
}

function loadDoneIds(eventId: string): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(checklistStorageKey(eventId))
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function saveDoneIds(eventId: string, doneIds: Set<string>): void {
  try {
    localStorage.setItem(checklistStorageKey(eventId), JSON.stringify([...doneIds]))
  } catch {
    // Best-effort — private browsing / storage-full shouldn't break the checklist.
  }
}

// OAK-014: the checklist used to be 100% generic strings even when the
// family had already told Oak who their real provider is — this swaps in
// that real name wherever a matching policy exists, leaving the generic
// text alone otherwise.
export function personalizeAction(action: Action, policies: FinancialProfilePolicy[]): string {
  if (!action.policyTypes || !action.personalize) return action.label
  const match = policies.find((p) => action.policyTypes!.includes(p.type))
  return match ? action.personalize(match.provider) : action.label
}

// PRD-115: minor-units → display string, £ locale fixed to match the app's
// actual currency (see Money's comment in Glass.tsx on why $-only broke).
function formatMinor(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString('en-GB')}`
}

// The job-loss tile's "what if it happened in N months" choices. A job
// transition being *anticipated* is exactly the case the horizon exists
// for — runway measured from the balance the household will actually have
// then, not today's.
const SCENARIO_HORIZON_OPTIONS = [0, 3, 6, 12] as const

export default function EventDetailClient() {
  const params = useParams<{ eventId: string }>()
  const event = LIFE_EVENTS.find((e) => e.id === params.eventId)
  const [actions, setActions] = useState<Action[]>(
    EVENT_ACTIONS[event?.id ?? 'default'] ?? EVENT_ACTIONS.default!
  )
  const [policies, setPolicies] = useState<FinancialProfilePolicy[]>([])

  // Apply persisted completion after mount (not in useState's initializer)
  // so server-rendered and first-client-render output match — avoids a
  // hydration mismatch, at the cost of a brief unchecked-then-checked flash.
  useEffect(() => {
    const done = loadDoneIds(params.eventId)
    if (done.size === 0) return
    setActions((prev) => prev.map((a) => ({ ...a, done: done.has(a.id) })))
  }, [params.eventId])

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((profile) => {
      if (cancelled) return
      setPolicies(profile?.policies ?? [])
      // PRD-115: household income mirrors the server's scenario input
      // mapping (scenarios/profile-input.ts) so the preview's "income
      // drops to zero" delta matches what the backend would compute.
      const income = profile
        ? profile.household.monthly_salary_minor +
          (profile.household.members ?? []).reduce((s, m) => s + m.monthly_salary_minor, 0)
        : 0
      setProfileIncomeMinor(income > 0 ? income : null)
    })
    return () => { cancelled = true }
  }, [])

  // PRD-115: the job-loss tile gets a time-shifted projection — "if our
  // income stopped in N months, how long would savings last?" Other event
  // ids keep their static/detector-backed readiness; only job-loss has a
  // defensible runway formula to time-shift.
  const [profileIncomeMinor, setProfileIncomeMinor] = useState<number | null>(null)
  const [scenarioHorizon, setScenarioHorizon] = useState<number>(6)
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [scenarioLoading, setScenarioLoading] = useState(false)
  const [savedScenarios, setSavedScenarios] = useState<FamilyScenario[]>([])
  const [scenarioJustSaved, setScenarioJustSaved] = useState(false)

  const isJobLoss = event?.id === 'job-loss'

  useEffect(() => {
    if (!isJobLoss || !profileIncomeMinor) return
    let cancelled = false
    setScenarioLoading(true)
    setScenarioJustSaved(false)
    previewScenario({ monthlyIncomeDeltaMinor: -profileIncomeMinor, monthsUntilChange: scenarioHorizon })
      .then((r) => {
        if (cancelled) return
        setScenarioResult(r?.result ?? null)
        setScenarioLoading(false)
      })
    return () => { cancelled = true }
  }, [isJobLoss, profileIncomeMinor, scenarioHorizon])

  useEffect(() => {
    if (!isJobLoss) return
    let cancelled = false
    fetchFamilyScenarios().then((s) => { if (!cancelled) setSavedScenarios(s) })
    return () => { cancelled = true }
  }, [isJobLoss])

  const scenarioName = scenarioHorizon === 0 ? 'Job loss starting now' : `Job loss in ${scenarioHorizon} months`

  const handleSaveScenario = async () => {
    if (!profileIncomeMinor) return
    haptic('light')
    const saved = await saveFamilyScenario(scenarioName, {
      monthlyIncomeDeltaMinor: -profileIncomeMinor,
      monthsUntilChange: scenarioHorizon,
    })
    if (saved) {
      setSavedScenarios((prev) => [saved, ...prev])
      setScenarioJustSaved(true)
      haptic('success')
    }
  }

  const handleDeleteScenario = async (id: string) => {
    haptic('light')
    if (await deleteFamilyScenario(id)) {
      setSavedScenarios((prev) => prev.filter((s) => s.id !== id))
    }
  }

  const toggleAction = (id: string) => {
    haptic('light')
    setActions((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, done: !a.done } : a))
      saveDoneIds(params.eventId, new Set(next.filter((a) => a.done).map((a) => a.id)))
      return next
    })
  }

  const fallbackStability = event ? (EVENT_STABILITY[event.id] ?? 80) : 80
  const fallbackExplanation = event
    ? (EVENT_AI_EXPLANATION[event.id] ?? "This is a sample scenario, not based on your data yet. Connect your accounts and documents to see a personalized readiness assessment for this situation.")
    : 'This event could not be found.'
  const { stability, explanation, hasLiveData, insightId, ruleId } = useEventReadiness(params.eventId, fallbackStability, fallbackExplanation)

  // Tier 1 "prepare, don't send" (PRD-103) — draftText is editable once
  // generated; the only exits are copy-to-clipboard and a mailto: link,
  // never a send call from this app.
  const [drafting, setDrafting] = useState(false)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // "Draft this for me" is replaced entirely by a <textarea> once the draft
  // arrives — same silent-transition shape as every other "button swapped
  // for new content" case fixed this session: the button the user just
  // clicked unmounts along with everything around it, so without this,
  // focus would fall to <body>. Moving it to the new textarea both restores
  // a sane focus position and puts the cursor right where editing happens.
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (draftText) draftTextareaRef.current?.focus()
  }, [draftText])

  const handleDraft = async () => {
    if (!insightId) return
    haptic('light')
    setDrafting(true)
    setDraftError(null)
    const draft = await prepareInsightDraft(insightId)
    setDraftText(draft?.content ?? null)
    if (!draft) setDraftError("Oak couldn't write that draft just now — nothing was lost, try again in a moment.")
    setDrafting(false)
  }

  const handleCopy = async () => {
    if (!draftText) return
    try {
      await navigator.clipboard.writeText(draftText)
      haptic('success')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // mailto: fallback below still works, so this is non-fatal.
    }
  }

  if (!event) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Event not found</p>
        <Link href="/events" className="text-family-400 font-semibold mt-4 inline-block flex items-center gap-1 justify-center">
          <ArrowLeft size={14} /> Back to events
        </Link>
      </div>
    )
  }

  const completedCount = actions.filter((a) => a.done).length

  return (
    <PageTransition>
    <div className="px-5 pt-2 space-y-5">
      <PageHeader
        title={event.label}
        backHref="/events"
        subtitle="Here's your family's response plan"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-ink-secondary">Family Readiness</span>
            <span className="text-2xl font-bold" style={{ color: stability >= 80 ? '#4ade80' : '#fbbf24' }}>
              {stability}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-tint/5 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                backgroundColor: stability >= 80 ? '#4ade80' : '#fbbf24',
                boxShadow: `0 0 12px ${stability >= 80 ? '#4ade80' : '#fbbf24'}80`,
              }}
              initial={{ width: 0 }}
              animate={{ width: `${stability}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
          <p className="text-xs text-ink-tertiary mt-2">
            {stability >= 80
              ? "Your family would remain financially stable in this situation."
              : "Your family would be okay, but there are some gaps to address."}
          </p>
          {hasLiveData ? (
            <div className="flex items-center gap-1.5 text-xs text-success mt-2">
              <CheckCircle2 size={12} />
              <span>Based on your family's data</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-warning mt-2">
              <AlertTriangle size={12} />
              <span>Sample scenario — connect your data for a real one</span>
            </div>
          )}
        </GlassCard>
      </motion.div>

      {/* PRD-115: time-shifted "what if income stopped in N months" —
          only on the job-loss tile, only with a real income on file. */}
      {isJobLoss && profileIncomeMinor && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <GlassCard className="p-5">
            <span className="text-sm font-semibold text-ink-secondary">If it happened later</span>
            <div className="flex gap-2 mt-3">
              {SCENARIO_HORIZON_OPTIONS.map((months) => (
                <button
                  key={months}
                  onClick={() => { haptic('light'); setScenarioHorizon(months) }}
                  aria-pressed={scenarioHorizon === months}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    scenarioHorizon === months
                      ? 'bg-family-500/20 text-family-400 border border-family-500/40'
                      : 'bg-tint/5 text-ink-tertiary border border-tint/10'
                  }`}
                >
                  {months === 0 ? 'Now' : `${months} mo`}
                </button>
              ))}
            </div>
            <div className="mt-3 min-h-[3rem]">
              {scenarioLoading ? (
                <Loader2 size={16} className="animate-spin text-ink-tertiary mt-2" />
              ) : scenarioResult ? (
                <p className="text-sm text-ink-secondary leading-relaxed">
                  {scenarioHorizon > 0 && (
                    <>If your household income stopped in {scenarioHorizon} months, savings would
                    reach about {formatMinor(scenarioResult.savingsAtChangeMinor)} by then — </>
                  )}
                  {scenarioResult.projectedRunwayMonths === null
                    ? scenarioHorizon > 0
                      ? 'and your reduced income would still cover expenses.'
                      : 'Your income currently covers expenses.'
                    : scenarioHorizon > 0
                      ? `covering about ${scenarioResult.projectedRunwayMonths} months of spending after that.`
                      : `If income stopped now, savings would cover about ${scenarioResult.projectedRunwayMonths} months of spending.`}
                </p>
              ) : (
                <p className="text-sm text-ink-tertiary">Couldn’t project this right now — try again in a moment.</p>
              )}
            </div>
            {scenarioResult && !scenarioJustSaved && (
              <GlassButton variant="secondary" onClick={handleSaveScenario}>
                <span>Save this scenario</span>
              </GlassButton>
            )}
            {scenarioJustSaved && (
              <p className="text-xs text-success mt-2 flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Saved — it stays updated as your numbers change
              </p>
            )}
            {savedScenarios.length > 0 && (
              <div className="mt-4 pt-3 border-t border-tint/10 space-y-1.5">
                <span className="text-xs font-semibold text-ink-tertiary">Saved scenarios</span>
                {savedScenarios.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink-secondary truncate">{s.name}</span>
                    <span className="text-xs text-ink-tertiary whitespace-nowrap">
                      {s.result?.projectedRunwayMonths != null
                        ? `${s.result.projectedRunwayMonths} mo runway`
                        : '—'}
                    </span>
                    <button
                      onClick={() => handleDeleteScenario(s.id)}
                      aria-label={`Delete ${s.name}`}
                      className="text-xs text-ink-tertiary hover:text-danger transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-ink-secondary">Actions to Take</span>
          <span className="text-xs text-ink-tertiary">{completedCount}/{actions.length} done</span>
        </div>
        <div className="space-y-2">
          {actions.map((action, i) => (
            <motion.button
              key={action.id}
              onClick={() => toggleAction(action.id)}
              aria-pressed={action.done}
              whileTap={{ scale: 0.97 }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.06 }}
              className="w-full glass rounded-2xl p-4 flex items-center gap-3"
            >
              <motion.div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                animate={{
                  backgroundColor: action.done ? '#4ade80' : 'rgb(var(--tint) / 0.05)',
                  borderColor: action.done ? '#4ade80' : 'rgb(var(--tint) / 0.1)',
                }}
                style={{ border: '2px solid' }}
              >
                {action.done && <Check size={14} color="#08080c" />}
              </motion.div>
              <span className={`text-sm text-left flex-1 ${action.done ? 'text-ink-tertiary line-through' : 'text-ink-primary'}`}>
                {personalizeAction(action, policies)}
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <GlassCard className="p-5 border-family-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Bot size={18} className="text-family-400" />
            <span className="text-sm font-semibold text-family-400">AI Explains</span>
          </div>
          <p className="text-sm text-ink-secondary leading-relaxed">{explanation}</p>
          {learnMoreHref(ruleId) && (
            <Link href={learnMoreHref(ruleId)!} className="text-xs text-family-400 font-semibold mt-2 inline-block">
              Learn more →
            </Link>
          )}
        </GlassCard>
      </motion.div>

      {hasLiveData && insightId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <GlassCard className="p-5 border-family-500/20">
            <div className="flex items-center gap-2 mb-2">
              <PenLine size={18} className="text-family-400" />
              <span className="text-sm font-semibold text-family-400">Draft a message</span>
            </div>
            {!draftText ? (
              <>
                <p className="text-sm text-ink-tertiary leading-relaxed mb-3">
                  Oak can draft an email based on this — you review and send it yourself. Oak never sends anything on your behalf.
                </p>
                <GlassButton variant="secondary" onClick={handleDraft} disabled={drafting}>
                  {drafting ? <Loader2 size={18} className="animate-spin" /> : <PenLine size={18} />}
                  <span>{drafting ? 'Drafting…' : 'Draft this for me'}</span>
                </GlassButton>
                {draftError && (
                  <p role="status" aria-live="polite" className="text-sm text-ink-tertiary leading-relaxed mt-3">{draftError}</p>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <textarea
                  ref={draftTextareaRef}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={6}
                  className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
                />
                <p className="text-xs text-ink-tertiary">
                  This is a draft only — copy it or open it in your own email client. Oak never sends it for you.
                </p>
                <div className="flex gap-2">
                  <GlassButton variant="secondary" onClick={handleCopy}>
                    <Copy size={16} />
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </GlassButton>
                  <a
                    href={`mailto:?body=${encodeURIComponent(draftText)}`}
                    onClick={() => haptic('light')}
                    className="flex-1"
                  >
                    <GlassButton variant="secondary">
                      <Mail size={16} />
                      <span>Open in email</span>
                    </GlassButton>
                  </a>
                </div>
              </div>
            )}
          </GlassCard>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Link href="/assistant" onClick={() => haptic('light')} className="block">
          <GlassButton variant="secondary">
            <Bot size={18} />
            <span>Ask AI About This</span>
          </GlassButton>
        </Link>
      </motion.div>
    </div>
    </PageTransition>
  )
}
