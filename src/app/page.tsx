'use client'

import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useState } from 'react'
import { Network, Activity, Lightbulb, ChevronRight, Hand, Star, Target, Mail, Bot, Phone, User, FileText, Siren, Sparkles, Search, CalendarClock, X } from 'lucide-react'
import { KnowledgeGraph } from '@/components/KnowledgeGraph'
import { LifeTimeline } from '@/components/LifeTimeline'
import { ScoreRing, GlassCard, PageHeader, IfAdvanced, Skeleton } from '@/components/Glass'
import { ConfidenceScore, TrustLadder, MemoryPrompts } from '@/components/Intelligence'
import { HealthSummary } from '@/components/HealthSummary'
import { CHILD_GOALS, CHILD_MESSAGES } from '@/lib/life-data'
import { useMode } from '@/lib/mode-context'
import { useFamilyReadinessScore, useFamilyTimeline } from '@/lib/useFamilyData'
import { useAppStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-context'
import { haptic } from '@/lib/haptics'

function ChildHome() {
  const { user } = useAuth()
  const childName = user?.name?.split(' ')[0] ?? 'there'
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
          Your future is looking bright <Star size={12} className="text-family-400" />
        </p>
      </motion.div>

      {CHILD_GOALS.map((goal, i) => (
        <motion.div
          key={goal.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.1 }}
        >
          <GlassCard className="p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-2xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0">
                <Target size={20} className="text-family-400" />
              </div>
              <span className="text-base font-semibold flex-1">{goal.label}</span>
              {goal.progress > 0 && (
                <span className="text-lg font-bold text-family-400">{goal.progress}%</span>
              )}
            </div>
            {goal.progress > 0 && (
              <div className="h-3 rounded-full bg-white/5 overflow-hidden mb-2">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-family-400 to-family-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${goal.progress}%` }}
                  transition={{ delay: i * 0.1 + 0.3, duration: 0.8 }}
                />
              </div>
            )}
            <p className="text-sm text-ink-secondary">{goal.story}</p>
          </GlassCard>
        </motion.div>
      ))}

      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-2 px-1">
          <Mail size={16} className="text-family-400" />
          Messages from Family
        </div>
        {CHILD_MESSAGES.map((msg, i) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <GlassCard className="p-4 mb-2">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-8 h-8 rounded-xl bg-family-500/10 border border-family-500/15 flex items-center justify-center flex-shrink-0">
                  <Sparkles size={14} className="text-family-400" />
                </div>
                <span className="text-sm font-semibold">{msg.from}</span>
                <span className="text-xs text-ink-tertiary ml-auto">{msg.time}</span>
              </div>
              <p className="text-sm text-ink-secondary">{msg.message}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function ElderlyHome() {
  const { score } = useFamilyReadinessScore()
  return (
    <div className="px-4 pt-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-3xl font-bold mb-2">You're Safe</h1>
        <p className="text-xl text-ink-tertiary">Your family appears well covered</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="flex justify-center"
      >
        <ScoreRing score={score} size={160} />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg text-center text-ink-secondary leading-relaxed px-4"
      >
        Welcome back. Your family profile is ready — tap any item below to explore your financial picture.
      </motion.p>

      <div className="space-y-3">
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
  const { events: timelineEvents, hasData: hasTimelineData } = useFamilyTimeline()
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
                    <span className="text-sm font-semibold text-success">You&apos;re on track</span>
                    <motion.span
                      className="w-2 h-2 rounded-full bg-success"
                      animate={{ opacity: [1, 0.3, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    Your family readiness score is based on {readinessScore}% of insights resolved. Connect more data sources for a complete picture.
                  </p>
                </div>
              </>
            ) : (
              <>
                <ScoreRing score={0} size={80} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-ink-secondary">No data yet</span>
                  </div>
                  <p className="text-sm text-ink-tertiary leading-relaxed">
                    Connect your accounts and upload documents to see your real family readiness score.
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

      <IfAdvanced>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
            <Network size={16} className="text-family-400" />
            Knowledge Graph
          </div>
          <div className="h-[420px]">
            <KnowledgeGraph />
          </div>
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
              Add children to your family profile to see education milestones and future planning events on your timeline.
            </p>
            <Link href="/family" className="text-sm text-family-400 font-semibold flex items-center gap-1 mt-2">
              Set up family <ChevronRight size={14} />
            </Link>
          </GlassCard>
        )}
      </motion.div>

      <IfAdvanced>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <ConfidenceScore />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <MemoryPrompts />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
        >
          <TrustLadder />
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
          {hasLiveData ? (
            <>
              <p className="text-sm text-ink-secondary leading-relaxed mb-3">
                Based on your connected data, one projection suggests adding $250/month to your retirement savings may help you stay on track for retirement around 60. This is an estimate — consider reviewing with a qualified financial professional.
              </p>
              <Link
                href="/events/retirement"
                className="text-sm text-family-400 font-semibold flex items-center gap-1"
              >
                See retirement plan <ChevronRight size={14} />
              </Link>
            </>
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
