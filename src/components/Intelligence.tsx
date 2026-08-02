'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { GlassCard } from './Glass'
import { haptic } from '@/lib/haptics'
import { useAppStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-context'
import { useFamilyInsights } from '@/lib/useFamilyData'
import { Brain, TrendingUp, FileText, Landmark, Mail, BarChart3, Scale, Car, Check, AlertTriangle, X, Sparkles, ChevronRight, Users, Heart, Wallet, Target, Shield } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo } from 'react'

const AREA_ICONS: Record<string, LucideIcon> = {
  family: Users,
  protection: Heart,
  wealth: Wallet,
  goals: Target,
  documents: FileText,
  estate: Scale,
}

const statusColor = (status: 'complete' | 'partial' | 'missing') => {
  const colors = { complete: '#4ade80', partial: '#fbbf24', missing: '#f87171' }
  return colors[status]
}

const statusIcon = (status: 'complete' | 'partial' | 'missing') => {
  if (status === 'complete') return <Check size={12} color="#4ade80" />
  if (status === 'partial') return <AlertTriangle size={12} color="#fbbf24" />
  return <X size={12} color="#f87171" />
}

export function ConfidenceScore() {
  const router = useRouter()
  const { family } = useAuth()
  const { insights } = useFamilyInsights()
  const uploadedDocumentCount = useAppStore((s) => s.uploadedDocumentCount)
  const connectedConnectors = useAppStore((s) => s.connectedConnectors)

  const { areas, overall } = useMemo(() => {
    const hasFamily = (family?.members?.length ?? 0) > 0
    const hasInsights = insights.length > 0
    const protectionInsights = insights.filter((i) => i.detector_id === 'family_protection_gap')
    const wealthInsights = insights.filter((i) => i.detector_id === 'family_retirement_gap')
    const goalsInsights = insights.filter((i) => i.detector_id === 'family_education_shortfall')

    const computeStatus = (progress: number): 'complete' | 'partial' | 'missing' => {
      if (progress >= 80) return 'complete'
      if (progress > 0) return 'partial'
      return 'missing'
    }

    const familyProgress = hasFamily ? 100 : 0
    const protectionProgress = protectionInsights.length > 0 ? 75 : 0
    const wealthProgress = wealthInsights.length > 0 ? 60 : 0
    const goalsProgress = goalsInsights.length > 0 ? 80 : 0
    const docsProgress = Math.min(uploadedDocumentCount * 20, 100)
    const estateProgress = 0

    const computedAreas = [
      { id: 'family', label: 'Family', status: computeStatus(familyProgress), progress: familyProgress, missingItems: hasFamily ? undefined : ['Add family members'] },
      { id: 'protection', label: 'Protection', status: computeStatus(protectionProgress), progress: protectionProgress, missingItems: protectionInsights.length === 0 ? ['Upload insurance documents'] : undefined },
      { id: 'wealth', label: 'Wealth', status: computeStatus(wealthProgress), progress: wealthProgress, missingItems: wealthInsights.length === 0 ? ['Connect investment accounts'] : undefined },
      { id: 'goals', label: 'Goals', status: computeStatus(goalsProgress), progress: goalsProgress, missingItems: goalsInsights.length === 0 ? ['Add education goals'] : undefined },
      { id: 'documents', label: 'Documents', status: computeStatus(docsProgress), progress: docsProgress, missingItems: uploadedDocumentCount === 0 ? ['Upload documents'] : undefined },
      { id: 'estate', label: 'Estate Planning', status: computeStatus(estateProgress), progress: estateProgress, missingItems: ['Upload will and estate docs'] },
    ]
    const overallScore = Math.round(computedAreas.reduce((sum, a) => sum + a.progress, 0) / computedAreas.length)
    return { areas: computedAreas, overall: overallScore }
  }, [family, insights, uploadedDocumentCount])

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-ink-secondary">Data Confidence</div>
          <div className="text-xs text-ink-tertiary mt-0.5">How well we know your family</div>
        </div>
        <div className="flex items-center gap-2">
          <motion.span
            className="text-3xl font-bold"
            style={{ color: overall >= 80 ? '#4ade80' : overall > 0 ? '#fbbf24' : '#f87171' }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            {overall}%
          </motion.span>
        </div>
      </div>

      <div className="h-3 rounded-full bg-white/[0.05] overflow-hidden mb-4">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: 'linear-gradient(90deg, #4ade80, #fbbf24, #f87171)',
            boxShadow: '0 0 12px rgba(124,110,240,0.3)',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${overall}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </div>

      <div className="space-y-2">
        {areas.map((area, i) => {
          const color = statusColor(area.status)
          return (
            <motion.div
              key={area.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              className="flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                {(() => {
                  const AreaIcon = AREA_ICONS[area.id] ?? FileText
                  return <AreaIcon size={14} className="text-ink-secondary" />
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{area.label}</span>
                  <span
                    className="text-xs font-bold flex items-center gap-1"
                    style={{ color }}
                  >
                    {statusIcon(area.status)} {area.progress}%
                  </span>
                </div>
                {area.missingItems && area.missingItems.length > 0 && (
                  <div className="text-xs text-ink-tertiary mt-0.5">
                    {area.missingItems.join(' · ')}
                  </div>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>

      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={() => { haptic('light'); router.push('/upload') }}
        className="w-full mt-4 glass rounded-2xl py-3 text-sm font-semibold text-family-400 flex items-center justify-center gap-1"
      >
        Complete your profile <ChevronRight size={14} />
      </motion.button>
    </GlassCard>
  )
}

export function TrustLadder() {
  const router = useRouter()
  const connectedConnectors = useAppStore((s) => s.connectedConnectors)
  const uploadedDocumentCount = useAppStore((s) => s.uploadedDocumentCount)

  const steps = [
    { id: 'family', icon: Users, label: 'Add Your Family', timeframe: 'Day 1', desc: 'Tell us who\'s in your household', route: '/family' },
    { id: 'documents', icon: FileText, label: 'Upload Documents', timeframe: 'Week 1', desc: 'Snap a photo or upload any document', route: '/upload' },
    { id: 'bank', icon: Landmark, label: 'Connect Bank', timeframe: 'Week 2', desc: 'Securely connect your bank accounts', route: '/connect' },
    { id: 'email', icon: Mail, label: 'Connect Email', timeframe: 'Week 3', desc: 'AI scans for financial documents only', route: '/connect' },
    { id: 'investments', icon: BarChart3, label: 'Connect Investments', timeframe: 'Month 2', desc: 'Link your investment and pension accounts', route: '/connect' },
    { id: 'estate', icon: Scale, label: 'Estate Planning', timeframe: 'Month 3', desc: 'Upload your will and estate documents for secure storage', route: '/upload' },
  ].map((step) => {
    let status: 'done' | 'available' | 'locked' = 'locked'
    if (step.id === 'family') status = 'done'
    else if (step.id === 'documents') status = uploadedDocumentCount > 0 ? 'done' : 'available'
    else if (step.id === 'bank') status = connectedConnectors.includes('open-banking') ? 'done' : 'available'
    else if (step.id === 'email') status = connectedConnectors.includes('gmail') ? 'done' : 'available'
    else if (step.id === 'investments') status = connectedConnectors.some((c) => ['trading212', 'zerodha'].includes(c)) ? 'done' : 'available'
    else if (step.id === 'estate') status = 'available'
    return { ...step, status }
  })

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-1">
        <TrendingUp size={16} className="text-family-400" />
        Trust Ladder
      </div>
      <div className="text-xs text-ink-tertiary mb-4">We build your profile step by step — at your pace</div>

      <div className="space-y-1">
        {steps.map((step, i) => {
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
                      ? 'rgba(124,110,240,0.15)'
                      : 'rgba(255,255,255,0.03)',
                    border: `2px solid ${
                      isDone ? 'rgba(74,222,128,0.4)'
                      : isAvailable ? 'rgba(124,110,240,0.4)'
                      : 'rgba(255,255,255,0.08)'
                    }`,
                  }}
                >
                  {isDone ? <Check size={14} color="#4ade80" /> : <Icon size={14} className={isAvailable ? 'text-family-400' : 'text-ink-tertiary'} />}
                </div>
                {i < 5 && (
                  <div
                    className="w-px h-6"
                    style={{ background: isDone ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.05)' }}
                  />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${isDone ? 'text-success' : isAvailable ? 'text-family-400' : 'text-ink-tertiary'}`}>
                    {step.label}
                  </span>
                  <span className="text-[10px] text-ink-tertiary">{step.timeframe}</span>
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
    </GlassCard>
  )
}

export function MemoryPrompts() {
  const router = useRouter()
  const prompts = [
    {
      id: 'car',
      icon: Car,
      title: 'I noticed something new',
      message: 'I see a new vehicle in your transactions. Upload your insurance and registration so I can track it properly.',
      action: 'Add vehicle',
      route: '/upload',
    },
    {
      id: 'pension',
      icon: Landmark,
      title: 'We found a pension statement',
      message: 'I found a pension document in your uploads. Should I add it to your retirement planning?',
      action: 'Review',
      route: '/upload?category=pension',
    },
  ]

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-2 px-1">
        <Sparkles size={16} className="text-family-400" />
        AI Memory
      </div>
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
                    onClick={() => haptic('light')}
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
