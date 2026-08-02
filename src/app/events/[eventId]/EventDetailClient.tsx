'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Bot, Check, HelpCircle } from 'lucide-react'
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
    { id: '1', label: 'Call life insurance provider (Policy #LI-2024-001)', done: false },
    { id: '2', label: 'Contact employer for survivor benefits', done: false },
    { id: '3', label: 'Notify pension provider for survivor pension', done: false },
    { id: '4', label: 'Mortgage is protected — no action needed', done: true },
    { id: '5', label: 'Schedule meeting with financial advisor', done: false },
  ],
  medical: [
    { id: '1', label: 'Health insurance covers up to $1M (deductible: $500)', done: false },
    { id: '2', label: 'Pre-authorization may be needed for surgery', done: false },
    { id: '3', label: 'Out-of-pocket max: $5,000/year', done: false },
    { id: '4', label: 'HSA balance: $8,200 available', done: false },
  ],
  'job-loss': [
    { id: '1', label: 'Emergency savings: $55,000 (14 months)', done: false },
    { id: '2', label: 'Income protection: $5,000/month for 2 years', done: false },
    { id: '3', label: 'Review budget and cut non-essential spending', done: false },
    { id: '4', label: 'Update resume and start job search', done: false },
    { id: '5', label: 'Check eligibility for unemployment benefits', done: false },
  ],
  retirement: [
    { id: '1', label: 'Pension is 55% of target for retirement at 60', done: false },
    { id: '2', label: 'Adding $300/month keeps you on track', done: false },
    { id: '3', label: 'Employer match is fully utilized — no action needed', done: true },
    { id: '4', label: 'Check state pension forecast', done: false },
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
  bereavement: "Based on the data you entered, if something were to happen to you, your family's listed benefits include $750,000 from life insurance, $200,000 from employer benefits, and potential survivor pension payments. Your mortgage protection is listed as active. All key contacts have been noted in your profile. This is a summary of your documented coverage — please consult a licensed professional to review the terms.",
  medical: "Based on your entered policies, your health insurance lists coverage for most medical emergencies. You'd typically pay a deductible and the insurance may cover the rest — up to $1 million per year. For surgery, the hospital may need to confirm with your insurer first. You also have $8,200 listed in a Health Savings Account for out-of-pocket costs. Please verify current terms with your insurance provider.",
  'job-loss': "Based on the information you entered, one projection estimates your family may be covered for approximately 14 months. You have $55,000 in savings (estimated 14 months of expenses) and income protection insurance listing $5,000/month for up to 2 years. This is an estimate based on your inputs — consider reviewing with a qualified professional.",
  retirement: "Based on the data you entered, your pension is currently at 55% of the target needed to retire at 60. Your employer match is fully utilized. One projection suggests adding $300/month would keep you on track for that target. This is an estimate based on your inputs, not a guarantee — consider reviewing your retirement plan with a qualified financial professional.",
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
  const fallbackExplanation = EVENT_AI_EXPLANATION[event.id] ?? "Based on the data you entered, your family appears well prepared for this situation. Your listed insurance, savings, and investments may provide multiple layers of coverage. This is informational only — please consult a licensed professional to review your specific terms."
  const { stability, explanation } = useEventReadiness(event.id, fallbackStability, fallbackExplanation)
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
