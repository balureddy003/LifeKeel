'use client'

/**
 * SVG savings-trajectory sparkline for scenario results.
 * Renders the timeline's atMonth → savingsMinor series as a simple
 * area chart — no chart library, consistent with the ScoreRing's
 * hand-rolled SVG approach.
 */

import { motion } from 'framer-motion'

interface TimelinePoint {
  atMonth: number
  savingsMinor: number
  runwayMonths: number | null
}

export function ScenarioTimeline({
  timeline,
  fundDepletedAtMonth,
}: {
  timeline: TimelinePoint[]
  fundDepletedAtMonth: number | null
}) {
  if (!timeline || timeline.length < 2) return null

  const W = 280
  const H = 108
  const PAD_X = 16
  const PAD_TOP = 26
  const PAD_BOTTOM = 26

  const maxMonth = Math.max(...timeline.map((p) => p.atMonth))
  const maxSavings = Math.max(...timeline.map((p) => p.savingsMinor))
  const minSavings = Math.min(...timeline.map((p) => p.savingsMinor))
  const range = maxSavings - minSavings || 1

  const toX = (month: number) => PAD_X + (month / maxMonth) * (W - PAD_X * 2)
  const toY = (savings: number) =>
    PAD_TOP + (1 - (savings - minSavings) / range) * (H - PAD_TOP - PAD_BOTTOM)

  // Build the path — smooth curve through points
  const points = timeline.map((p) => ({ x: toX(p.atMonth), y: toY(p.savingsMinor) }))
  const linePath = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ')

  // Area fill under the line
  const areaPath = `${linePath} L${points[points.length - 1]!.x},${H - PAD_BOTTOM} L${points[0]!.x},${H - PAD_BOTTOM} Z`

  // Depletion marker — where the fund hits zero
  const depleted =
    fundDepletedAtMonth !== null && fundDepletedAtMonth <= maxMonth
      ? toX(fundDepletedAtMonth)
      : null

  // Color: red if fund depletes, amber if declining, green if stable/growing
  const isDepleted = fundDepletedAtMonth !== null
  const isDeclining = timeline[timeline.length - 1]!.savingsMinor < timeline[0]!.savingsMinor
  const strokeColor = isDepleted ? '#ffafa3' : isDeclining ? '#ffda87' : '#92e1d7'

  const fmt = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

  return (
    <div className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Savings trajectory: starts at ${fmt(timeline[0]!.savingsMinor)}, ends at ${fmt(timeline[timeline.length - 1]!.savingsMinor)} after ${maxMonth} months`}
      >
        {/* Area fill */}
        <motion.path
          d={areaPath}
          fill={strokeColor}
          fillOpacity={0.08}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        />

        {/* Trajectory line */}
        <motion.path
          d={linePath}
          fill="none"
          stroke={strokeColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />

        {/* Data points */}
        {points.map((p, i) => (
          <motion.circle
            key={timeline[i]!.atMonth}
            cx={p.x}
            cy={p.y}
            r={3}
            fill={strokeColor}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 + i * 0.1 }}
          />
        ))}

        {/* Fund depletion marker */}
        {depleted !== null && (
          <motion.line
            x1={depleted}
            y1={PAD_TOP}
            x2={depleted}
            y2={H - PAD_BOTTOM}
            stroke="#ffafa3"
            strokeWidth={1}
            strokeDasharray="3 3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            transition={{ delay: 0.8 }}
          />
        )}

        {/* Month labels */}
        {timeline
          .filter(
            (_, index) =>
              index === 0 ||
              index === timeline.length - 1 ||
              index % Math.ceil((timeline.length - 1) / 3) === 0,
          )
          .map((p) => (
            <text
              key={`label-${p.atMonth}`}
              x={toX(p.atMonth)}
              y={H - 4}
              textAnchor={
                p.atMonth === timeline[0]!.atMonth
                  ? 'start'
                  : p.atMonth === maxMonth
                    ? 'end'
                    : 'middle'
              }
              className="fill-ink-tertiary"
              fontSize={16}
            >
              {p.atMonth === 0 ? 'now' : `mo ${p.atMonth}`}
            </text>
          ))}

        {/* Value labels at first and last points */}
        <text
          x={points[0]!.x}
          y={points[0]!.y - 6}
          textAnchor="start"
          className="fill-ink-secondary"
          fontSize={16}
          fontWeight={600}
        >
          {fmt(timeline[0]!.savingsMinor)}
        </text>
        <text
          x={points[points.length - 1]!.x}
          y={points[points.length - 1]!.y - 6}
          textAnchor="end"
          className="fill-ink-secondary"
          fontSize={16}
          fontWeight={600}
        >
          {fmt(timeline[timeline.length - 1]!.savingsMinor)}
        </text>

        {/* Depletion label */}
        {depleted !== null && (
          <text
            x={Math.min(W - 42, Math.max(42, depleted))}
            y={PAD_TOP - 2}
            textAnchor="middle"
            fill="#ffafa3"
            fontSize={16}
            fontWeight={600}
          >
            fund out
          </text>
        )}
      </svg>
    </div>
  )
}
