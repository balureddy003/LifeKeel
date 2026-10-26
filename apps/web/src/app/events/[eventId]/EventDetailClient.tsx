'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useRouteParam } from '@/lib/useRouteParam'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  HelpCircle,
  Loader2,
  Mail,
  PenLine,
  Siren,
} from 'lucide-react'
import { LIFE_EVENTS } from '@/lib/life-data'
import { CRISIS_EVENT_KEY } from '@/components/CrisisMode'
import { GlassCard, GlassButton, PageHeader, PageTransition } from '@/components/Glass'
import { DraftProvenanceNote } from '@/components/DraftProvenance'
import { haptic } from '@/lib/haptics'
import { useEventReadiness } from '@/lib/useFamilyData'
import { useAuth } from '@/lib/auth-context'
import {
  prepareInsightDraft,
  fetchFinancialProfile,
  fetchLifeEvents,
  type FinancialProfilePolicy,
} from '@/lib/api'
import { learnMoreHref } from '@/lib/detector-content'
import EventScenarioCard, { eventHasScenario } from './ScenarioCard'
import RetirementEstimate from './RetirementEstimate'
import {
  EVENT_ACTIONS,
  loadDoneIds,
  saveDoneIds,
  personalizeAction,
  type Action,
} from '@/lib/event-actions'
export type { Action } from '@/lib/event-actions'
export { EVENT_ACTIONS, loadDoneIds, personalizeAction }

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

// Intent 65 — the sample-narration path is deleted. Where the readiness
// endpoint has no live data, the page says so and names what to add
// (missing_inputs via the partial banner) instead of narrating a
// scenario that was never computed. A wrong number is structurally
// impossible when there's nothing on screen to put one in.
const SAMPLE_NARRATIVE =
  "Keel can't compute this scenario yet — none of your data feeds it. " +
  'Connect your accounts or add the inputs the banner names, and this ' +
  'becomes a real projection instead of a placeholder.'
const PARTIAL_NARRATIVE =
  'Using the data you have so far — this is a partial picture, with the ' +
  'missing inputs named above.'

