'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Circle, HelpCircle, Wallet, Bot, HeartCrack, Heart, Briefcase, Car, Plane, Home, Baby, GraduationCap, Palmtree, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { RESPONSE_ACTIONS, MONEY_SOURCES, LIFE_EVENTS } from '@/lib/data'
import type { ResponseAction } from '@/lib/types'
import { PageHeader } from '@/components/Glass'
import { useFamilyReadinessScore } from '@/lib/useFamilyData'

const EVENT_ICONS: Record<string, LucideIcon> = {
  bereavement: HeartCrack,
  medical: Heart,
  'job-loss': Briefcase,
  car: Car,
  travel: Plane,
  property: Home,
  'new-child': Baby,
  marriage: Heart,
  university: GraduationCap,
  retirement: Palmtree,
}

const MONEY_ICONS: Record<string, LucideIcon> = {
  'Life Insurance': Wallet,
  'Employer Benefit': Briefcase,
  'Savings': Wallet,
  'Pension': Wallet,
  'default': Wallet,
}

function ActionItem({ action, onToggle }: { action: ResponseAction; onToggle: (id: string) => void }) {
  return (
    <button
      onClick={() => onToggle(action.id)}
      className="w-full flex items-center gap-3 p-4 rounded-2xl bg-surface-1 border border-haze/20 active:scale-95 transition-transform"
    >
      <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
        action.done ? 'bg-success text-white' : 'bg-surface-2 border border-haze/30 text-ink-tertiary'
      }`}>
        {action.done ? <Check size={14} /> : <Circle size={10} />}
      </div>
      <span className={`text-base flex-1 text-left ${action.done ? 'text-ink-tertiary line-through' : 'text-ink-primary'}`}>
        {action.label}
      </span>
    </button>
  )
}

function StabilityBar({ score }: { score: number }) {
  const color = score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : '#f87171'
  return (
    <div className="w-full h-3 rounded-full bg-surface-2 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${score}%`, backgroundColor: color }}
      />
    </div>
  )
}

export default function ResponsePlanPage() {
  const params = useParams<{ eventId: string }>()
  const event = LIFE_EVENTS.find((e) => e.id === params.eventId)
  const [actions, setActions] = useState<ResponseAction[]>(RESPONSE_ACTIONS)
  const { score: readinessScore } = useFamilyReadinessScore()

  const toggleAction = (id: string) => {
    setActions((prev) => prev.map((a) => a.id === id ? { ...a, done: !a.done } : a))
  }

  const completedCount = actions.filter((a) => a.done).length
  const totalCount = actions.length

  if (!event) {
    return (
      <div className="px-4 pt-8 text-center">
        <div className="w-16 h-16 rounded-3xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mb-4 mx-auto">
          <HelpCircle size={32} className="text-ink-tertiary" />
        </div>
        <p className="text-ink-secondary">Event not found</p>
        <Link href="/simulate" className="btn-secondary mt-4 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to What If
        </Link>
      </div>
    )
  }

  return (
    <div className="px-5 pt-2 space-y-5 animate-fade-in">
      <PageHeader
        title={event.label}
        backHref="/simulate"
        subtitle="Here's your family's response plan"
      />

      {/* Family readiness score */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-ink-secondary">Family Readiness</span>
          <span className="text-2xl font-bold" style={{ color: readinessScore >= 80 ? '#4ade80' : '#fbbf24' }}>
            {readinessScore}%
          </span>
        </div>
        <StabilityBar score={readinessScore} />
        <p className="text-xs text-ink-tertiary mt-2">
          Based on the data you entered, your family appears to remain financially stable in this situation. This is an estimate — please consult a qualified professional.
        </p>
      </div>

      {/* Money available */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
          <Wallet size={16} className="text-ink-secondary" />
          Money Available
        </div>
        <div className="space-y-2">
          {MONEY_SOURCES.map((source) => {
            const MoneyIcon = MONEY_ICONS[source.label] ?? MONEY_ICONS.default!
            return (
            <div key={source.label} className="card flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-success/10 border border-success/15 flex items-center justify-center flex-shrink-0">
                <MoneyIcon size={18} className="text-success" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{source.label}</div>
              </div>
              <div className="text-lg font-bold text-success">{source.amount}</div>
            </div>
            )
          })}
        </div>
      </div>

      {/* Actions checklist */}
      <div>
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-sm font-semibold text-ink-secondary flex items-center gap-1">
            <Check size={14} className="text-success" /> Actions to Take
          </span>
          <span className="text-xs text-ink-tertiary">{completedCount}/{totalCount} done</span>
        </div>
        <div className="space-y-2">
          {actions.map((action) => (
            <ActionItem key={action.id} action={action} onToggle={toggleAction} />
          ))}
        </div>
      </div>

      {/* AI explanation */}
      <div className="card bg-gradient-to-br from-surface-1 to-surface-2 border-family-500/20">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center">
            <Bot size={16} className="text-family-400" />
          </div>
          <span className="text-sm font-semibold text-family-400">AI Explanation</span>
        </div>
        <p className="text-sm text-ink-secondary leading-relaxed">
          Your family is well protected for this situation. Life insurance covers $750,000, employer benefits provide an additional $200,000, and you have $55,000 in savings. Your mortgage is protected, and your wife would receive survivor pension benefits. No immediate action is needed — all key contacts have been notified.
        </p>
      </div>

      {/* Ask AI */}
      <Link href="/assistant" className="btn-secondary flex items-center justify-center gap-2 w-full">
        <Bot size={18} className="text-family-400" />
        <span>Ask AI About This</span>
      </Link>
    </div>
  )
}
