'use client'

/**
 * The Act-layer approval gate (remediation item 25).
 *
 * POST /insights/:id/approve executes an insight's recommended actions —
 * some of which (send_email / send_whatsapp / crm_tag) dispatch to real
 * external providers. This screen exists so that call is never implicit:
 * it renders the server's own action-preview (the same classification the
 * executor dispatches on) and only makes "Approve & run" available after
 * the human has seen, per action, what will actually happen — including
 * which actions send something real versus which are just recorded.
 *
 * "Prepare a draft" (Tier 1) and "Dismiss" are offered alongside as the
 * lower-tier alternatives — approve is a choice, not the only exit.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  HelpCircle,
  Loader2,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Tag,
  XCircle,
} from 'lucide-react'
import { GlassButton, GlassCard, PageHeader, PageTransition } from '@/components/Glass'
import { DraftProvenanceNote } from '@/components/DraftProvenance'
import { useAppStore } from '@/lib/store'
import { haptic } from '@/lib/haptics'
import {
  approveInsight,
  dismissInsight,
  fetchInsightActionPreview,
  prepareInsightDraft,
  retryInsightExecution,
  RESOLVED_INSIGHT_STATES,
  type FamilyInsight,
  type InsightActionPreview,
  type InsightActionPreviewItem,
} from '@/lib/api'

const ACTION_TYPE_ICON: Record<InsightActionPreviewItem['type'], typeof Mail> = {
  send_email: Mail,
  send_whatsapp: MessageSquareText,
  crm_tag: Tag,
  log_only: CheckCircle2,
}

function readableHypothesis(h: string): string {
  // Same convention as the health domain cards: hypotheses arrive as
  // snake_case rule text.
  const spaced = h.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Plain-English answer to "where did this come from" per detector — the
// trust primitive the audit trail already proves internally, surfaced in
// the family's language at the exact moment they're deciding.
const DETECTOR_DATA_SOURCES: Record<string, string> = {
  family_protection_gap: "your household income, who's in the family, and the life and income-protection cover on file",
  family_education_shortfall: "each child's education fund balance and target",
  family_emergency_fund_adequacy: 'your emergency savings compared to monthly living expenses',
  family_retirement_gap: 'your pension balance, monthly contributions, and retirement target',
}

function WhyThisInsight({ insight }: { insight: FamilyInsight }) {
  const [open, setOpen] = useState(false)
  const source = DETECTOR_DATA_SOURCES[insight.detector_id]
  return (
    <GlassCard className="p-4">
      <button
        onClick={() => { haptic('light'); setOpen(!open) }}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-sm font-semibold text-family-400 flex items-center gap-1.5">
          <HelpCircle size={14} /> Why is Keel suggesting this?
        </span>
        <ChevronDown size={14} className={`text-ink-tertiary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
          <div className="pt-3 space-y-2.5">
            {source && (
              <div>
                <div className="text-xs font-semibold text-ink-tertiary mb-0.5">What it looked at</div>
                <p className="text-sm text-ink-secondary leading-relaxed">This check ran against {source}.</p>
              </div>
            )}
            <div>
              <div className="text-xs font-semibold text-ink-tertiary mb-0.5">When it ran</div>
              <p className="text-sm text-ink-secondary leading-relaxed">
                {new Date(insight.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} — Keel re-checks automatically whenever your profile changes.
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold text-ink-tertiary mb-0.5">What Keel gets from this</div>
              <p className="text-sm text-ink-secondary leading-relaxed">
                Nothing — Keel earns no commission from any insurer or provider. This is information
                from your own data, not a recommendation to buy anything. A licensed professional
                can help you decide what to do with it.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </GlassCard>
  )
}

export default function InsightGateClient() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [preview, setPreview] = useState<InsightActionPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [note, setNote] = useState('')
  const [acting, setActing] = useState<'approve' | 'dismiss' | 'draft' | 'retry' | null>(null)
  const [outcome, setOutcome] = useState<{ kind: 'completed' | 'execution_failed' | 'dismissed'; message: string } | null>(null)
  const [draftText, setDraftText] = useState<string | null>(null)
  const [draftFacts, setDraftFacts] = useState<string[] | undefined>(undefined)
  const [draftError, setDraftError] = useState<string | null>(null)
  const noteDetectorDismissal = useAppStore((s) => s.noteDetectorDismissal)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchInsightActionPreview(params.id).then((p) => {
      if (cancelled) return
      setPreview(p)
      if (!p) setError("We couldn't load this insight — it may have already been actioned.")
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [params.id])

  const alreadyResolved = preview !== null && RESOLVED_INSIGHT_STATES.includes(preview.insight.state)
  const hasExternalActions = preview?.actions.some((a) => a.external) ?? false

  const handleApprove = async () => {
    setActing('approve')
    setError(null)
    const result = await approveInsight(params.id, note || undefined)
    setActing(null)
    if (!result.ok) {
      setError(result.error ?? "That approval didn't go through — nothing changed on our end. Try again when you're ready.")
      return
    }
    haptic('success')
    if (result.state === 'execution_failed') {
      setOutcome({ kind: 'execution_failed', message: result.message ?? 'Approved, but one or more actions failed to execute.' })
    } else {
      setOutcome({ kind: 'completed', message: result.message ?? 'Insight approved.' })
    }
  }

  const handleRetry = async () => {
    setActing('retry')
    const result = await retryInsightExecution(params.id)
    setActing(null)
    if (!result.ok) {
      setError(result.error ?? "The retry didn't work — your insight is still here. Try again in a moment.")
      return
    }
    haptic('success')
    setOutcome(
      result.state === 'execution_failed'
        ? { kind: 'execution_failed', message: result.message ?? 'One or more actions are still failing.' }
        : { kind: 'completed', message: result.message ?? 'All actions completed.' },
    )
  }

  const handleDismiss = async () => {
    setActing('dismiss')
    setError(null)
    const ok = await dismissInsight(params.id, note || undefined)
    setActing(null)
    if (!ok) {
      setError("That didn't dismiss — it's still here if you want to look again later.")
      return
    }
    haptic('light')
    // Learn the dismissal: if this detector's insights keep getting
    // dismissed, Home stops featuring that kind of insight as the hero.
    if (preview) noteDetectorDismissal(preview.insight.detector_id)
    setOutcome({ kind: 'dismissed', message: 'Insight dismissed.' })
  }

  const handleDraft = async () => {
    setActing('draft')
    setDraftError(null)
    const draft = await prepareInsightDraft(params.id)
    setActing(null)
    setDraftText(draft?.content ?? null)
    setDraftFacts(draft?.provenance?.facts)
    if (!draft) setDraftError("Keel couldn't write that draft just now — nothing was lost, try again in a moment.")
  }

  if (loading) {
    return (
      <div className="px-5 pt-8">
        <GlassCard className="p-5">
          <div className="shimmer h-4 rounded mb-2" />
          <div className="shimmer h-4 rounded w-2/3" />
        </GlassCard>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="px-5 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-tint/[0.03] border border-tint/[0.08] flex items-center justify-center mb-4 mx-auto">
          <AlertTriangle size={28} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">{error ?? 'Insight not found.'}</p>
        <Link href="/" className="text-family-400 font-semibold mt-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back home
        </Link>
      </div>
    )
  }

  const { insight } = preview

  return (
    <PageTransition>
    <div className="px-5 pt-2 pb-8 space-y-5">
      <PageHeader
        title="Review before Keel acts"
        backHref="/"
        subtitle="Nothing happens until you approve it here"
      />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-5">
          <div className="text-sm font-semibold text-ink-primary mb-1">{readableHypothesis(insight.hypothesis)}</div>
          <p className="text-sm text-ink-secondary leading-relaxed">{insight.reasoning}</p>
        </GlassCard>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <WhyThisInsight insight={insight} />
      </motion.div>

      {preview.dry_run && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-4 border border-warning/30">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="text-warning shrink-0 mt-0.5" />
              <p className="text-sm text-ink-secondary leading-relaxed">
                <span className="font-semibold text-ink-primary">Dry-run mode is on.</span>{' '}
                Approving records the decision and what would have run — nothing is actually sent or changed.
              </p>
            </div>
          </GlassCard>
        </motion.div>
      )}

      {outcome ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-5">
            <div className="flex items-start gap-3">
              {outcome.kind === 'completed' && <CheckCircle2 size={20} className="text-success shrink-0 mt-0.5" />}
              {outcome.kind === 'execution_failed' && <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />}
              {outcome.kind === 'dismissed' && <XCircle size={20} className="text-ink-tertiary shrink-0 mt-0.5" />}
              <div className="flex-1">
                <p className="text-sm text-ink-primary leading-relaxed">{outcome.message}</p>
                {outcome.kind === 'execution_failed' && (
                  <button
                    onClick={handleRetry}
                    disabled={acting !== null}
                    className="mt-3 text-sm font-semibold text-family-400 inline-flex items-center gap-1"
                  >
                    {acting === 'retry' && <Loader2 size={14} className="animate-spin" />}
                    Retry failed actions
                  </button>
                )}
                <button
                  onClick={() => router.back()}
                  className="mt-3 block text-sm text-ink-tertiary"
                >
                  ← Back
                </button>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      ) : alreadyResolved ? (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-5">
            <p className="text-sm text-ink-secondary leading-relaxed">
              This insight is already {insight.state} — no further action is needed.
            </p>
          </GlassCard>
        </motion.div>
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
              <ExternalLink size={15} className="text-family-400" />
              What happens if you approve
            </div>
            {preview.actions.length === 0 && (
              <GlassCard className="p-4">
                <p className="text-sm text-ink-secondary">This insight has no recommended actions — approving just marks it handled.</p>
              </GlassCard>
            )}
            <div className="space-y-2">
              {preview.actions.map((action) => {
                const Icon = ACTION_TYPE_ICON[action.type]
                return (
                  <GlassCard key={action.label} className="p-4">
                    <div className="flex items-start gap-3">
                      <Icon size={16} className={action.external ? 'text-warning' : 'text-ink-tertiary'} />
                      <div className="flex-1">
                        <p className="text-sm text-ink-primary leading-relaxed">{action.label}</p>
                        <p className={`text-xs mt-1 leading-relaxed ${action.external ? 'text-warning/90 font-semibold' : 'text-ink-tertiary'}`}>
                          {action.summary}
                        </p>
                      </div>
                    </div>
                  </GlassCard>
                )
              })}
            </div>
            {hasExternalActions && !preview.dry_run && (
              <p className="text-xs text-warning/90 leading-relaxed mt-3 px-1">
                Approving runs the actions marked above — real messages are sent to your own contact details via your connected providers.
              </p>
            )}
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for the record (optional)"
              rows={2}
              className="w-full glass rounded-2xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary resize-none focus:outline-none focus:ring-1 focus:ring-family-400"
            />
            {error && <p className="text-sm text-danger mt-2 px-1">{error}</p>}

            <div className="mt-3 space-y-2">
              <GlassButton onClick={handleApprove} disabled={acting !== null}>
                {acting === 'approve' ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {preview.dry_run ? 'Approve (dry run — nothing sent)' : 'Approve & run'}
              </GlassButton>
              <GlassButton variant="secondary" onClick={handleDraft} disabled={acting !== null}>
                {acting === 'draft' && <Loader2 size={16} className="animate-spin" />}
                Prepare a draft instead
              </GlassButton>
              <GlassButton variant="ghost" onClick={handleDismiss} disabled={acting !== null}>
                {acting === 'dismiss' ? <Loader2 size={16} className="animate-spin" /> : null}
                Dismiss this insight
              </GlassButton>
            </div>

            {draftText && (
              <GlassCard className="p-4 mt-3 space-y-2">
                <p className="text-xs text-ink-tertiary">Draft — copy and send it yourself; Keel never sends on its own.</p>
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  rows={6}
                  className="w-full bg-transparent text-sm text-ink-primary resize-y focus:outline-none"
                />
                <DraftProvenanceNote facts={draftFacts} />
              </GlassCard>
            )}
            {draftError && <p className="text-sm text-danger mt-2 px-1">{draftError}</p>}
          </motion.div>
        </>
      )}
    </div>
    </PageTransition>
  )
}
