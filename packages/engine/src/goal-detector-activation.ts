export interface GoalActivationInput {
  goal_id: string
  name: string
  description?: string
  evidence_types: string[]
  detector_ids?: string[]
  industry?: string
}

export interface DetectorActivationInput {
  detector_id: string
  name: string
  description?: string
  evidence_types: string[]
  industries: string[]
  reasoning_templates?: string[]
}

export interface GoalDetectorActivation {
  goal_id: string
  detector_id: string
  relevance_score: number
  source: 'exact' | 'semantic' | 'industry' | 'manual'
  active: boolean
}

export class GoalDetectorActivationMap {
  constructor(private readonly threshold = 0.4) {}

  score(goal: GoalActivationInput, detector: DetectorActivationInput): GoalDetectorActivation {
    if (goal.detector_ids?.includes(detector.detector_id)) {
      return this.result(goal, detector, 1, 'manual')
    }
    if (detector.evidence_types.some(type => goal.evidence_types.includes(type))) {
      return this.result(goal, detector, 1, 'exact')
    }

    const goalTokens = tokens(`${goal.name} ${goal.description ?? ''}`)
    const detectorTokens = tokens([
      detector.name,
      detector.description ?? '',
      ...(detector.reasoning_templates ?? []),
    ].join(' '))
    const overlap = [...goalTokens].filter(token => detectorTokens.has(token)).length
    const union = new Set([...goalTokens, ...detectorTokens]).size
    const similarity = union === 0 ? 0 : overlap / union
    if (similarity > 0) {
      return this.result(goal, detector, Math.min(0.9, 0.5 + similarity * 0.4), 'semantic')
    }
    if (goal.industry && detector.industries.includes(goal.industry)) {
      return this.result(goal, detector, 0.2, 'industry')
    }
    return this.result(goal, detector, 0, 'semantic')
  }

  private result(
    goal: GoalActivationInput,
    detector: DetectorActivationInput,
    relevance_score: number,
    source: GoalDetectorActivation['source'],
  ): GoalDetectorActivation {
    return {
      goal_id: goal.goal_id,
      detector_id: detector.detector_id,
      relevance_score,
      source,
      active: relevance_score >= this.threshold,
    }
  }
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 2))
}
