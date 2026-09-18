'use client'

import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Network, Activity, Lightbulb, ChevronRight, Hand, Star, Target, Bot, Phone, User, FileText, Siren, Search, CalendarClock, X, UserPlus, Sparkles } from 'lucide-react'
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
import { fetchFinancialProfile, RESOLVED_INSIGHT_STATES, type FinancialProfile } from '@/lib/api'
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
              <div className="h-3 rounded-full bg-white/5 overflow-hidden mb-2">
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
          { icon: Phone, label: 'Call Insurance', action: 'call-insurance' },
          { icon: User, label: 'Call Son', action: 'call-son' },
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
                : 'rgba(255,255,255,0.03)',
              border: item.danger ? 'none' : '1px solid rgba(255,255,255,0.08)',
              backdropFilter: item.danger ? 'none' : 'blur(40px)',
              WebkitBackdropFilter: item.danger ? 'none' : 'blur(40px)',
            }}
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: item.danger ? 'rgba(255,255,255,0.15)' : 'rgba(124,110,240,0.1)' }}>
              <Icon size={24} color={item.danger ? '#fff' : '#7c6ef0'} />
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

  if (!ready || !previous) return null
  const scoreDelta = score - previous.score
  const insightDelta = openInsightCount - previous.openInsightCount
  if (scoreDelta === 0 && insightDelta === 0) return null

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

export default function HomePage() {
  const { config } = useMode()
  const { score: readinessScore, hasLiveData, loading: scoreLoading } = useFamilyReadinessScore()
  const { events: timelineEvents, hasData: hasTimelineData, hasChildren } = useFamilyTimeline()
  const { insights, loading: insightsLoading } = useFamilyInsights()
  const retirementInsight = insights.find((i) => i.detector_id === 'family_retirement_gap')
  const openInsightCount = insights.filter((i) => !RESOLVED_INSIGHT_STATES.includes(i.state)).length
  const setCmdkOpen = useAppStore((s) => s.setCmdkOpen)

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
      <UrgencyBanner />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <GlassCard className="p-5">
          <div className="flex items-center gap-3 mb-3">
            {scoreLoading ? (
              <>
                <Skeleton className="h-20 w-20 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </>
            ) : hasLiveData ? (
              <>
                <ScoreRing score={readinessScore} size={80} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${readinessScore >= 70 ? 'text-success' : 'text-warning'}`}>
                      {config.simpleLanguage
                        ? simpleHomeCopy({ hasLiveData, onTrack: readinessScore >= 70 }).status
                        : readinessScore >= 70 ? "You're on track" : 'Some insights need review'}
                    </span>
                    <motion.span
                      className={`w-2 h-2 rounded-full ${readinessScore >= 70 ? 'bg-success' : 'bg-warning'}`}
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    {config.simpleLanguage
                      ? simpleHomeCopy({ hasLiveData, onTrack: readinessScore >= 70 }).body
                      : 'Your family readiness score reflects the gaps found in your profile so far. Connect more data sources for a complete picture.'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <ScoreRing score={0} size={80} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-ink-secondary">
                      {config.simpleLanguage ? simpleHomeCopy({ hasLiveData, onTrack: false }).status : 'No data yet'}
                    </span>
                  </div>
                  <p className="text-sm text-ink-tertiary leading-relaxed">
                    {config.simpleLanguage
                      ? simpleHomeCopy({ hasLiveData, onTrack: false }).body
                      : 'Connect your accounts and upload documents to see your real family readiness score.'}
                  </p>
                  <Link href="/upload" className="text-sm text-family-400 font-semibold flex items-center gap-1 mt-2">
                    Get started <ChevronRight size={14} />
                  </Link>
                </div>
              </>
            )}
          </div>
        </GlassCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
      >
        <Link href="/life-events" onClick={() => haptic('light')}>
          <GlassCard className="p-4" interactive>
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
                ? "We don't collect birthdates yet, so we can't estimate education milestones for your children."
                : 'Add children to your family profile to see education milestones and future planning events on your timeline.'}
            </p>
            {!hasChildren && (
              <Link href="/family" className="text-sm text-family-400 font-semibold flex items-center gap-1 mt-2">
                Set up family <ChevronRight size={14} />
              </Link>
            )}
          </GlassCard>
        )}
      </motion.div>

      <IfAdvanced>
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
      </IfAdvanced>

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
    </div>
  )
}
