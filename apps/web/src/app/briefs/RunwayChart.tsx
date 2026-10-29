/**
 * A small picture of the same numbers the solver returned: savings month by
 * month, with the point where they reach zero marked. It adds no figures of
 * its own: every point is derived from the result's timeline using the same
 * "income minus spending" rule, and the sentence beside it says the same thing
 * in words.
 */
interface TimelinePoint {
  atMonth: number
  monthlyIncomeMinor: number
  monthlyExpensesMinor: number
  savingsMinor: number
}
interface Pt {
  t: number
  s: number
}

/** The picture stops at ten years. */
const MAX_HORIZON = 120

const gbp = (minor: number) => `£${Math.round(minor / 100).toLocaleString('en-GB')}`

/** Exported for tests. */
export function runwayPoints(
  result: Record<string, unknown> | null,
  startSavings: number,
): { pts: Pt[]; zeroAt: number | null } | null {
  const timeline = result?.['timeline'] as TimelinePoint[] | null | undefined
  const income = result?.['currentMonthlyIncomeMinor']
  const surplus = result?.['currentMonthlySurplusMinor']
  if (!timeline?.length || typeof income !== 'number' || typeof surplus !== 'number') return null

  let t = 0
  let s = startSavings
  let inc = income
  let exp = income - surplus
  let zeroAt: number | null = null
  const pts: Pt[] = [{ t, s }]
  for (const p of timeline) {
    const gap = p.atMonth - t
    const burn = inc - exp
    let pre = s + burn * gap
    if (burn < 0 && pre <= 0) {
      zeroAt ??= t + s / -burn
      pts.push({ t: zeroAt, s: 0 })
      pre = 0
    }
    pts.push({ t: p.atMonth, s: pre })
    if (p.savingsMinor !== pre) pts.push({ t: p.atMonth, s: p.savingsMinor })
    t = p.atMonth
    s = p.savingsMinor
    inc = p.monthlyIncomeMinor
    exp = p.monthlyExpensesMinor
  }
  const burn = inc - exp
  if (burn < 0 && s > 0) {
    const zero = t + s / -burn
    if (zero <= MAX_HORIZON) {
      zeroAt ??= zero
      pts.push({ t: zero, s: 0 })
    } else {
      // Too far out to draw usefully: stop at the edge of the picture.
      const end = Math.max(t, MAX_HORIZON)
      pts.push({ t: end, s: Math.max(0, s + burn * (end - t)) })
    }
  } else if (burn < 0 && s === 0) {
    zeroAt ??= t
  } else {
    pts.push({ t: t + 6, s: s + burn * 6 })
  }
  return { pts, zeroAt }
}

export function RunwayChart({
  result,
  startSavings,
  runsOutLabel,
}: {
  result: Record<string, unknown> | null
  startSavings: number
  runsOutLabel?: string | undefined
}) {
  const built = runwayPoints(result, startSavings)
  if (!built) return null
  const { pts, zeroAt } = built
  const W = 320
  const H = 132
  const pad = { l: 8, r: 8, t: 12, b: 22 }
  const maxT = Math.max(1, ...pts.map((p) => p.t))
  const maxS = Math.max(1, ...pts.map((p) => p.s))
  const x = (t: number) => pad.l + (t / maxT) * (W - pad.l - pad.r)
  const y = (s: number) => pad.t + (1 - s / maxS) * (H - pad.t - pad.b)
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.s).toFixed(1)}`).join(' ')
  const area = `${x(pts[0]!.t).toFixed(1)},${y(0)} ${line} ${x(pts[pts.length - 1]!.t).toFixed(1)},${y(0)}`
  const summary =
    zeroAt === null
      ? `Savings stay above zero over the months shown, from ${gbp(startSavings)} today.`
      : `Savings fall from ${gbp(startSavings)} today to zero around month ${zeroAt.toFixed(1)}.`

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={summary}
        className="w-full text-family-400"
      >
        <polygon points={area} fill="currentColor" opacity="0.12" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1={pad.l}
          x2={W - pad.r}
          y1={y(0)}
          y2={y(0)}
          stroke="currentColor"
          opacity="0.3"
          strokeDasharray="3 3"
        />
        {zeroAt !== null && <circle cx={x(zeroAt)} cy={y(0)} r="5" className="fill-red-500" />}
        <text x={pad.l} y={H - 6} fontSize="10" fill="currentColor" opacity="0.7">
          Today
        </text>
        <text
          x={W - pad.r}
          y={H - 6}
          fontSize="10"
          textAnchor="end"
          fill="currentColor"
          opacity="0.7"
        >
          {`month ${Math.round(maxT)}`}
        </text>
        <text x={pad.l} y={pad.t - 2} fontSize="10" fill="currentColor" opacity="0.7">
          {gbp(maxS)}
        </text>
      </svg>
      <figcaption className="mt-1 text-xs text-ink-tertiary">
        {zeroAt !== null && runsOutLabel ? `Savings reach zero ${runsOutLabel}. ` : ''}
        Savings over time, from the figures entered.
      </figcaption>
    </figure>
  )
}
