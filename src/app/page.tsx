'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Network, Activity, Lightbulb, ChevronRight, Hand, Star, Target, Mail, Bot, Phone, User, FileText, Siren, Sparkles } from 'lucide-react'
import { KnowledgeGraph } from '@/components/KnowledgeGraph'
import { LifeTimeline } from '@/components/LifeTimeline'
import { ScoreRing, GlassCard, PageHeader } from '@/components/Glass'
import { ConfidenceScore, TrustLadder, MemoryPrompts } from '@/components/Intelligence'
import { HealthSummary } from '@/components/HealthSummary'
import { TIMELINE_EVENTS, FAMILY_STORY, FAMILY_HEALTH_SCORE, CHILD_GOALS, CHILD_MESSAGES } from '@/lib/life-data'
import { useMode } from '@/lib/mode-context'

function ChildHome() {
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
        <h1 className="text-2xl font-bold">Hi Emma!</h1>
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
  return (
    <div className="px-4 pt-6 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <h1 className="text-3xl font-bold mb-2">You're Safe</h1>
        <p className="text-xl text-ink-tertiary">Your family is protected</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2 }}
        className="flex justify-center"
      >
        <ScoreRing score={FAMILY_HEALTH_SCORE} size={160} />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-lg text-center text-ink-secondary leading-relaxed px-4"
      >
        {FAMILY_STORY}
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

export default function HomePage() {
  const { config } = useMode()

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
          <span className="text-[10px] text-ink-tertiary glass rounded-md px-2 py-0.5">⌘K</span>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <GlassCard className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <ScoreRing score={FAMILY_HEALTH_SCORE} size={80} />
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
                {FAMILY_STORY}
              </p>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
          <Network size={16} className="text-family-400" />
          Knowledge Graph
        </div>
        <KnowledgeGraph />
      </motion.div>

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
        <LifeTimeline events={TIMELINE_EVENTS} />
      </motion.div>

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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <GlassCard className="p-5 border-family-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={18} className="text-family-400" />
            <span className="text-sm font-semibold text-family-400">What you should do</span>
          </div>
          <p className="text-sm text-ink-secondary leading-relaxed mb-3">
            Add $250/month to your retirement savings to stay on track for retirement at 60. Everything else is looking great!
          </p>
          <Link
            href="/events/retirement"
            className="text-sm text-family-400 font-semibold flex items-center gap-1"
          >
            See retirement plan <ChevronRight size={14} />
          </Link>
        </GlassCard>
      </motion.div>
    </div>
  )
}
