'use client'

import { motion } from 'framer-motion'
import { Heart, GraduationCap, Palmtree, LifeBuoy, type LucideIcon } from 'lucide-react'
import type { RiskArea } from '@/lib/modes'

const RISK_ICONS: Record<string, LucideIcon> = {
  protection: Heart,
  education: GraduationCap,
  retirement: Palmtree,
  emergency: LifeBuoy,
}

const statusColor = (status: 'green' | 'yellow' | 'red') => {
  const colors = { green: '#4ade80', yellow: '#fbbf24', red: '#f87171' }
  return colors[status]
}

export function RiskBar({ area, index }: { area: RiskArea; index: number }) {
  const color = statusColor(area.status)

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.1, type: 'spring', stiffness: 300, damping: 25 }}
      className="glass rounded-2xl p-4"
    >
      <div className="flex items-center gap-3 mb-3">
        {(() => {
          const Icon = RISK_ICONS[area.id] ?? Heart
          return (
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}15` }}>
              <Icon size={18} color={color} strokeWidth={1.5} />
            </div>
          )
        })()}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{area.label}</span>
            <span className="text-sm font-bold" style={{ color }}>
              {area.progress}%
            </span>
          </div>
          <p className="text-xs text-ink-tertiary mt-0.5">{area.story}</p>
        </div>
      </div>
      <div className="h-3 rounded-full bg-white/[0.05] overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}80` }}
          initial={{ width: 0 }}
          animate={{ width: `${area.progress}%` }}
          transition={{ delay: index * 0.1 + 0.3, duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </motion.div>
  )
}
