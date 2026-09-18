'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useEffect, useId } from 'react'
import { Bot, FileText, TrendingUp, Landmark, Calculator, Shield, GraduationCap, Wallet, Briefcase, Home, Paperclip, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, MoneyText } from './Glass'
import { haptic } from '@/lib/haptics'
import { fetchFamilyInsights } from '@/lib/api'

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
    answer: "Based on the information you entered, one projection estimates your family may be covered for approximately 14 months. You have $55,000 in emergency savings (estimated 14 months of expenses) and income protection insurance listing $5,000/month for up to 2 years. This is an estimate based on your inputs — consider reviewing with a qualified professional.",
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

// Same 3 topics MOCK_ANSWERS covers, mapped to the detector that already
// computes a real answer for that topic elsewhere in the app (Events pages
// use the same detectors via useEventReadiness). Letting the Assistant
// reuse that real, already-computed reasoning — instead of always
// returning canned text — is what actually delivers on "connect your data
// for a personalized response," without needing an LLM backend.
//
// preferredRuleId matters because a detector can fire more than one rule
// at once — family_emergency_fund_adequacy alone covers both "less than 3
// months saved" and "unaddressed high-interest debt". Picking the first
// matching insight regardless of which rule produced it was a real, found
// bug: asking "what happens if I lose my job?" surfaced the high-interest-
// debt insight instead of the emergency-fund-coverage one, confidently
// labeled "based on your documents" while answering a different question
// than the one asked.
const KEYWORD_DETECTOR: Record<string, { detectorId: string; preferredRuleId?: string }> = {
  retire: { detectorId: 'family_retirement_gap' },
  protected: { detectorId: 'family_protection_gap', preferredRuleId: 'life_insurance_below_household_needs' },
  job: { detectorId: 'family_emergency_fund_adequacy', preferredRuleId: 'emergency_fund_below_3_months' },
}

function confidenceBucket(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.75) return 'high'
  if (score >= 0.45) return 'medium'
  return 'low'
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
  // Multiple AIAnswerCards render on one page (each chat message gets its
  // own) — a static id would collide across instances and break
  // aria-controls resolution to just the first one on the page.
  const sourcesPanelId = useId()
  const [liveAnswer, setLiveAnswer] = useState<AIAnswer | null>(null)
  const [checkedLive, setCheckedLive] = useState(false)

  useEffect(() => {
    let cancelled = false
    const lower = query.toLowerCase()
    const mapping = Object.entries(KEYWORD_DETECTOR).find(([key]) => lower.includes(key))?.[1]
    if (!mapping) {
      setCheckedLive(true)
      return
    }
    fetchFamilyInsights()
      .then((insights) => {
        if (cancelled) return
        const candidates = insights.filter((i) => i.detector_id === mapping.detectorId)
        const match = candidates.find((i) => i.rule_id === mapping.preferredRuleId) ?? candidates[0]
        if (match && (match.reasoning || match.hypothesis)) {
          setLiveAnswer({
            query,
            answer: match.reasoning || match.hypothesis,
            sources: [{ label: 'Your Financial Profile', type: 'document', icon: Home }],
            confidence: confidenceBucket(match.confidence),
            followUps: match.actions.slice(0, 3),
          })
        }
      })
      .finally(() => { if (!cancelled) setCheckedLive(true) })
    return () => { cancelled = true }
  }, [query])

  const isLive = !!liveAnswer
  const answer = liveAnswer ?? getAnswer(query)
  const color = confidenceColor[answer.confidence]

  if (!checkedLive) {
    return (
      <GlassCard className="p-5">
        <div className="shimmer h-4 rounded mb-2 w-2/3" />
        <div className="shimmer h-3 rounded mb-1.5" />
        <div className="shimmer h-3 rounded w-5/6" />
      </GlassCard>
    )
  }

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
          <p className="text-sm text-ink-secondary leading-relaxed"><MoneyText text={answer.answer} /></p>
        </div>

        {/* Confidence / Source label */}
        <div className="flex items-center gap-2 mb-3">
          {isLive ? (
            <>
              <span className="text-caption font-bold uppercase tracking-wider text-ink-tertiary">Confidence</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-xs font-semibold" style={{ color }}>
                  {answer.confidence === 'high' ? 'High — based on your documents' : answer.confidence === 'medium' ? 'Medium — some data missing' : 'Low — please verify'}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-warning" />
              <span className="text-xs font-semibold text-warning">
                Sample answer — connect your data for a personalized response
              </span>
            </div>
          )}
        </div>

        {/* Sources — in sample mode there's nothing real to cite yet, so
            don't invent specific document names, just say so honestly. */}
        <div className="border-t border-tint/5 pt-3">
          <button
            onClick={() => { setShowSources(!showSources); haptic('light') }}
            aria-expanded={showSources}
            aria-controls={sourcesPanelId}
            className="flex items-center gap-2 text-xs text-ink-tertiary"
          >
            <span className="font-semibold flex items-center gap-1">
              <Paperclip size={12} /> {isLive ? `Sources (${answer.sources.length})` : 'Sources'}
            </span>
            <motion.span animate={{ rotate: showSources ? 90 : 0 }}>
              <ChevronRight size={12} />
            </motion.span>
          </button>
          <AnimatePresence>
            {showSources && (
              <motion.div
                id={sourcesPanelId}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                {isLive ? (
                  <div className="space-y-1.5 pt-2">
                    {answer.sources.map((source, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.06 }}
                        className="flex items-center gap-2 rounded-lg px-3 py-2"
                        style={{ background: sourceTypeColor[source.type] ?? 'rgb(var(--tint) / 0.03)' }}
                      >
                        <source.icon size={14} className="text-ink-secondary flex-shrink-0" />
                        <span className="text-xs text-ink-secondary flex-1">{source.label}</span>
                        <span className="text-caption text-ink-tertiary uppercase">{source.type}</span>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-tertiary pt-2 leading-relaxed">
                    Sources unlock once your documents and accounts are connected — there's nothing real to cite yet.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Follow-ups */}
        <div className="border-t border-tint/5 pt-3 mt-3">
          <div className="text-caption font-bold uppercase tracking-wider text-ink-tertiary mb-2">Related questions</div>
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
