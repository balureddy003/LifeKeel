'use client'

import { motion } from 'framer-motion'
import { Heart, Wallet, Target, PiggyBank, TrendingUp, TrendingDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard } from './Glass'

// Apple Health-style activity ring
function ActivityRing({
  progress,
  size = 80,
  strokeWidth = 8,
  color,
  label,
  icon: Icon,
}: {
  progress: number
  size?: number
  strokeWidth?: number
  color: string
  label: string
  icon: LucideIcon
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (progress / 100) * circumference

  return (
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
      <span className="text-[10px] text-ink-tertiary font-semibold">{label}</span>
    </div>
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

export function HealthSummary() {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-semibold text-ink-secondary">Family Health</div>
          <div className="text-xs text-ink-tertiary">Across protection, wealth & goals</div>
        </div>
        <div className="text-3xl font-bold text-success">92</div>
      </div>

      {/* Activity rings */}
      <div className="flex items-center justify-around py-4">
        <ActivityRing progress={90} color="#f87171" label="Protection" icon={Heart} />
        <ActivityRing progress={65} color="#fbbf24" label="Wealth" icon={Wallet} />
        <ActivityRing progress={80} color="#4ade80" label="Goals" icon={Target} />
        <ActivityRing progress={85} color="#60a5fa" label="Savings" icon={PiggyBank} />
      </div>

      {/* Sparkline trends */}
      <div className="space-y-2 mt-4 pt-4 border-t border-white/5">
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
