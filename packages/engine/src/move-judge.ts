import { z } from 'zod'
import type { Insight } from './schemas.js'

export const JudgeScoresSchema = z.object({
  coherence: z.number().int().min(1).max(5),
  groundedness: z.number().int().min(1).max(5),
  actionability: z.number().int().min(1).max(5),
  proportionality: z.number().int().min(1).max(5),
  safety: z.number().int().min(1).max(5),
  feedback: z.string().default(''),
})
export type JudgeScores = z.infer<typeof JudgeScoresSchema>

export type JudgeDecision = 'pass' | 'rewrite' | 'block' | 'skipped'

export interface JudgeVerdict {
  decision: JudgeDecision
  scores?: JudgeScores
  judge_skipped: boolean
  skip_reason?: 'below_delivery_threshold' | 'trivial_reasoning' | 'duplicate_reasoning' | 'judge_failure'
  evaluated_at: Date
}

export interface JudgeInput {
  insight: Insight
  evidence: Record<string, unknown>
}

export type JudgeEvaluator = (input: JudgeInput) => Promise<JudgeScores>

export interface MoveJudgeOptions {
  deliveryThreshold?: number
}

export class MoveJudge {
  private readonly deliveryThreshold: number

  constructor(
    private readonly evaluator: JudgeEvaluator,
    options: MoveJudgeOptions = {},
  ) {
    this.deliveryThreshold = options.deliveryThreshold ?? 0.7
  }

  async evaluate(
    input: JudgeInput,
    _options: { duplicateReasoning?: boolean } = {},
  ): Promise<JudgeVerdict> {
    const evaluated_at = new Date()
    if (input.insight.confidence_breakdown.combined_score < this.deliveryThreshold) {
      return { decision: 'skipped', judge_skipped: true, skip_reason: 'below_delivery_threshold', evaluated_at }
    }

    try {
      const scores = JudgeScoresSchema.parse(await this.evaluator(input))
      return {
        decision: this.decide(scores),
        scores,
        judge_skipped: false,
        evaluated_at,
      }
    } catch {
      return { decision: 'block', judge_skipped: true, skip_reason: 'judge_failure', evaluated_at }
    }
  }

  private decide(scores: JudgeScores): Exclude<JudgeDecision, 'skipped'> {
    if (scores.safety < 5 || scores.proportionality < 2) return 'block'
    if (scores.coherence < 3 || scores.groundedness < 4 || scores.actionability < 3) return 'rewrite'
    return 'pass'
  }
}
