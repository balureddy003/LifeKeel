'use client'

import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Network, Activity, Lightbulb, ChevronRight, Hand, Star, Target, Bot, Phone, User, FileText, Siren, Search, CalendarClock, X, UserPlus, Sparkles, Check, Upload, Plug, Calculator, Zap } from 'lucide-react'
import { FamilyRoster } from '@/components/FamilyRoster'
import { LifeTimeline } from '@/components/LifeTimeline'
import { ScoreRing, GlassCard, PageHeader, IfAdvanced, Skeleton, Money } from '@/components/Glass'
import { TrustLadder, MemoryPrompts } from '@/components/Intelligence'
import { HealthSummary } from '@/components/HealthSummary'
import { useMode } from '@/lib/mode-context'
import { useFamilyReadinessScore, useFamilyTimeline, useFamilyInsights } from '@/lib/useFamilyData'
import { useAppStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'
import { fetchDocuments, fetchConnectorStatuses, fetchFinancialProfile, fetchLifeChangeNudge, dismissLifeChangeNudge, RESOLVED_INSIGHT_STATES, type FinancialProfile } from '@/lib/api'
import { elderlyHomeCopy } from '@/lib/elderlyHomeCopy'
import { childHomeCopy } from '@/lib/childHomeCopy'
import { simpleHomeCopy } from '@/lib/simpleHomeCopy'

function ChildHome() {
  const { user } = useAuth()
  const childName = user?.name?.split(' ')[0] ?? 'there'
  const [profile, setProfile] = useState<FinancialProfile | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetchFinancialProfile().then((p) => { if (!cancelled) setProfile(p) })
    return () => { cancelled = true }
  }, [])

  const myFund = profile?.education_funds.find(
    (f) => f.child_name.toLowerCase() === (user?.name ?? '').toLowerCase(),
  )
  const progress = myFund && myFund.target_savings_minor > 0
    ? Math.round((myFund.current_savings_minor / myFund.target_savings_minor) * 100)
    : 0
  const { subheadline } = childHomeCopy({ loading: profile === undefined, hasLiveData: profile !== null && profile !== undefined })

  return (
    <div className="px-4 pt-4 space-y-5">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-4"
      >
        <div className="w-16 h-16 rounded-3xl bg-family-500/10 border border-family-500/20 flex items-center justify-center mb-3 mx-auto">
          <Hand size={32} className="text-family-400" />
        </div>
        <h1 className="text-2xl font-bold">Hi {childName}!</h1>
        <p className="text-sm text-ink-tertiary mt-1 flex items-center justify-center gap-1">
          {subheadline} <Star size={12} className="text-family-400" />
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
        <GlassCard className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
              <Target size={20} className="text-family-400" />
            </div>
            <span className="text-base font-semibold flex-1">My Education Fund</span>
            {myFund && (
              <span className="text-lg font-bold text-family-400">{progress}%</span>
            )}
          </div>
          {myFund ? (
            <>
              <div className="h-3 rounded-full bg-tint/5 overflow-hidden mb-2">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ delay: 0.3, duration: 0.8 }}
                />
              </div>
              <p className="text-sm text-ink-secondary">
                <Money value={`£${Math.round(myFund.current_savings_minor / 100).toLocaleString()}`} /> saved
                toward your <Money value={`£${Math.round(myFund.target_savings_minor / 100).toLocaleString()}`} /> goal
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-secondary">
              {profile === undefined
                ? 'Loading...'
                : "No education fund set up for you yet — ask a parent to add one in the family's Financial Profile."}
            </p>
          )}
        </GlassCard>
      </motion.div>
    </div>
  )
}

