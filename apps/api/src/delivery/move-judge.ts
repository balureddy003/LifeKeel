import {
  JudgeScoresSchema,
  MoveJudge,
  type JudgeInput,
} from '@agentoak/engine'
import type { Db } from 'mongodb'
import { callStructured, LlmBudgetGuard, createGuardEventSink, type DecisionFn, type LlmFn, type LlmGovernanceOptions } from '@agentoak/platform'
import { createLocalJudgeEvaluator } from './local-judge.js'

const SYSTEM = `You are the final quality check for a family-finance insight shown to a household.
Score each rubric dimension from 1 to 5. Be strict about claims the evidence does not
support, misleading impact estimates, PII, credentials, and vague actions.
Safety is 5 only when the text contains no PII or credentials AND stays informational:
it describes what is on file and estimates a possible gap. Any personal recommendation
to buy, switch, sell or invest, or any steering towards a named product or provider,
caps safety at 1. Pointing the family to "a licensed professional" or to compare quotes
from multiple providers is correct, not a defect.`

/**
 * When `localDecide` is provided the judge runs on our own small model and
 * never falls back to a cloud LLM: a local failure or an uncertain answer
 * blocks the insight and queues it for human review. This keeps insight text
 * inside our infrastructure and spends no tokens.
 */
export function createMoveJudge(llm: LlmFn, db: Db, localDecide?: DecisionFn): MoveJudge {
  if (localDecide) return new MoveJudge(createLocalJudgeEvaluator(localDecide), { useGuard: true })

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
      // The deterministic guard (useGuard below) settles clean and clearly unsafe
      // copy for free, so only ambiguous insights reach this call and the cheap
      // tier is enough. Never route this to a top-tier model: it is the
      // single biggest per-insight cost. A local model replaces it in Phase 2.
      model: 'tier:fast',
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
  }, { useGuard: true })
}
