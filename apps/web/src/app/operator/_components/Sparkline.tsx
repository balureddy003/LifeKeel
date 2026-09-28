'use client'

/** Tiny 30-day sparkline — pure SVG, no chart dependency. Points are daily
 *  counts; a flat all-zero series renders as a baseline line. */
export function Sparkline({ points, className = 'text-family-400' }: { points: number[]; className?: string }) {
  const w = 120
  const h = 28
  const max = Math.max(...points, 1)
  const step = points.length > 1 ? w / (points.length - 1) : w
  const coords = points.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={`h-7 w-full ${className}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
    </svg>
  )
}

/** Pivot the overview's activity_30d rows into a dense per-day series —
 *  missing days are zeros so the line doesn't lie about gaps. */
export function seriesFor(rows: Array<{ day: string; event: string; count: number }> | undefined, event: string, days = 30): number[] {
  const counts = new Map((rows ?? []).filter((r) => r.event === event).map((r) => [r.day, r.count]))
  const out: number[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
    out.push(counts.get(d.toISOString().slice(0, 10)) ?? 0)
  }
  return out
}

/** Week-over-week delta chip — "+40% WoW", "−25% WoW", or "±0". */
export function WowDelta({ current, previous }: { current: number; previous: number | undefined }) {
  if (previous === undefined) return null
  if (previous === 0 && current === 0) return <span className="text-xs text-ink-tertiary">±0 WoW</span>
  if (previous === 0) return <span className="text-xs text-success">new this week</span>
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return <span className="text-xs text-ink-tertiary">±0 WoW</span>
  const up = pct > 0
  return <span className={`text-xs font-medium ${up ? 'text-success' : 'text-danger'}`}>{up ? '+' : '−'}{Math.abs(pct)}% WoW</span>
}