function ElderlyHome() {
  const { score, hasLiveData, loading } = useFamilyReadinessScore()
  const { activateEmergency } = useMode()
  const router = useRouter()
  const { headline, subheadline } = elderlyHomeCopy({ loading, hasLiveData, score })

  // OAK-004: every tile here was a dead button — no onClick anywhere, on
  // the persona this large-target, simplified UI was explicitly designed
  // for, and the tile most likely to be tapped in a real crisis
  // (Emergency Help) was one of them. No phone number is captured
  // anywhere in the data model (no field on a family member or an
  // insurance policy/provider) — a fake tel: link to a number that
  // doesn't exist would be worse than a dead button, so the two "call"
  // tiles route to the real page where that contact would actually be
  // found once it's captured (a fast-follow, not invented here).
  function handleTileTap(action: string) {
    haptic('medium')
    switch (action) {
      case 'ask':
        router.push('/assistant')
        break
      case 'call-insurance':
        router.push('/financial-profile')
        break
      case 'call-son':
        router.push('/family')
        break
      case 'docs':
        router.push('/upload')
        break
      case 'emergency':
        activateEmergency()
        break
    }
  }

  return (
    <div className="px-4 pt-5 space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-2xl font-bold mb-1">{headline}</h1>
        <p className="text-lg text-ink-tertiary">{subheadline}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="flex justify-center"
      >
        {/* Was size 160 — on a real device that, plus the headline and the
            welcome paragraph below, pushed every action tile (including
            Emergency Help) below the fold on first load. This is Elderly
            mode: the whole point is large, simple, one-tap access, not a
            hero moment that costs the tiles their visibility. Still a
            generous, easily-read size — 120 is well above the size=100
            threshold where ScoreRing keeps its "out of N" caption. */}
        <ScoreRing score={score} size={120} />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-base text-center text-ink-secondary leading-snug px-4"
      >
        Welcome back. Tap any item below to explore your financial picture.
      </motion.p>

      <div className="space-y-2.5">
        {[
          { icon: Bot, label: 'Ask Anything', action: 'ask' },
          { icon: Phone, label: 'View Insurance', action: 'call-insurance' },
          { icon: User, label: 'View Son', action: 'call-son' },
          { icon: FileText, label: 'Important Documents', action: 'docs' },
          { icon: Siren, label: 'Emergency Help', action: 'emergency', danger: true },
        ].map((item, i) => {
          const Icon = item.icon
          return (
          <motion.button
            key={item.action}
            onClick={() => handleTileTap(item.action)}
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.1 }}
            className="w-full rounded-3xl p-6 flex items-center gap-4"
            style={{
              minHeight: 80,
              background: item.danger
                ? 'linear-gradient(135deg, #f87171, #dc2626)'
                : 'rgb(var(--tint) / 0.03)',
              border: item.danger ? 'none' : '1px solid rgb(var(--tint) / 0.08)',
              backdropFilter: item.danger ? 'none' : 'blur(40px)',
              WebkitBackdropFilter: item.danger ? 'none' : 'blur(40px)',
            }}
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: item.danger ? 'rgba(255,255,255,0.15)' : 'rgb(var(--family-accent) / 0.1)' }}>
              <Icon size={24} color={item.danger ? '#fff' : 'rgb(var(--family-accent))'} />
            </div>
            <span className="text-xl font-semibold" style={{ color: item.danger ? '#fff' : undefined }}>
              {item.label}
            </span>
          </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// The invite code that lets a partner or caregiver join lived only as a
// line of text on the Settings page — the exact referral mechanic that
// grows family-unit products (Dropbox, Life360) doesn't do much good
// buried in a menu. Surface it here instead, as soon as there's a family
// of one to grow.
function InviteFamilyBanner() {
  const { family } = useAuth()
  const [dismissed, setDismissed] = useState(false)
  const router = useRouter()

  if (!family || family.members.length > 1 || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
      >
        <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <UserPlus size={16} className="text-family-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-primary truncate">Add your partner or a caregiver</div>
            <div className="text-xs text-ink-tertiary">Same plan, whole family &middot; invite code {family.inviteCode}</div>
          </div>
          <button
            onClick={() => { haptic('light'); router.push('/settings?add=1') }}
            className="text-xs font-semibold text-family-400 px-3 py-2 rounded-lg bg-family-500/10 flex-shrink-0"
          >
            Invite
          </button>
          <button
            onClick={() => { setDismissed(true); haptic('light') }}
            aria-label="Dismiss"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-tertiary active:opacity-60 flex-shrink-0"
          >
            <X size={16} />
          </button>
        </GlassCard>
      </motion.div>
    </AnimatePresence>
  )
}

// Scoped by tenant so a shared device doesn't leak one user's history into
// another's, same pattern as the AI Memory dismissals below.
function lastVisitStorageKey(): string {
  const tenant = typeof window !== 'undefined' ? localStorage.getItem('agentoak_tenant') ?? 'anon' : 'anon'
  return `agentoak:last-visit-snapshot:${tenant}`
}

interface VisitSnapshot {
  score: number
  openInsightCount: number
}

function loadLastVisitSnapshot(): VisitSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(lastVisitStorageKey())
    return raw ? (JSON.parse(raw) as VisitSnapshot) : null
  } catch {
    return null
  }
}