export default function EventDetailClient() {
  const eventId = useRouteParam('/events')
  const event = eventId ? LIFE_EVENTS.find((e) => e.id === eventId) : undefined
  const router = useRouter()

  // Server-reported life events carry a UUID, not a catalog id — a link to
  // /events/<uuid> lands here on a miss. That event has its own playbook
  // page at /life-events/<uuid>; resolve and route rather than claiming
  // the event doesn't exist (intent 52).
  useEffect(() => {
    if (!eventId || event) return
    let live = true
    fetchLifeEvents().then((evts) => {
      if (live && evts.some((e) => e.id === eventId)) {
        router.replace(`/life-events/${eventId}`)
      }
    })
    return () => {
      live = false
    }
  }, [eventId, event, router])
  const [actions, setActions] = useState<Action[]>(
    EVENT_ACTIONS[event?.id ?? 'default'] ?? EVENT_ACTIONS.default!,
  )
  const [policies, setPolicies] = useState<FinancialProfilePolicy[]>([])

  // Apply persisted completion after mount (not in useState's initializer)
  // so server-rendered and first-client-render output match — avoids a
  // hydration mismatch, at the cost of a brief unchecked-then-checked flash.
  useEffect(() => {
    if (!eventId) return
    const done = loadDoneIds(eventId)
    if (done.size === 0) return
    setActions((prev) => prev.map((a) => ({ ...a, done: done.has(a.id) })))
  }, [eventId])

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((profile) => {
      if (cancelled) return
      setPolicies(profile?.policies ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleAction = (id: string) => {
    haptic('light')
    setActions((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, done: !a.done } : a))
      if (eventId) {
        saveDoneIds(eventId, new Set(next.filter((a) => a.done).map((a) => a.id)))
      }
      return next
    })
  }

  const fallbackStability = event ? (EVENT_STABILITY[event.id] ?? 80) : 80
  const fallbackExplanation = event ? SAMPLE_NARRATIVE : 'This event could not be found.'
  const { stability, explanation, live, missingInputs, insightId, ruleId } = useEventReadiness(
    eventId ?? '',
    fallbackStability,
    fallbackExplanation,
  )

  // "Partial", not "sample" (intent 53): when the readiness endpoint named
  // missing inputs, the banner already says "using the data you have so
  // far" — the explanation body must not call the same numbers a sample.
  const displayExplanation =
    !live && missingInputs.length > 0 && explanation === fallbackExplanation
      ? PARTIAL_NARRATIVE
      : explanation

  // Tier 1 "prepare, don't send" (PRD-103) — draftText is editable once
  // generated; the only exits are copy-to-clipboard and a mailto: link,
  // never a send call from this app.
  const [drafting, setDrafting] = useState(false)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [draftFacts, setDraftFacts] = useState<string[] | undefined>(undefined)
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
    setDraftFacts(draft?.provenance?.facts)
    if (!draft)
      setDraftError(
        "Keel couldn't write that draft just now — nothing was lost, try again in a moment.",
      )
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

  // eventId stays undefined until the real URL segment is resolved
  // post-mount (static export — see useRouteParam); show a shimmer rather
  // than a false "Event not found" for that first render.
  if (eventId === undefined) {
    return (
      <div className="px-5 pt-8 space-y-3">
        <div className="shimmer h-24 rounded-2xl" />
        <div className="shimmer h-24 rounded-2xl" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Event not found</p>
        <Link
          href="/events"
          className="text-family-400 font-semibold mt-4 inline-block flex items-center gap-1 justify-center"
        >
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
              <span className="text-sm font-semibold text-ink-secondary">
                Readiness for this event
              </span>
              {stability !== null && (
                <span
                  className="text-2xl font-bold"
                  style={{ color: stability >= 80 ? '#4ade80' : '#fbbf24' }}
                >
                  {stability}%
                </span>
              )}
            </div>
            {stability !== null && (
              <>
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
                    ? 'On the numbers on file, this looks well covered.'
                    : 'On the numbers on file, there are gaps to address.'}
                </p>
              </>
            )}
            {live ? (
              <div className="flex items-center gap-1.5 text-xs text-success mt-2">
                <CheckCircle2 size={12} />
                <span>Based on your family's data</span>
              </div>
            ) : missingInputs.length > 0 ? (
              <div className="flex items-start gap-1.5 text-xs text-warning mt-2">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>
                  Using the data you have so far — add {missingInputs.join(', ')} for a real number.
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-warning mt-2">
                <AlertTriangle size={12} />
                <span>Sample scenario — connect your data for a real one</span>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* PRD-115/132: the "what if" card — job-loss plus every event with
          a defensible template (bereavement, disability, medical,
          new-child, university); renders nothing when the profile lacks
          the inputs the template needs. */}
        {eventHasScenario(event.id) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <EventScenarioCard eventId={event.id} />
          </motion.div>
        )}

        {/* Intent 32: the retirement surface's interactive estimate —
            contribution slider re-projects via the server math; writes
            nothing and is labelled an estimate, not a recommendation. */}
        {event.id === 'retirement' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <RetirementEstimate />
          </motion.div>
        )}

        {/* Intent 33: opt-in to the reduced dashboard — Home then shows only
            these steps, the fund figure and the vault until they exit. */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
        >
          <Link
            href="/"
            onClick={() => localStorage.setItem(CRISIS_EVENT_KEY, event.id)}
            className="flex items-center justify-center gap-2 w-full rounded-xl border border-family-500/30 bg-family-500/10 text-family-500 text-sm font-semibold min-h-[44px] mb-4"
          >
            <Siren size={15} /> Crisis mode — reduce Home to just these steps
          </Link>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-ink-secondary">Actions to Take</span>
            <span className="text-xs text-ink-tertiary">
              {completedCount}/{actions.length} done
            </span>
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
                  {action.done && <Check size={14} color="rgb(var(--on-cta))" />}
                </motion.div>
                <span
                  className={`text-sm text-left flex-1 ${action.done ? 'text-ink-tertiary line-through' : 'text-ink-primary'}`}
                >
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
            <p className="text-sm text-ink-secondary leading-relaxed">{displayExplanation}</p>
            {learnMoreHref(ruleId) && (
              <Link
                href={learnMoreHref(ruleId)!}
                className="text-xs text-family-400 font-semibold mt-2 inline-block"
              >
                Learn more →
              </Link>
            )}
          </GlassCard>
        </motion.div>

        {insightId && (
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
                    Keel can draft an email based on this — you review and send it yourself. Keel
                    never sends anything on your behalf.
                  </p>
                  <GlassButton variant="secondary" onClick={handleDraft} disabled={drafting}>
                    {drafting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <PenLine size={18} />
                    )}
                    <span>{drafting ? 'Drafting…' : 'Draft this for me'}</span>
                  </GlassButton>
                  {draftError && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="text-sm text-ink-tertiary leading-relaxed mt-3"
                    >
                      {draftError}
                    </p>
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
                    This is a draft only — copy it or open it in your own email client. Keel never
                    sends it for you.
                  </p>
                  <DraftProvenanceNote facts={draftFacts} />
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
          {/* Workstream A bonus: used to link to a blank chat with no idea
            what the user was just looking at. Now hands Keel the specific
            scenario by name so its first answer is grounded in this event
            instead of starting from zero — Keel still computes the actual
            numbers itself from the live profile, this just points it at
            the right question. */}
          <Link
            href={`/assistant?context=/events&prompt=${encodeURIComponent(
              `What would happen to my family financially if "${event.label}" happened, and what should we prepare?`,
            )}`}
            onClick={() => haptic('light')}
            className="block"
          >
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
