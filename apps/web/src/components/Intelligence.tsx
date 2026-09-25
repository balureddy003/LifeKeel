'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { GlassCard } from './Glass'
import { haptic } from '@/lib/haptics'
import { useAppStore } from '@/lib/store'
import { fetchFinancialProfile, fetchDocuments, fetchConnectorStatuses, fetchProfileSuggestions } from '@/lib/api'
import { TrendingUp, FileText, Landmark, Mail, BarChart3, Scale, Car, Check, Sparkles, ChevronRight, ChevronDown, Users } from 'lucide-react'

export function TrustLadder() {
  const router = useRouter()
  // These zustand flags are session-only (not persisted — see store.ts) and
  // only ever get set the moment an action succeeds in the current tab, so
  // they're used as an instant UI update but never as the source of truth:
  // reload the page, or come back tomorrow, and they reset to false even
  // though the server-side data is still there. Real completion is fetched
  // below and OR'd in so a step that's genuinely done stays done.
  const connectedConnectorsLocal = useAppStore((s) => s.connectedConnectors)
  const uploadedDocumentCountLocal = useAppStore((s) => s.uploadedDocumentCount)
  const financialProfileSubmittedLocal = useAppStore((s) => s.financialProfileSubmitted)
  const [expanded, setExpanded] = useState(false)
  const [hasFinancialProfile, setHasFinancialProfile] = useState(false)
  const [hasDocuments, setHasDocuments] = useState(false)
  const [connectedIds, setConnectedIds] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => { if (!cancelled) setHasFinancialProfile(!!p?.insights_evaluated_at) })
    fetchDocuments().then((d) => { if (!cancelled) setHasDocuments(d.documents.length > 0) })
    fetchConnectorStatuses().then((cs) => {
      if (!cancelled) setConnectedIds(cs.filter((c) => c.connected).map((c) => c.id))
    })
    return () => { cancelled = true }
  }, [])

  const financialProfileSubmitted = financialProfileSubmittedLocal || hasFinancialProfile
  const uploadedDocumentCount = uploadedDocumentCountLocal || (hasDocuments ? 1 : 0)
  const connectedConnectors = connectedConnectorsLocal.length > 0 ? connectedConnectorsLocal : connectedIds

  const steps = [
    { id: 'family', icon: Users, label: 'Add Your Family', timeframe: 'Day 1', desc: 'Tell us who\'s in your household', route: '/family' },
    { id: 'documents', icon: FileText, label: 'Upload Documents', timeframe: 'Week 1', desc: 'Snap a photo or upload any document', route: '/upload' },
    { id: 'bank', icon: Landmark, label: 'Connect Bank', timeframe: 'Week 2', desc: 'Securely connect your bank accounts', route: '/connect' },
    { id: 'email', icon: Mail, label: 'Connect Email', timeframe: 'Week 3', desc: 'AI scans for financial documents only', route: '/connect' },
    { id: 'investments', icon: BarChart3, label: 'Add Investments', timeframe: 'Month 2', desc: 'Add your pension and investment numbers to your Financial Profile', route: '/financial-profile' },
    { id: 'estate', icon: Scale, label: 'Estate Planning', timeframe: 'Month 3', desc: 'Upload your will and estate documents for secure storage', route: '/upload' },
  ].map((step) => {
    let status: 'done' | 'available' | 'locked' = 'locked'
    if (step.id === 'family') status = 'done'
    else if (step.id === 'documents') status = uploadedDocumentCount > 0 ? 'done' : 'available'
    // Open Banking has no live connect flow yet — the Financial Profile is
    // the real way to complete this step today, same as investments below.
    else if (step.id === 'bank') status = (connectedConnectors.includes('open-banking') || financialProfileSubmitted) ? 'done' : 'available'
    else if (step.id === 'email') status = connectedConnectors.includes('email') ? 'done' : 'available'
    else if (step.id === 'investments') status = financialProfileSubmitted ? 'done' : 'available'
    else if (step.id === 'estate') status = 'available'
    return { ...step, status }
  })

  const doneCount = steps.filter((s) => s.status === 'done').length
  const incomplete = steps.filter((s) => s.status !== 'done')
  // Collapsed by default to just what's next — this is the app's one "what
  // should I do now" list; a fully expanded 6-item wall competed with the
  // health rings for the same job every time, whether or not there was
  // anything left to do.
  const visibleSteps = expanded ? steps : incomplete.slice(0, 2)

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary">
          <TrendingUp size={16} className="text-family-400" />
          Trust Ladder
        </div>
        <span className="text-xs text-ink-tertiary">{doneCount}/{steps.length} done</span>
      </div>
      <div className="text-xs text-ink-tertiary mb-4">We build your profile step by step — at your pace</div>

      {incomplete.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-success py-2">
          <Check size={16} /> All caught up — nothing left on the ladder.
        </div>
      ) : (
        <div id="trust-ladder-steps" className="space-y-1">
          {visibleSteps.map((step, i) => {
            const Icon = step.icon
            const isDone = step.status === 'done'
            const isAvailable = step.status === 'available'
            return (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="flex items-center gap-3 py-2"
              >
                {/* Timeline dot */}
                <div className="flex flex-col items-center">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: isDone
                        ? 'rgba(74,222,128,0.15)'
                        : isAvailable
                        ? 'rgb(var(--family-accent) / 0.15)'
                        : 'rgb(var(--tint) / 0.03)',
                      border: `2px solid ${
                        isDone ? 'rgba(74,222,128,0.4)'
                        : isAvailable ? 'rgb(var(--family-accent) / 0.4)'
                        : 'rgb(var(--tint) / 0.08)'
                      }`,
                    }}
                  >
                    {isDone ? <Check size={14} color="rgb(var(--success))" /> : <Icon size={14} className={isAvailable ? 'text-family-400' : 'text-ink-tertiary'} />}
                  </div>
                  {i < visibleSteps.length - 1 && (
                    <div
                      className="w-px h-6"
                      style={{ background: isDone ? 'rgba(74,222,128,0.2)' : 'rgb(var(--tint) / 0.05)' }}
                    />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${isDone ? 'text-success' : isAvailable ? 'text-family-400' : 'text-ink-tertiary'}`}>
                      {step.label}
                    </span>
                    <span className="text-caption text-ink-tertiary">{step.timeframe}</span>
                  </div>
                  <p className="text-xs text-ink-tertiary">{step.desc}</p>
                </div>

                {/* Action */}
                {isAvailable && !isDone && (
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => { haptic('light'); router.push(step.route) }}
                    className="text-xs font-semibold text-family-400 flex-shrink-0 flex items-center gap-0.5"
                  >
                    Start <ChevronRight size={12} />
                  </motion.button>
                )}
                {isDone && (
                  <span className="text-xs font-semibold text-success flex-shrink-0 flex items-center gap-0.5">
                    <Check size={12} /> Done
                  </span>
                )}
              </motion.div>
            )
          })}
        </div>
      )}

      {steps.length > 2 && (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => { haptic('light'); setExpanded((v) => !v) }}
          aria-expanded={expanded}
          aria-controls="trust-ladder-steps"
          className="w-full mt-3 pt-3 border-t border-tint/5 text-xs font-semibold text-ink-tertiary flex items-center justify-center gap-1"
        >
          {expanded ? 'Show less' : `See all ${steps.length} steps`}
          <motion.span animate={{ rotate: expanded ? 180 : 0 }}>
            <ChevronDown size={12} />
          </motion.span>
        </motion.button>
      )}
    </GlassCard>
  )
}

// Dismissal has no backend endpoint (these are sample cards, not real
// signals) — persist client-side, scoped by tenant so a shared device
// doesn't leak one user's dismissals into another's, same pattern as
// the Events checklist.
function memoryPromptsStorageKey(): string {
  const tenant = typeof window !== 'undefined' ? localStorage.getItem('agentoak_tenant') ?? 'anon' : 'anon'
  return `agentoak:memory-prompts-dismissed:${tenant}`
}

function loadDismissedPromptIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(memoryPromptsStorageKey())
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function saveDismissedPromptIds(ids: Set<string>): void {
  try {
    localStorage.setItem(memoryPromptsStorageKey(), JSON.stringify([...ids]))
  } catch {
    // Best-effort — private browsing / storage-full shouldn't break dismissal.
  }
}

interface MemoryPrompt {
  id: string
  icon: typeof Car
  title: string
  message: string
  action: string
  route: string
}

// Illustrative preview shown only when the family has no real, actionable
// document yet — clearly labeled "Sample" so it never reads as a real signal.
const SAMPLE_PROMPTS: MemoryPrompt[] = [
  {
    id: 'sample-car',
    icon: Car,
    title: 'I noticed something new',
    message: 'I see a new vehicle in your transactions. Upload your insurance and registration so I can track it properly.',
    action: 'Add vehicle',
    route: '/upload',
  },
  {
    id: 'sample-pension',
    icon: Landmark,
    title: 'We found a pension statement',
    message: 'I found a pension document in your uploads. Should I add it to your retirement planning?',
    action: 'Review',
    route: '/upload?category=pension',
  },
]

const CATEGORY_PROMPT_META: Record<string, { icon: typeof Car; title: string; what: string }> = {
  pension: { icon: Landmark, title: 'We found a pension statement', what: 'add it to your retirement planning' },
  mortgage: { icon: Landmark, title: 'We found a mortgage statement', what: 'update your mortgage balance' },
  insurance: { icon: FileText, title: 'We found an insurance document', what: 'add it to your protection cover' },
  income: { icon: Mail, title: 'We found a payslip', what: 'fill in your monthly salary' },
}

const MAX_DOCS_SCANNED = 3

// Real, per-document prompts: the same extraction + suggestion pipeline the
// document detail page already uses (GET /documents/:id/profile-suggestions),
// surfaced on Home instead of only after the user opens the document.
export async function loadDocumentPrompts(): Promise<MemoryPrompt[]> {
  const { documents } = await fetchDocuments()
  const recent = documents
    .filter((d) => d.status === 'extracted' && CATEGORY_PROMPT_META[d.category])
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
    .slice(0, MAX_DOCS_SCANNED)

  const results = await Promise.all(
    recent.map(async (doc) => {
      const { suggestions, policySuggestion } = await fetchProfileSuggestions(doc.id)
      const actionable = suggestions.length > 0 || !!policySuggestion?.provider
      if (!actionable) return null
      const meta = CATEGORY_PROMPT_META[doc.category]!
      return {
        id: doc.id,
        icon: meta.icon,
        title: meta.title,
        message: `I read "${doc.filename}" from your uploads. Want to review what I found and ${meta.what}?`,
        action: 'Review',
        route: `/documents/${doc.id}`,
      } satisfies MemoryPrompt
    }),
  )
  return results.filter((p): p is MemoryPrompt => p !== null)
}

export function MemoryPrompts() {
  const router = useRouter()
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [realPrompts, setRealPrompts] = useState<MemoryPrompt[] | null>(null)

  useEffect(() => {
    setDismissed(loadDismissedPromptIds())
    let cancelled = false
    loadDocumentPrompts()
      .then((p) => { if (!cancelled) setRealPrompts(p) })
      .catch(() => { if (!cancelled) setRealPrompts([]) })
    return () => { cancelled = true }
  }, [])

  const dismiss = (id: string) => {
    haptic('light')
    setDismissed((prev) => {
      const next = new Set(prev).add(id)
      saveDismissedPromptIds(next)
      return next
    })
  }

  // Still resolving — render nothing rather than flash the sample content
  // and then swap it for real cards.
  if (realPrompts === null) return null

  const realVisible = realPrompts.filter((p) => !dismissed.has(p.id))
  // Real prompts the user already dismissed must not fall back to the
  // sample — that would present canned content as if it replaced them.
  const isSample = realPrompts.length === 0
  const prompts = isSample ? SAMPLE_PROMPTS.filter((p) => !dismissed.has(p.id)) : realVisible

  if (prompts.length === 0) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-1 px-1">
        <Sparkles size={16} className="text-family-400" />
        AI Memory
        {isSample && (
          <span className="text-caption text-warning font-semibold px-1.5 py-0.5 rounded-full bg-warning/10">
            Sample
          </span>
        )}
      </div>
      <p className="text-xs text-ink-tertiary mb-2 px-1">
        {isSample
          ? 'Examples of what Oak surfaces once your documents and accounts are connected.'
          : 'Found in documents you uploaded — nothing changes until you review and approve it.'}
      </p>
      {prompts.map((p, i) => {
        const Icon = p.icon
        return (
        <motion.div
          key={p.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          <GlassCard className="p-4 border-family-500/20">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
                <Icon size={18} className="text-family-400" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-family-400 mb-1">{p.title}</div>
                <p className="text-sm text-ink-secondary leading-relaxed mb-2">{p.message}</p>
                <div className="flex gap-2">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => { haptic('success'); router.push(p.route) }}
                    className="text-xs font-semibold text-family-400 flex items-center gap-0.5"
                  >
                    {p.action} <ChevronRight size={12} />
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => dismiss(p.id)}
                    className="text-xs text-ink-tertiary"
                  >
                    Not now
                  </motion.button>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      )
      })}
    </div>
  )
}
