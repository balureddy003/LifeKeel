'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Heart, Wallet, Target, PiggyBank } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard, SkeletonCard } from './Glass'
import { haptic } from '@/lib/haptics'
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
  const offset = circumference - (progress / 100) * circumference

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
            {progress}%
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

  if (loading) {
    return <SkeletonCard lines={4} />
  }

  const domainKeys = Object.keys(DOMAIN_META) as HealthDomain[]
  const overallScore = Math.round(
    domainKeys.reduce((sum, d) => sum + domains[d].score, 0) / domainKeys.length,
  )
  const anySample = domainKeys.some((d) => !domains[d].hasLiveData)

  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-ink-secondary">Family Health</div>
          <div className="text-xs text-ink-tertiary">
            Across protection, wealth & goals
            {anySample && <span className="text-warning"> · some sample data</span>}
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