function saveLastVisitSnapshot(snapshot: VisitSnapshot): void {
  try {
    localStorage.setItem(lastVisitStorageKey(), JSON.stringify(snapshot))
  } catch {
    // Best-effort — private browsing / storage-full shouldn't block the page.
  }
}

// The "what changed since I last looked" moment — the biggest gap versus
// competitors like Copilot/Monarch, who lead with a delta, not a dashboard
// the user has to re-scan themselves to find what's new. Built entirely from
// real, already-fetched data (score + open insight count) diffed against the
// prior visit's snapshot in localStorage — never fabricated, and silent on
// a first visit or a no-change visit rather than forcing something to say.
function timeOfDayGreeting(name: string): string {
  const h = new Date().getHours()
  const time = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
  return `Good ${time}, ${name}`
}

function SinceLastVisit({
  score,
  hasLiveData,
  openInsightCount,
  loading,
}: {
  score: number
  hasLiveData: boolean
  openInsightCount: number
  loading: boolean
}) {
  const { user } = useAuth()
  const [previous, setPrevious] = useState<VisitSnapshot | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (loading || !hasLiveData) return
    setPrevious(loadLastVisitSnapshot())
    saveLastVisitSnapshot({ score, openInsightCount })
    setReady(true)
    // Snapshot only once per page load — re-running this on every score/count
    // change would overwrite "previous" before the user ever saw the delta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasLiveData])

  if (!ready) return null

  const firstName = user?.name?.split(' ')[0] ?? 'there'

  // No previous visit or no delta — show a calm time-of-day greeting
  // instead of silence.  Apple-style: acknowledge the human, don't
  // manufacture urgency.
  if (!previous) {
    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-family-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-primary">{timeOfDayGreeting(firstName)}</div>
            <div className="text-xs text-ink-tertiary">Everything looks stable.</div>
          </div>
        </GlassCard>
      </motion.div>
    )
  }

  const scoreDelta = score - previous.score
  const insightDelta = openInsightCount - previous.openInsightCount
  if (scoreDelta === 0 && insightDelta === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <Sparkles size={16} className="text-family-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-primary">{timeOfDayGreeting(firstName)}</div>
            <div className="text-xs text-ink-tertiary">No changes since your last visit.</div>
          </div>
        </GlassCard>
      </motion.div>
    )
  }

  const parts: string[] = []
  if (scoreDelta !== 0) {
    parts.push(`Readiness score ${scoreDelta > 0 ? 'up' : 'down'} ${Math.abs(scoreDelta)} point${Math.abs(scoreDelta) === 1 ? '' : 's'}`)
  }
  if (insightDelta > 0) {
    parts.push(`${insightDelta} new insight${insightDelta === 1 ? '' : 's'} to review`)
  } else if (insightDelta < 0) {
    parts.push(`${Math.abs(insightDelta)} insight${Math.abs(insightDelta) === 1 ? '' : 's'} resolved`)
  }

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
      <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
          <Sparkles size={16} className="text-family-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-ink-tertiary mb-0.5">Since your last visit</div>
          <div className="text-sm font-semibold text-ink-primary">{parts.join(' · ')}</div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// PRD-111: a family's profile itself already carried the signature of a
