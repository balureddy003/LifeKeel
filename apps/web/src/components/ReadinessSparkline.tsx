'use client'

/**
 * Readiness score history sparkline — small SVG line chart showing how
 * the family's score has changed over time. Rendered under the main
 * ScoreRing on the homepage.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { fetchReadinessHistory, type ReadinessHistoryPoint } from '@/lib/api'

export function ReadinessSparkline() {
  const [history, setHistory] = useState<ReadinessHistoryPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchReadinessHistory()
      .then((h) => { if (!cancelled) setHistory(h) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Need at least 3 data points to show a meaningful trend
  if (loading || history.length < 3) return null

  const W = 200
  const H = 36
  const PAD = 2

  const scores = history.map((h) => h.score)
  const minScore = Math.max(0, Math.min(...scores) - 5)
  const maxScore = Math.min(100, Math.max(...scores) + 5)
  const range = maxScore - minScore || 1

  const toX = (i: number) => PAD + (i / (scores.length - 1)) * (W - PAD * 2)
  const toY = (score: number) => PAD + (1 - (score - minScore) / range) * (H - PAD * 2)

  const points = scores.map((s, i) => ({ x: toX(i), y: toY(s) }))
  const path = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ')

  const latest = scores[scores.length - 1]!
  const previous = scores[scores.length - 2]!
  const delta = latest - previous
  const trendColor = delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#b07a14'
  const TrendIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus

  return (
    <motion.div
      className="flex items-center gap-3 mt-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-24 h-9 flex-shrink-0"
        role="img"
        aria-label={`Readiness trend over ${history.length} days`}
      >
        <motion.path
          d={path}
          fill="none"
          stroke={trendColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
        <circle
          cx={points[points.length - 1]!.x}
          cy={points[points.length - 1]!.y}
          r={2.5}
          fill={trendColor}
        />
      </svg>
      <div className="flex items-center gap-1">
        <TrendIcon size={12} style={{ color: trendColor }} />
        <span className="text-xs font-semibold" style={{ color: trendColor }}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
        <span className="text-xs text-ink-tertiary">
          {history.length}d
        </span>
      </div>
    </motion.div>
  )
}
