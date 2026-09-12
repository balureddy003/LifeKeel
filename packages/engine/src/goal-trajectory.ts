export interface GoalProjectionKpi {
  id: string
  direction: 'increase' | 'decrease'
  start_value: number
  current: number
  target: number
}

export interface GoalProjectionSignal {
  detector_id: string
  calibrated_hit_rate: number
  direction?: 'driving' | 'headwind'
}

export interface GoalProjectionInput {
  goal_id: string
  start_date: Date
  target_date: Date
  kpis: GoalProjectionKpi[]
  detector_signals?: GoalProjectionSignal[]
  approval_rate?: number
  outcome_attribution_score?: number
  evidence_count?: number
}

export interface GoalProjection {
  goal_id: string
  as_of: Date
  completion_probability: number
  projected_completion_date: Date | null
  confidence_interval: [number, number]
  driving_signals: string[]
  headwinds: string[]
}

const DAY_MS = 86_400_000

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function mean(values: number[], fallback: number): number {
  return values.length === 0
    ? fallback
    : values.reduce((total, value) => total + value, 0) / values.length
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * Deterministically projects whether a goal will complete by its deadline.
 * All learned inputs must already be calibrated and tenant-scoped by the caller.
 */
export function projectGoal(input: GoalProjectionInput, asOf = new Date()): GoalProjection {
  const totalDays = Math.max(1, (input.target_date.getTime() - input.start_date.getTime()) / DAY_MS)
  const elapsedDays = Math.max(0, (asOf.getTime() - input.start_date.getTime()) / DAY_MS)
  const timeElapsed = clamp(elapsedDays / totalDays)

  const kpiScores: number[] = []
  const projectedDates: Date[] = []

  for (const kpi of input.kpis) {
    const needed = kpi.direction === 'increase'
      ? kpi.target - kpi.start_value
      : kpi.start_value - kpi.target
    const progress = kpi.direction === 'increase'
      ? kpi.current - kpi.start_value
      : kpi.start_value - kpi.current

    if (needed <= 0 || progress >= needed) {
      kpiScores.push(1)
      projectedDates.push(asOf)
      continue
    }

    if (elapsedDays <= 0 || progress <= 0) {
      kpiScores.push(0)
      continue
    }

    const projectedDays = elapsedDays * (needed / progress)
    kpiScores.push(clamp(totalDays / projectedDays))
    projectedDates.push(new Date(input.start_date.getTime() + projectedDays * DAY_MS))
  }

  const signals = input.detector_signals ?? []
  const signalScore = mean(signals.map(signal => clamp(signal.calibrated_hit_rate)), 0.5)
  const kpiScore = mean(kpiScores, 0)
  const approvalRate = clamp(input.approval_rate ?? 0.5)
  const attributionScore = clamp(input.outcome_attribution_score ?? 0.5)

  const completionProbability = clamp(
    kpiScore * 0.6
      + signalScore * 0.15
      + approvalRate * 0.1
      + attributionScore * 0.15,
  )

  const evidenceCount = Math.max(0, input.evidence_count ?? signals.length)
  const scarcity = 1 / Math.sqrt(evidenceCount + 1)
  // With insufficient evidence, uncertainty grows as the deadline approaches.
  const margin = clamp(0.08 + scarcity * (0.2 + 0.2 * timeElapsed), 0.08, 0.48)

  const rankedSignals = [...signals].sort((a, b) => b.calibrated_hit_rate - a.calibrated_hit_rate)
  const drivingSignals = rankedSignals
    .filter(signal => signal.direction !== 'headwind' && signal.calibrated_hit_rate >= 0.5)
    .slice(0, 5)
    .map(signal => signal.detector_id)
  const headwinds = rankedSignals
    .filter(signal => signal.direction === 'headwind' || signal.calibrated_hit_rate < 0.5)
    .reverse()
    .slice(0, 5)
    .map(signal => signal.detector_id)

  return {
    goal_id: input.goal_id,
    as_of: asOf,
    completion_probability: round(completionProbability),
    projected_completion_date: projectedDates.length === input.kpis.length
      ? new Date(Math.max(...projectedDates.map(date => date.getTime())))
      : null,
    confidence_interval: [
      round(clamp(completionProbability - margin)),
      round(clamp(completionProbability + margin)),
    ],
    driving_signals: drivingSignals,
    headwinds,
  }
}