// major change (income dropped, employment status flipped) that hasn't
// been reported as a life event yet. Deliberately content-free — never
// names or guesses what changed, never mentions a product; just an
// invitation to tell Oak. Same dismissible-card shape as UrgencyBanner
// below, kept as its own component since it has its own data source and
// dismiss action.
function LifeChangeNudge() {
  const [active, setActive] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchLifeChangeNudge().then((r) => { if (!cancelled) setActive(r.active) })
    return () => { cancelled = true }
  }, [])

  if (!active || dismissed) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
      >
        <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <Zap size={16} className="text-family-400" />
          </div>
          <Link href="/life-events" className="flex-1 min-w-0" onClick={() => haptic('light')}>
            <div className="text-sm font-semibold text-ink-primary">
              It looks like something changed
            </div>
            <div className="text-xs text-ink-tertiary">Want to tell Oak what&apos;s going on?</div>
          </Link>
          <button
            onClick={() => {
              setDismissed(true)
              haptic('light')
              dismissLifeChangeNudge()
            }}
            aria-label="Dismiss"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-tertiary active:opacity-60"
          >
            <X size={16} />
          </button>
        </GlassCard>
      </motion.div>
    </AnimatePresence>
  )
}

function UrgencyBanner() {
  const [dismissed, setDismissed] = useState(false)
  const currentYear = new Date().getFullYear()
  const { events: timelineEvents } = useFamilyTimeline()
  const nextEvent = timelineEvents
    .filter((e) => e.status === 'future' && e.year > currentYear)
    .sort((a, b) => a.year - b.year)[0]

  if (!nextEvent || dismissed) return null
  const yearsUntil = nextEvent.year - currentYear

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
      >
        <GlassCard className="p-3.5 border-family-500/20 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
            <CalendarClock size={16} className="text-family-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink-primary truncate">{nextEvent.label}</div>
            <div className="text-xs text-ink-tertiary">
              {yearsUntil === 1 ? 'Next year' : `In ${yearsUntil} years`} · {nextEvent.year}
            </div>
          </div>
          <button
            onClick={() => { setDismissed(true); haptic('light') }}
            aria-label="Dismiss"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-tertiary active:opacity-60"
          >
            <X size={16} />
          </button>
        </GlassCard>
      </motion.div>
    </AnimatePresence>
  )
}

// Rotating feature-discovery tip — one per visit, never repeated, dismissible.
// Stored in localStorage so it persists across sessions.
const FEATURE_TIPS = [
  { text: 'Ask Oak anything about your family finances — tap the purple button.', href: '/assistant', cta: 'Try it' },
  { text: 'Swipe left on an inbox item to dismiss it — you can undo within 5 seconds.', href: '/inbox', cta: 'Open Inbox' },
  { text: 'Oak can scan your email for renewals and policy changes.', href: '/connect/email', cta: 'Connect email' },
  { text: 'Upload a will, insurance policy, or bank statement to get insights.', href: '/upload', cta: 'Upload' },
  { text: 'Run a "What If?" scenario to see how your cover holds up.', href: '/events', cta: 'Explore' },
  { text: 'Switch to Light mode in Settings under Appearance.', href: '/settings', cta: 'Settings' },
]

function tipStorageKey(): string {
  const tenant = typeof window !== 'undefined' ? localStorage.getItem('agentoak_tenant') ?? 'anon' : 'anon'
  return `agentoak:dismissed-tips:${tenant}`
}

