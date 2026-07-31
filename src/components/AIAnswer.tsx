'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Bot, FileText, TrendingUp, Landmark, Calculator, Shield, GraduationCap, Wallet, Briefcase, Home, Paperclip, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard } from './Glass'
import { haptic } from '@/lib/haptics'

interface AISource {
  label: string
  type: 'policy' | 'account' | 'document' | 'calculation'
  icon: LucideIcon
}

interface AIAnswer {
  query: string
  answer: string
  sources: AISource[]
  confidence: 'high' | 'medium' | 'low'
  followUps: string[]
}

const MOCK_ANSWERS: Record<string, AIAnswer> = {
  'retire': {
    query: 'Can I retire at 55?',
    answer: "A projection based on your data suggests that retiring at 55 may be possible with adjustments to your savings rate. Your current trajectory estimates retirement around 65. One scenario shows that increasing monthly retirement contributions by $800 could shift that to approximately 55. At 55, the projection estimates roughly $1.6M saved, which could translate to about $64,000/year. Your mortgage may also be paid off by then. These are estimates and not guaranteed — consider reviewing with a qualified financial professional.",
    sources: [
      { label: 'Pension Statement (Q3 2026)', type: 'document', icon: FileText },
      { label: 'Investment Account — Vanguard', type: 'account', icon: TrendingUp },
      { label: 'Mortgage — First National', type: 'account', icon: Landmark },
      { label: 'Retirement projection model', type: 'calculation', icon: Calculator },
    ],
    confidence: 'medium',
    followUps: ['What about inflation?', 'When is my mortgage paid off?', 'How do I consult a financial planner?'],
  },
  'protected': {
    query: 'Are my children fully protected?',
    answer: "Based on the data you entered, your children appear to have significant coverage. Life insurance lists $750,000 for upbringing and education. Emma's university fund is 72% of the $120,000 target ($86,400) and Lucas's is 45% ($54,000). Both have future goals insurance. One option to consider: critical illness coverage for Lucas. Please consult a licensed insurance professional to evaluate whether this is appropriate.",
    sources: [
      { label: 'Life Insurance Policy #LI-2024-001', type: 'policy', icon: Shield },
      { label: "Emma's Education Fund", type: 'account', icon: GraduationCap },
      { label: "Lucas's Education Fund", type: 'account', icon: GraduationCap },
    ],
    confidence: 'medium',
    followUps: ['What is critical illness coverage?', 'How much is left for Lucas?', 'Show me the insurance policies'],
  },
  'job': {
    query: 'What happens if I lose my job?',
    answer: "Based on the information you entered, one projection estimates your family may be covered for approximately 14 months. You have $55,000 in emergency savings (estimated 14 months of expenses), income protection insurance listing $5,000/month for up to 2 years, and your wife's salary may cover basic expenses. This is an estimate based on your inputs — consider reviewing with a qualified professional.",
    sources: [
      { label: 'Emergency Savings Account', type: 'account', icon: Wallet },
      { label: 'Income Protection Policy', type: 'policy', icon: Briefcase },
      { label: 'Monthly expense analysis', type: 'calculation', icon: Calculator },
    ],
    confidence: 'medium',
    followUps: ['How long would savings last?', 'What about health insurance?', 'Show me the budget'],
  },
}

function getAnswer(query: string): AIAnswer {
  const lower = query.toLowerCase()
  for (const [key, answer] of Object.entries(MOCK_ANSWERS)) {
    if (lower.includes(key)) return answer
  }
  return {
    query,
    answer: "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?",
    sources: [
      { label: 'Family Profile', type: 'document', icon: Home },
    ],
    confidence: 'medium',
    followUps: ['Show me my insurance policies', 'What is my net worth?', 'How is my retirement looking?'],
  }
}

const confidenceColor = { high: '#4ade80', medium: '#fbbf24', low: '#f87171' }
const sourceTypeColor: Record<string, string> = {
  policy: 'rgba(248,113,113,0.15)',
  account: 'rgba(96,165,250,0.15)',
  document: 'rgba(168,139,250,0.15)',
  calculation: 'rgba(251,191,36,0.15)',
}

export function AIAnswerCard({ query }: { query: string }) {
  const [showSources, setShowSources] = useState(false)
  const answer = getAnswer(query)
  const color = confidenceColor[answer.confidence]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <GlassCard className="p-5">
        {/* Query */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm text-ink-tertiary">You asked:</span>
          <span className="text-sm font-semibold text-ink-primary">"{answer.query}"</span>
        </div>

        {/* Answer */}
        <div className="flex items-start gap-2 mb-4">
          <div className="w-7 h-7 rounded-xl bg-family-500/10 border border-family-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Bot size={14} className="text-family-400" />
          </div>
          <p className="text-sm text-ink-secondary leading-relaxed">{answer.answer}</p>
        </div>

        {/* Confidence */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary">Confidence</span>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-xs font-semibold" style={{ color }}>
              {answer.confidence === 'high' ? 'High — based on your documents' : answer.confidence === 'medium' ? 'Medium — some data missing' : 'Low — please verify'}
            </span>
          </div>
        </div>

        {/* Sources */}
        <div className="border-t border-white/5 pt-3">
          <button
            onClick={() => { setShowSources(!showSources); haptic('light') }}
            className="flex items-center gap-2 text-xs text-ink-tertiary"
          >
            <span className="font-semibold flex items-center gap-1">
              <Paperclip size={12} /> Sources ({answer.sources.length})
            </span>
            <motion.span animate={{ rotate: showSources ? 90 : 0 }}>
              <ChevronRight size={12} />
            </motion.span>
          </button>
          <AnimatePresence>
            {showSources && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="space-y-1.5 pt-2">
                  {answer.sources.map((source, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ background: sourceTypeColor[source.type] ?? 'rgba(255,255,255,0.03)' }}
                    >
                      <source.icon size={14} className="text-ink-secondary flex-shrink-0" />
                      <span className="text-xs text-ink-secondary flex-1">{source.label}</span>
                      <span className="text-[10px] text-ink-tertiary uppercase">{source.type}</span>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Follow-ups */}
        <div className="border-t border-white/5 pt-3 mt-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-tertiary mb-2">Related questions</div>
          <div className="flex flex-wrap gap-2">
            {answer.followUps.map((q) => (
              <button
                key={q}
                onClick={() => haptic('light')}
                className="glass rounded-full px-3 py-1.5 text-xs text-ink-secondary whitespace-nowrap"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}
