'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, HelpCircle } from 'lucide-react'
import { LIFE_EVENTS } from '@/lib/life-data'
import { GlassCard, GlassButton, PageHeader } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { useEventReadiness } from '@/lib/useFamilyData'
import { useAuth } from '@/lib/auth-context'

interface Action {
  id: string
  label: string
  done: boolean
}

const EVENT_ACTIONS: Record<string, Action[]> = {
  bereavement: [
    { id: '1', label: 'Call your life insurance provider to start a claim', done: false },
    { id: '2', label: 'Contact employer for survivor benefits', done: false },
    { id: '3', label: 'Notify pension provider for survivor pension', done: false },
    { id: '4', label: 'Check whether your mortgage has protection cover', done: false },
    { id: '5', label: 'Schedule a meeting with a financial advisor', done: false },
  ],
  medical: [
    { id: '1', label: 'Review your health insurance coverage details', done: false },
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

export default function EventDetailClient() {
  const params = useParams<{ eventId: string }>()
  const event = LIFE_EVENTS.find((e) => e.id === params.eventId)
  const [actions, setActions] = useState<Action[]>(
    EVENT_ACTIONS[event?.id ?? 'default'] ?? EVENT_ACTIONS.default!
  )

  const toggleAction = (id: string) => {
    haptic('light')
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, done: !a.done } : a)))
  }

  if (!event) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Event not found</p>
        <Link href="/events" className="text-family-400 font-semibold mt-4 inline-block flex items-center gap-1 justify-center">
          <ArrowLeft size={14} /> Back to events
        </Link>
      </div>
    )
  }

  const fallbackStability = EVENT_STABILITY[event.id] ?? 80
  const fallbackExplanation = EVENT_AI_EXPLANATION[event.id] ?? "This is a sample scenario, not based on your data yet. Connect your accounts and documents to see a personalized readiness assessment for this situation."
  const { stability, explanation, hasLiveData } = useEventReadiness(event.id, fallbackStability, fallbackExplanation)
  const completedCount = actions.filter((a) => a.done).length

  return (
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
          <div className="h-3 rounded-full bg-white/5 overflow-hidden">
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
              whileTap={{ scale: 0.97 }}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.06 }}
              className="w-full glass rounded-2xl p-4 flex items-center gap-3"
            >
              <motion.div
                className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                animate={{
                  backgroundColor: action.done ? '#4ade80' : 'rgba(255,255,255,0.05)',
                  borderColor: action.done ? '#4ade80' : 'rgba(255,255,255,0.1)',
                }}
                style={{ border: '2px solid' }}
              >
                {action.done && <Check size={14} color="#08080c" />}
              </motion.div>
              <span className={`text-sm text-left flex-1 ${action.done ? 'text-ink-tertiary line-through' : 'text-ink-primary'}`}>
                {action.label}
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
        </GlassCard>
      </motion.div>

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
  )
}