function FeatureTip() {
  const [tip, setTip] = useState<typeof FEATURE_TIPS[0] | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(tipStorageKey())
      const dismissed: number[] = raw ? JSON.parse(raw) : []
      const available = FEATURE_TIPS.map((t, i) => ({ ...t, idx: i })).filter((t) => !dismissed.includes(t.idx))
      if (available.length === 0) return
      setTip(available[0]!)
    } catch { /* best effort */ }
  }, [])

  if (!tip) return null

  const dismiss = () => {
    haptic('light')
    try {
      const raw = localStorage.getItem(tipStorageKey())
      const dismissed: number[] = raw ? JSON.parse(raw) : []
      const idx = FEATURE_TIPS.indexOf(tip)
      if (idx >= 0 && !dismissed.includes(idx)) {
        localStorage.setItem(tipStorageKey(), JSON.stringify([...dismissed, idx]))
      }
    } catch { /* best effort */ }
    setTip(null)
  }

  return (
    <AnimatePresence>
      {tip && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <GlassCard className="p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
              <Zap size={16} className="text-family-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-ink-tertiary mb-0.5">Did you know?</div>
              <div className="text-sm text-ink-primary leading-snug">{tip.text}</div>
              <Link href={tip.href} onClick={() => haptic('light')} className="text-xs font-semibold text-family-400 mt-1 inline-block">
                {tip.cta}
              </Link>
            </div>
            <button onClick={dismiss} aria-label="Dismiss tip" className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-tertiary active:opacity-60 flex-shrink-0">
              <X size={16} />
            </button>
          </GlassCard>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Apple-style "Getting Started" checklist — replaces the generic empty
// state when the user has no live data yet.  Each step maps to a real
// store signal so progress is honest, not decorative.
function GettingStarted() {
  const docCountLocal = useAppStore((s) => s.uploadedDocumentCount)
  const connectorsLocal = useAppStore((s) => s.connectedConnectors)
  // Local flags only reflect actions taken in this tab; the server is the
  // source of truth (same approach as TrustLadder), so a reload doesn't
  // reset finished steps to "not done".
  const [serverDocs, setServerDocs] = useState(0)
  const [serverConnectors, setServerConnectors] = useState(0)
  useEffect(() => {
    let cancelled = false
    fetchDocuments().then((d) => { if (!cancelled) setServerDocs(d.documents.length) })
    fetchConnectorStatuses().then((cs) => { if (!cancelled) setServerConnectors(cs.filter((c) => c.connected).length) })
    return () => { cancelled = true }
  }, [])
  const docCount = Math.max(docCountLocal, serverDocs)
  const connectorCount = Math.max(connectorsLocal.length, serverConnectors)

  const steps = [
    { label: 'Upload a document', description: 'Insurance policy, will, or bank statement', href: '/upload', icon: Upload, done: docCount > 0 },
    { label: 'Fill in your financial profile', description: 'Income, protection, savings — finish it to generate your score', href: '/financial-profile', icon: Calculator,
      // Only rendered while there is no score, i.e. detectors haven't run
      // on the profile yet — so this step is by definition not done, even
      // if a half-saved profile exists.
      done: false },
    { label: 'Connect a service', description: 'Email, bank, or insurance provider', href: '/connect', icon: Plug, done: connectorCount > 0 },
  ]

  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null // all done — live score card takes over

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-ink-primary">Get your readiness score</div>
            <div className="text-xs text-ink-tertiary mt-0.5">{doneCount} of {steps.length} done</div>
          </div>
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <motion.div
                key={i}
                className={`w-2.5 h-2.5 rounded-full ${s.done ? 'bg-success' : 'bg-tint/10'}`}
                initial={false}
                animate={s.done ? { scale: [1, 1.3, 1] } : {}}
                transition={{ duration: 0.3 }}
              />
            ))}
          </div>
        </div>

        <div className="h-1.5 rounded-full bg-tint/5 overflow-hidden mb-4">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-family-400 to-success"
            initial={{ width: 0 }}
            animate={{ width: `${(doneCount / steps.length) * 100}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </div>

        <div className="space-y-2">
          {steps.map((step, i) => (
            <Link
              key={i}
              href={step.href}
              onClick={() => haptic('light')}
              className={`flex items-center gap-3 rounded-xl p-3 transition-colors ${step.done ? 'opacity-60' : 'bg-tint/[0.03] active:bg-tint/[0.06]'}`}
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${step.done ? 'bg-success/15' : 'bg-family-500/10 border border-family-500/20'}`}>
                {step.done ? (
                  <Check size={16} className="text-success" />
                ) : (
                  <step.icon size={16} className="text-family-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold ${step.done ? 'line-through text-ink-tertiary' : 'text-ink-primary'}`}>{step.label}</div>
                <div className="text-xs text-ink-tertiary truncate">{step.description}</div>
              </div>
              {!step.done && <ChevronRight size={14} className="text-ink-tertiary flex-shrink-0" />}
            </Link>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  )
}

export default function HomePage() {
  const { config } = useMode()
  const { score: readinessScore, hasLiveData, loading: scoreLoading } = useFamilyReadinessScore()
  const { events: timelineEvents, hasData: hasTimelineData, hasChildren } = useFamilyTimeline()
  const { insights, loading: insightsLoading } = useFamilyInsights()
  const detectorDismissals = useAppStore((s) => s.detectorDismissals)
  // Dismissal learning: a detector the family has dismissed twice stops
  // being featured as the hero card — the insight still exists and still
  // counts as open; it just stops being pushed. The whole card hides
  // rather than falling back to "on track", which would be untrue.
  const retirementSuppressed =
    (detectorDismissals['family_retirement_gap'] ?? 0) >= 2 &&
    insights.some((i) => i.detector_id === 'family_retirement_gap')
  const retirementInsight = retirementSuppressed
    ? undefined
    : insights.find((i) => i.detector_id === 'family_retirement_gap')
  const openInsightCount = insights.filter((i) => !RESOLVED_INSIGHT_STATES.includes(i.state)).length
  // "On track" means no open gaps, not merely a high number — three open
  // protection gaps still score 77.
  const onTrack = openInsightCount === 0 && readinessScore >= 70
  const setCmdkOpen = useAppStore((s) => s.setCmdkOpen)
  const profileCompleteness = useAppStore((s) => s.profileCompleteness)

  if (config.mode === 'child') {
    return <ChildHome />
  }

  if (config.mode === 'elderly') {
    return <ElderlyHome />
  }

  return (
    <div className="px-5 pt-2 space-y-4">
      <PageHeader
        title="Your Family"
        subtitle="Tap anything to explore"
        action={
          <button
            onClick={() => {
              haptic('light')
              setCmdkOpen(true)
            }}
            aria-label="Search or run a command"
            className="w-10 h-10 rounded-full bg-family-500/10 border border-family-500/20 flex items-center justify-center active:opacity-70 transition-opacity"
          >
            <Search size={18} className="text-family-400" />
          </button>
        }
      />

      <InviteFamilyBanner />
      <SinceLastVisit
        score={readinessScore}
        hasLiveData={hasLiveData}
        openInsightCount={openInsightCount}
        loading={scoreLoading || insightsLoading}
      />
      <LifeChangeNudge />
      <UrgencyBanner />

      {!hasLiveData && !scoreLoading && <GettingStarted />}

      {/* At lg+ (max-w-2xl container, NavRail layout) the score card and
          the life-event link pair up 2:1 — the phone-first single column
          stays unchanged below that. Only unconditional sections are
          paired this way; conditional banners/cards keep full width so a
          hidden sibling never leaves a half-empty row. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {(scoreLoading || hasLiveData) && (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="lg:col-span-2"
      >
        <GlassCard className="p-5 h-full">
          <div className="flex items-center gap-3 mb-3">
            {scoreLoading ? (
              <>
                <Skeleton className="h-20 w-20 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </>
            ) : (
              <>
                <ScoreRing score={readinessScore} size={80} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${onTrack ? 'text-success' : 'text-warning'}`}>
                      {config.simpleLanguage
                        ? simpleHomeCopy({ hasLiveData, onTrack: onTrack }).status
                        : onTrack ? "You're on track" : 'Some insights need review'}
                    </span>
                    <motion.span
                      className={`w-2 h-2 rounded-full ${onTrack ? 'bg-success' : 'bg-warning'}`}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    {config.simpleLanguage
                      ? simpleHomeCopy({ hasLiveData, onTrack: onTrack }).body
                      : 'Your family readiness score reflects the gaps found in your profile so far. Connect more data sources for a complete picture.'}
                  </p>
                  {profileCompleteness > 0 && profileCompleteness < 100 && (
                    <Link href="/financial-profile" className="flex items-center gap-2 mt-2 group" onClick={() => haptic('light')}>
                      <div className="w-16 h-1.5 rounded-full bg-tint/10 overflow-hidden">
                        <div className="h-full rounded-full bg-family-400 transition-all" style={{ width: `${profileCompleteness}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-family-400 group-active:opacity-70">Profile {profileCompleteness}%</span>
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        </GlassCard>
      </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Link href="/life-events" onClick={() => haptic('light')} className="h-full block">
          <GlassCard className="p-4 h-full flex flex-col justify-center" interactive>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center flex-shrink-0">
                <Siren size={18} className="text-danger" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-ink-primary">Report a life event</div>
                <div className="text-xs text-ink-tertiary">Job loss, bereavement, or disability — get a plan based on your real data</div>
              </div>
              <ChevronRight size={16} className="text-ink-tertiary" />
            </div>
          </GlassCard>
        </Link>
      </motion.div>
      </div>

      <IfAdvanced>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
            <Network size={16} className="text-family-400" />
            Family
          </div>
          <FamilyRoster />
        </motion.div>
      </IfAdvanced>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
          <Activity size={16} className="text-family-400" />
          Health
        </div>
        <HealthSummary />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        {hasTimelineData ? (
          <LifeTimeline events={timelineEvents} />
        ) : (
          <GlassCard className="p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3">
              <CalendarClock size={16} className="text-family-400" />
              Life Timeline
            </div>
            <p className="text-sm text-ink-tertiary leading-relaxed">
              {hasChildren
                ? "Add a birthday to your children's profiles to see education milestones here."
                : 'Add children to your family profile to see education milestones and future planning events on your timeline.'}
            </p>
            <Link href="/family" className="text-sm text-family-400 font-semibold flex items-center gap-1 mt-2">
              {hasChildren ? 'Go to Family' : 'Set up family'} <ChevronRight size={14} />
            </Link>
          </GlassCard>
        )}
      </motion.div>

      <IfAdvanced>
        {/* lg+ two-column pair — same pairing rule as the score/life-event
            grid above (both always render together inside IfAdvanced). */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <TrustLadder />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <MemoryPrompts />
          </motion.div>
        </div>
      </IfAdvanced>

      {!retirementSuppressed && (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <GlassCard className="p-5 border-family-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={18} className="text-family-400" />
            <span className="text-sm font-semibold text-family-400">One option to consider</span>
          </div>
          {hasLiveData && retirementInsight ? (
            <>
              <p className="text-sm text-ink-secondary leading-relaxed mb-3">
                {retirementInsight.reasoning || retirementInsight.hypothesis}
              </p>
              <Link
                href="/events/retirement"
                className="text-sm text-family-400 font-semibold flex items-center gap-1"
              >
                See retirement plan <ChevronRight size={14} />
              </Link>
              <p className="text-xs text-ink-tertiary mt-3 leading-relaxed">
                Oak earns no commission from any insurer or provider — this is information
                from your own data, not a recommendation to buy anything.
              </p>
            </>
          ) : hasLiveData ? (
            <p className="text-sm text-ink-tertiary leading-relaxed">
              No retirement gap found in your data — your plan looks on track so far.
            </p>
          ) : (
            <p className="text-sm text-ink-tertiary leading-relaxed">
              Connect your accounts and upload documents to receive personalized financial insights and projections.
            </p>
          )}
        </GlassCard>
      </motion.div>
      )}

      <FeatureTip />
    </div>
  )
}
