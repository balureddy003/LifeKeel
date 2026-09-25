'use client'

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, HelpCircle, Loader2, Mail, PenLine, Printer } from 'lucide-react'
import { GlassCard, GlassButton, PageHeader, PageTransition } from '@/components/Glass'
import { LifeSafetyNotice } from '@/components/LifeSafetyNotice'
import { haptic } from '@/lib/haptics'
import { fetchLifeEvents, prepareLifeEventStepDraft, setLifeEventStepDone, pingOnDeviceDraftUsed, type LifeEvent, type LifeEventPlaybookStep, type LifeEventType } from '@/lib/api'
import { isOnDeviceEnabled, isOnDeviceSupported, generateDraftOnDevice } from '@/lib/onDeviceLlm'

// Same reasoning as /life-events's own notice: a user can land here directly
// (a shared link, a return visit) without ever seeing Emergency Mode's
// banner, and for these four types everything on this screen is insurance/
// financial admin, not first response.
const URGENT_TYPES = new Set<LifeEventType>(['medical', 'car', 'property', 'travel'])

// Checklist completion is now server-persisted (remediation item 19) —
// localStorage remains only as an instant-paint cache while the server
// state loads, and as a last-seen snapshot if the request fails. The
// server is authoritative; nothing here decides truth.
function checklistStorageKey(eventId: string): string {
  const tenant = typeof window !== 'undefined' ? localStorage.getItem('agentoak_tenant') ?? 'anon' : 'anon'
  return `agentoak:life-event-checklist:${tenant}:${eventId}`
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

// Tier 1 "prepare, don't send" (PRD-103), reused per-step — a playbook can
// have several contact-eligible steps at once (unlike a single insight
// card), so each step owns its own draft state rather than sharing one.
function StepDraft({ eventId, step }: { eventId: string; step: LifeEventPlaybookStep }) {
  const [drafting, setDrafting] = useState(false)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Same silent-transition shape as /events/[eventId]'s equivalent draft
  // flow — the button that was just clicked is replaced entirely by a
  // <textarea>, so without moving focus it would fall to <body>.
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (draftText) draftTextareaRef.current?.focus()
  }, [draftText])

  const handleDraft = async () => {
    haptic('light')
    setDrafting(true)
    setDraftError(null)

    // PRD-113: on-device first when the family has opted in and the
    // browser actually supports it — any failure here (model not
    // loaded, generation error) falls through to the existing cloud
    // path transparently, never surfacing a raw error for this branch.
    if (isOnDeviceEnabled() && isOnDeviceSupported()) {
      const onDeviceDraft = await generateDraftOnDevice(step.body)
      if (onDeviceDraft) {
        setDraftText(onDeviceDraft)
        setDrafting(false)
        pingOnDeviceDraftUsed(eventId, step.id)
        return
      }
    }

    const draft = await prepareLifeEventStepDraft(eventId, step.id)
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
      // Clipboard access can fail — the mailto: fallback below still works.
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-tint/5">
      {!draftText ? (
        <>
          <GlassButton variant="secondary" onClick={handleDraft} disabled={drafting}>
            {drafting ? <Loader2 size={16} className="animate-spin" /> : <PenLine size={16} />}
            <span>{drafting ? 'Drafting…' : 'Draft a message for me'}</span>
          </GlassButton>
          {draftError && <p role="status" aria-live="polite" className="text-xs text-ink-tertiary mt-2">{draftError}</p>}
        </>
      ) : (
        <div className="space-y-2">
          <textarea
            ref={draftTextareaRef}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            rows={5}
            className="glass-input w-full rounded-xl px-3 py-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 focus:border-family-500/30 transition-all"
          />
          <p className="text-xs text-ink-tertiary">
            This is a draft only — copy it or open it in your own email client. Oak never sends it for you.
          </p>
          <div className="flex gap-2">
            <GlassButton variant="secondary" onClick={handleCopy}>
              <Copy size={14} />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </GlassButton>
            <a href={`mailto:?body=${encodeURIComponent(draftText)}`} onClick={() => haptic('light')} className="flex-1">
              <GlassButton variant="secondary">
                <Mail size={14} />
                <span>Open in email</span>
              </GlassButton>
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

export default function LifeEventPlaybookClient() {
  const params = useParams<{ eventId: string }>()
  const [event, setEvent] = useState<LifeEvent | null | undefined>(undefined)
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set())
  const [syncError, setSyncError] = useState(false)
  const [queuedOffline, setQueuedOffline] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchLifeEvents().then((events) => {
      if (cancelled) return
      const found = events.find((e) => e.id === params.eventId) ?? null
      setEvent(found)
      if (found) {
        // Server is authoritative — overrides the localStorage snapshot
        // used for instant paint below.
        const serverIds = new Set(found.completed_step_ids ?? [])
        setDoneIds(serverIds)
        saveDoneIds(params.eventId, serverIds)
      }
    })
    return () => { cancelled = true }
  }, [params.eventId])

  useEffect(() => {
    setDoneIds(loadDoneIds(params.eventId))
  }, [params.eventId])

  const toggleStep = (stepId: string) => {
    haptic('light')
    const next = new Set(doneIds)
    const done = !next.has(stepId)
    if (done) next.add(stepId)
    else next.delete(stepId)
    setDoneIds(next)
    saveDoneIds(params.eventId, next)
    setSyncError(false)
    setLifeEventStepDone(params.eventId, stepId, done).then((serverIds) => {
      if (serverIds === 'queued') {
        // Offline — the toggle stays and the mutation replays on reconnect.
        // Marked as pending rather than an error: nothing failed.
        setSyncError(false)
        setQueuedOffline(true)
      } else if (serverIds === null) {
        // Revert to the pre-toggle state — the optimistic change didn't land.
        setDoneIds((current) => {
          const reverted = new Set(current)
          if (done) reverted.delete(stepId)
          else reverted.add(stepId)
          return reverted
        })
        setSyncError(true)
      } else {
        setDoneIds(new Set(serverIds))
        setQueuedOffline(false)
      }
    })
  }

  if (event === undefined) {
    return (
      <div className="px-5 pt-8 space-y-3">
        <div className="shimmer h-24 rounded-2xl" />
        <div className="shimmer h-24 rounded-2xl" />
      </div>
    )
  }

  if (!event || !event.playbook) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">This life event couldn't be found</p>
        <Link href="/life-events" className="text-family-400 font-semibold mt-4 inline-block flex items-center gap-1 justify-center">
          <ArrowLeft size={14} /> Back
        </Link>
      </div>
    )
  }

  const { playbook } = event
  const completedCount = playbook.steps.filter((s) => doneIds.has(s.id)).length

  return (
    <PageTransition>
    <div className="px-5 pt-2 space-y-5">
      <PageHeader
        title={playbook.title}
        backHref="/life-events"
        subtitle="Based on your family's real data"
      />

      {URGENT_TYPES.has(event.event_type) && <LifeSafetyNotice compact />}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-5 border-family-500/20">
          <p className="text-sm text-ink-secondary leading-relaxed">{playbook.intro}</p>
        </GlassCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-ink-secondary">Steps</span>
          <span className="flex items-center gap-3">
            <button
              onClick={() => { haptic('light'); window.print() }}
              className="text-xs font-semibold text-family-400 flex items-center gap-1 print:hidden"
              aria-label="Print this plan"
            >
              <Printer size={12} /> Print
            </button>
            <span className="text-xs text-ink-tertiary">{completedCount}/{playbook.steps.length} done</span>
          </span>
        </div>
        {syncError && (
          <p role="status" aria-live="polite" className="text-xs text-danger mb-3">
            That change didn't save — the step is back how it was. Check your connection and try again.
          </p>
        )}
        {queuedOffline && !syncError && (
          <p role="status" aria-live="polite" className="text-xs text-ink-tertiary mb-3">
            You're offline — your checkmarks are saved here and will sync when you're back online.
          </p>
        )}
        <div className="space-y-2">
          {playbook.steps.map((step, i) => {
            const done = doneIds.has(step.id)
            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.06 }}
                className="glass rounded-2xl p-4"
              >
                <button onClick={() => toggleStep(step.id)} aria-pressed={done} className="w-full flex items-start gap-3 text-left">
                  <motion.div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    animate={{
                      backgroundColor: done ? '#4ade80' : 'rgb(var(--tint) / 0.05)',
                      borderColor: done ? '#4ade80' : 'rgb(var(--tint) / 0.1)',
                    }}
                    style={{ border: '2px solid' }}
                  >
                    {done && <Check size={14} color="#08080c" />}
                  </motion.div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${done ? 'text-ink-tertiary line-through' : 'text-ink-primary'}`}>
                      {step.title}
                    </div>
                    <p className="text-sm text-ink-secondary leading-relaxed mt-1">{step.body}</p>
                  </div>
                </button>
                {step.contact && <StepDraft eventId={event.id} step={step} />}
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </div>
    </PageTransition>
  )
}
