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

/** The solver's waiting-period gap: savings run out before income protection starts paying. */
export interface WaitingGap {
  months: number
  runsOutMonth: number
  coverStartsMonth: number
  runsOut: string
  coverStarts: string
}

/** Exported for tests. Reads only what the solver sent; never works a gap out itself. */
export function waitingGapOf(result: Record<string, unknown> | null): WaitingGap | null {
  const g = result?.['waitingGap'] as Partial<WaitingGap> | undefined
  return g &&
    typeof g.months === 'number' &&
    typeof g.runsOutMonth === 'number' &&
    typeof g.coverStartsMonth === 'number' &&
    typeof g.runsOut === 'string' &&
    typeof g.coverStarts === 'string'
    ? (g as WaitingGap)
    : null
}

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

/** The gap in words. Shown under the chart, and on its own under a saved brief's answer. */
export function WaitingGapNote({ gap, chart = false }: { gap: WaitingGap; chart?: boolean }) {
  return (
    <p
      data-testid="waiting-gap-note"
      className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-ink-primary"
    >
      Savings run out about {gap.months.toFixed(1)} months before the cover payment starts: from
      around {gap.runsOut} until around {gap.coverStarts}, there would be neither.
      {chart ? ' The shaded part of the chart is that gap.' : ''} If you want advice about it, talk
      to a licensed professional.
    </p>
  )
}

export function RunwayChart({
  result,
  startSavings,
  runsOutLabel,
  baseline,
}: {
  result: Record<string, unknown> | null
  startSavings: number
  runsOutLabel?: string | undefined
  /** An earlier answer drawn as a dashed line, e.g. the original beside a what-if. */
  baseline?: { result: Record<string, unknown> | null; startSavings: number } | undefined
}) {
  const built = runwayPoints(result, startSavings)
  if (!built) return null
  const base = baseline ? runwayPoints(baseline.result, baseline.startSavings) : null
  const { pts, zeroAt } = built
  const waiting = waitingGapOf(result)
  const coverAt = result?.['coverStartsAtMonth']
  const coverStarts = typeof coverAt === 'number' ? coverAt : null
  const W = 320
  const H = 132
  const pad = { l: 8, r: 8, t: 20, b: 22 }
  const all = [...pts, ...(base?.pts ?? [])]
  const maxT = Math.max(1, ...all.map((p) => p.t), coverStarts !== null ? coverStarts + 2 : 0)
  const maxS = Math.max(1, ...all.map((p) => p.s))
  const x = (t: number) => pad.l + (t / maxT) * (W - pad.l - pad.r)
  const y = (s: number) => pad.t + (1 - s / maxS) * (H - pad.t - pad.b)
  const toLine = (points: Pt[]) =>
    points.map((p) => `${x(p.t).toFixed(1)},${y(p.s).toFixed(1)}`).join(' ')
  const line = toLine(pts)
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
        aria-label={
          base ? `${summary} The dashed line is the original answer, for comparison.` : summary
        }
        className="w-full text-family-400"
      >
        <polygon points={area} fill="currentColor" opacity="0.12" />
        {waiting && (
          <rect
            data-testid="waiting-gap"
            x={x(waiting.runsOutMonth)}
            y={pad.t}
            width={Math.max(1, x(waiting.coverStartsMonth) - x(waiting.runsOutMonth))}
            height={y(0) - pad.t}
            className="fill-red-500"
            opacity="0.12"
          />
        )}
        {coverStarts !== null && (
          <g data-testid="cover-starts">
            <line
              x1={x(coverStarts)}
              x2={x(coverStarts)}
              y1={pad.t}
              y2={y(0)}
              stroke="currentColor"
              strokeDasharray="2 3"
              opacity="0.6"
            />
            <text
              x={x(coverStarts)}
              y={pad.t - 8}
              fontSize="10"
              textAnchor={x(coverStarts) > W / 2 ? 'end' : 'start'}
              fill="currentColor"
              opacity="0.8"
            >
              Cover starts
            </text>
          </g>
        )}
        {base && (
          <polyline
            points={toLine(base.pts)}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="5 4"
            opacity="0.45"
            className="text-ink-tertiary"
          />
        )}
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
        {/* The top-left figure gives way when the cover label would sit on top of it. */}
        {!(coverStarts !== null && x(coverStarts) < W / 2) && (
          <text x={pad.l} y={pad.t - 8} fontSize="10" fill="currentColor" opacity="0.7">
            {maxS === pts[0]!.s ? `Savings today ${gbp(maxS)}` : `Up to ${gbp(maxS)}`}
          </text>
        )}
      </svg>
      {waiting && <WaitingGapNote gap={waiting} chart />}
      <figcaption className="mt-1 text-xs text-ink-tertiary">
        {zeroAt !== null && runsOutLabel ? `Savings reach zero ${runsOutLabel}. ` : ''}
        {base
          ? 'Dashed line: your original answer.'
          : 'Savings over time, from the figures entered.'}
      </figcaption>
    </figure>
  )
}
