'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { Heart, Wallet, Target, PiggyBank, TrendingUp, TrendingDown } from 'lucide-react'
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
  label,
  icon: Icon,
  href,
  isSample,
}: {
  progress: number
  size?: number
  strokeWidth?: number
  color: string
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
            stroke="rgba(255,255,255,0.05)"
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
          <Icon size={16} color={color} strokeWidth={2} />
          <span className="text-xs font-bold" style={{ color }}>
            {progress}%
          </span>
        </div>
      </div>
      <span className="text-[10px] text-ink-tertiary font-semibold flex items-center gap-1">
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

// Sparkline mini chart
function Sparkline({
  data,
  color,
  width = 60,
  height = 24,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((d - min) / range) * height
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="overflow-visible">
      <motion.polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: 'easeOut' }}
      />
    </svg>
  )
}

// Trend indicator
function Trend({ value, positive }: { value: string; positive: boolean }) {
  return (
    <span className={`text-xs font-bold flex items-center gap-0.5 ${positive ? 'text-success' : 'text-danger'}`}>
      {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {value}
    </span>
  )
}

const DOMAIN_META: Record<HealthDomain, { color: string; label: string; icon: LucideIcon }> = {
  protection: { color: '#f87171', label: 'Protection', icon: Heart },
  wealth: { color: '#fbbf24', label: 'Wealth', icon: Wallet },
  goals: { color: '#4ade80', label: 'Goals', icon: Target },
  savings: { color: '#60a5fa', label: 'Savings', icon: PiggyBank },
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
            label={DOMAIN_META[d].label}
            icon={DOMAIN_META[d].icon}
            href={`/health/${d}`}
            isSample={!domains[d].hasLiveData}
          />
        ))}
      </div>

      {/* Sparkline trends — illustrative until historical time-series is available from the API */}
      <div className="space-y-2 mt-4 pt-4 border-t border-white/5">
        <div className="text-[10px] text-ink-tertiary uppercase tracking-wide mb-1">Sample trends</div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-secondary">Net Worth</span>
          <div className="flex items-center gap-2">
            <Sparkline data={[1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.5]} color="#4ade80" />
            <Trend value="+12%" positive={true} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-secondary">Savings Rate</span>
          <div className="flex items-center gap-2">
            <Sparkline data={[20, 22, 25, 23, 28, 30, 32]} color="#60a5fa" />
            <Trend value="+8%" positive={true} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-secondary">Debt Ratio</span>
          <div className="flex items-center gap-2">
            <Sparkline data={[35, 32, 30, 28, 25, 22, 22]} color="#fbbf24" />
            <Trend value="-13%" positive={true} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-ink-secondary">Insurance Coverage</span>
          <div className="flex items-center gap-2">
            <Sparkline data={[60, 65, 70, 75, 80, 85, 90]} color="#f87171" />
            <Trend value="+30%" positive={true} />
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
