'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { useState } from 'react'
import { Heart, Wallet, Target, PiggyBank } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, SkeletonCard } from './Glass'
import { haptic } from '@/lib/haptics'
import { evaluateSavedProfile } from '@/lib/evaluate-profile'
import { useToast } from '@/components/Toast'
import { useFamilyHealthDomains, type HealthDomain } from '@/lib/useFamilyData'

// Apple Health-style activity ring
function ActivityRing({
  progress,
  size = 80,
  strokeWidth = 8,
  color,
  textColor,
  label,
  icon: Icon,
  href,
  isSample,
}: {
  progress: number
  size?: number
  strokeWidth?: number
  color: string
  textColor: string
  label: string
  icon: LucideIcon
  href?: string
  isSample?: boolean
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - ((isSample ? 0 : progress) / 100) * circumference

  const content = (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgb(var(--tint) / 0.05)"
            strokeWidth={strokeWidth}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.5, ease: 'easeOut' }}
            style={{ filter: `drop-shadow(0 0 4px ${color}80)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon size={16} color={textColor} strokeWidth={2} />
          <span className="text-xs font-bold" style={{ color: textColor }}>
            {isSample ? '—' : `${progress}%`}
          </span>
        </div>
      </div>
      <span className="text-caption text-ink-tertiary font-semibold flex items-center gap-1">
        {label}
        {isSample && <span className="w-1 h-1 rounded-full bg-warning" aria-label="Sample data" />}
      </span>
    </div>
  )

  if (!href) return content

  return (
    <Link href={href} onClick={() => haptic('light')} aria-label={`View ${label} details`}>
      {content}
    </Link>
  )
}

// `color` stays a hex literal — it feeds `${color}80` alpha math for the
// ring glow, which a var() string can't survive. `textColor` is the
// theme-aware twin used for the percentage text and icon: the pastel
// literals are decorative on dark but fail WCAG AA as text on the light
// background, so they come from the semantic vars instead (same hues).
const DOMAIN_META: Record<HealthDomain, { color: string; textColor: string; label: string; icon: LucideIcon }> = {
  protection: { color: '#f87171', textColor: 'rgb(var(--danger))', label: 'Protection', icon: Heart },
  wealth: { color: '#fbbf24', textColor: 'rgb(var(--warning))', label: 'Wealth', icon: Wallet },
  goals: { color: '#4ade80', textColor: 'rgb(var(--success))', label: 'Goals', icon: Target },
  savings: { color: '#60a5fa', textColor: 'rgb(var(--info))', label: 'Savings', icon: PiggyBank },
}

export function HealthSummary() {
  const { domains, loading } = useFamilyHealthDomains()
  const toast = useToast()
  const [analysing, setAnalysing] = useState(false)

  const analyse = async () => {
    haptic('light')
    setAnalysing(true)
    try {
      const n = await evaluateSavedProfile()
      toast({ message: n > 0 ? `Found ${n} thing${n === 1 ? '' : 's'} worth a look` : 'Analysis done — no gaps found' })
      window.location.reload()
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Could not analyse your profile', variant: 'error' })
      setAnalysing(false)
    }
  }

  if (loading) {
    return <SkeletonCard lines={4} />
  }

  const domainKeys = Object.keys(DOMAIN_META) as HealthDomain[]
  // Only domains that were actually assessed count toward the overall
  // number — a placeholder score isn't evidence of anything.
  const liveKeys = domainKeys.filter((d) => domains[d].hasLiveData)
  const overallScore = Math.round(
    liveKeys.reduce((sum, d) => sum + domains[d].score, 0) / liveKeys.length,
  )
  const anySample = domainKeys.some((d) => !domains[d].hasLiveData)

  // Nothing evaluated yet: showing four rings of placeholder scores reads
  // as a real health verdict. Say what's missing instead.
  if (domainKeys.every((d) => !domains[d].hasLiveData)) {
    return (
      <GlassCard className="p-5">
        <div className="text-sm font-semibold text-ink-secondary">Family Health</div>
        <div className="text-xs text-ink-tertiary mt-1">
          Your health across protection, wealth and goals appears once your financial profile is finished.
        </div>
        <div className="mt-3 flex items-center gap-4">
          <button
            onClick={analyse}
            disabled={analysing}
            className="px-4 py-2 rounded-full bg-family-500 text-white text-sm font-semibold active:opacity-80 disabled:opacity-60"
          >
            {analysing ? 'Analysing…' : 'Analyse what I’ve entered'}
          </button>
          <Link href="/financial-profile" className="text-sm font-semibold text-family-400 active:opacity-70">
            Edit profile
          </Link>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-ink-secondary">Family Health</div>
          <div className="text-xs text-ink-tertiary">
            Across protection, wealth & goals
            {anySample && <span className="text-warning"> · — means not set up yet</span>}
          </div>
        </div>
        <div className="text-3xl font-bold text-success">{overallScore}</div>
      </div>

      {/* Activity rings */}
      <div className="flex items-center justify-around py-4">
        {domainKeys.map((d) => (
          <ActivityRing
            key={d}
            progress={domains[d].score}
            color={DOMAIN_META[d].color}
            textColor={DOMAIN_META[d].textColor}
            label={DOMAIN_META[d].label}
            icon={DOMAIN_META[d].icon}
            href={`/health/${d}`}
            isSample={!domains[d].hasLiveData}
          />
        ))}
      </div>

    </GlassCard>
  )
}
