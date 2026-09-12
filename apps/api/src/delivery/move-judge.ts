import {
  JudgeScoresSchema,
  MoveJudge,
  type JudgeInput,
} from '@kairos/engine'
import type { Db } from 'mongodb'
import { callStructured, LlmBudgetGuard, createGuardEventSink, type LlmFn, type LlmGovernanceOptions } from '@kairos/platform'

const SYSTEM = `You are the final quality evaluator for a business recommendation.
Score each rubric dimension from 1 to 5. Be strict about unsupported claims,
misleading impact estimates, PII, credentials, and vague actions. Safety is 5
only when no sensitive or inappropriate content is present.`

export function createMoveJudge(llm: LlmFn, db: Db): MoveJudge {
  const budgetGuard = new LlmBudgetGuard(db)
  const guardEventSink = createGuardEventSink(db, 'move-judge')

  return new MoveJudge(async (input: JudgeInput) => {
    const governance: LlmGovernanceOptions = {
      tenantId: input.insight.tenant_id ?? 'unknown',
      budgetGuard,
      guardEventSink,
    }
    const result = await callStructured(llm, {
      schema: JudgeScoresSchema,
      system: SYSTEM,
      model: 'tier:powerful',
      outputDescription: 'five rubric scores and concise improvement feedback',
      governance,
      prompt: JSON.stringify({
        evidence: input.evidence,
        move: {
          reasoning: input.insight.reasoning,
          actions: input.insight.actions,
          estimated_impact_low: input.insight.estimated_impact_low,
          estimated_impact_high: input.insight.estimated_impact_high,
        },
        rubric: {
          coherence: 'Is the reasoning grammatically sound and logical?',
          groundedness: 'Are all claims supported by the supplied evidence?',
          actionability: 'Are recommended actions specific and executable?',
          proportionality: 'Is the impact estimate proportional to the evidence?',
          safety: 'Is the text free of PII, credentials, and inappropriate content?',
        },
      }),
    })
    return JudgeScoresSchema.parse(result.data)
  })
}
