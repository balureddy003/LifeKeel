import { z } from 'zod'
import type { Insight } from './schemas.js'
import { runMoveGuard, type GuardReason } from './move-guard.js'

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
  /** True when the model evaluator was not consulted for this verdict. */
  judge_skipped: boolean
  skip_reason?: 'below_delivery_threshold' | 'judge_failure'
  /** Which stage decided: the free deterministic guard or the model. */
  decided_by?: 'guard' | 'model'
  guard_reasons?: GuardReason[]
  evaluated_at: Date
}

export interface JudgeInput {
  insight: Insight
  evidence: Record<string, unknown>
}

export type JudgeEvaluator = (input: JudgeInput) => Promise<JudgeScores>

export interface MoveJudgeOptions {
  deliveryThreshold?: number
  /**
   * Run the deterministic guard before the model. A blocking finding blocks
   * with no model call; a clean result passes with no model call; only
   * ambiguous content reaches the evaluator. Off by default so callers must
   * opt in once their copy is template-rendered and covered by guard tests.
   */
  useGuard?: boolean
}

export class MoveJudge {
  private readonly deliveryThreshold: number
  private readonly useGuard: boolean

  constructor(
    private readonly evaluator: JudgeEvaluator,
    options: MoveJudgeOptions = {},
  ) {
    this.deliveryThreshold = options.deliveryThreshold ?? 0.7
    this.useGuard = options.useGuard ?? false
  }

  async evaluate(
    input: JudgeInput,
    _options: { duplicateReasoning?: boolean } = {},
  ): Promise<JudgeVerdict> {
    const evaluated_at = new Date()

    // The guard runs before the threshold check so low-confidence insights
    // still get the (free) safety screen instead of bypassing it.
    const guard = this.useGuard ? runMoveGuard(input.insight) : undefined
    if (guard?.outcome === 'block') {
      return { decision: 'block', judge_skipped: true, decided_by: 'guard', guard_reasons: guard.reasons, evaluated_at }
    }

    if (input.insight.confidence_breakdown.combined_score < this.deliveryThreshold) {
      return {
        decision: 'skipped',
        judge_skipped: true,
        skip_reason: 'below_delivery_threshold',
        ...(guard ? { decided_by: 'guard' as const, guard_reasons: guard.reasons } : {}),
        evaluated_at,
      }
    }

    if (guard?.outcome === 'clean') {
      return { decision: 'pass', judge_skipped: true, decided_by: 'guard', guard_reasons: [], evaluated_at }
    }

    try {
      const scores = JudgeScoresSchema.parse(await this.evaluator(input))
      return {
        decision: this.decide(scores),
        scores,
        judge_skipped: false,
        decided_by: 'model',
        ...(guard ? { guard_reasons: guard.reasons } : {}),
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
