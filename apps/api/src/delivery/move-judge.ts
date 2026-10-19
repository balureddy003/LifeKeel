import {
  JudgeScoresSchema,
  MoveJudge,
  type JudgeEvaluator,
  type JudgeInput,
} from '@lifekeel/engine'
import type { Db } from 'mongodb'
import {
  callStructured,
  LlmBudgetGuard,
  createGuardEventSink,
  type DecisionFn,
  type LlmFn,
  type LlmGovernanceOptions,
} from '@lifekeel/platform'
import { createLocalJudgeEvaluator } from './local-judge.js'
import { withShadow, type ShadowRecord } from './shadow-judge.js'
import { recordShadowComparison } from '../routes/metrics.js'

const SYSTEM = `You are the final quality check for a family-finance insight shown to a household.
Score each rubric dimension from 1 to 5. Be strict about claims the evidence does not
support, misleading impact estimates, PII, credentials, and vague actions.
Safety is 5 only when the text contains no PII or credentials AND stays informational:
it describes what is on file and estimates a possible gap. Any personal recommendation
to buy, switch, sell or invest, or any steering towards a named product or provider,
caps safety at 1. Pointing the family to "a licensed professional" or to compare quotes
from multiple providers is correct, not a defect.`

const SHADOW_RETENTION_MS = 30 * 24 * 3_600_000

export interface CreateMoveJudgeOptions {
  /**
   * With a local model configured, keep the cloud judge authoritative and run the
   * local one behind it, recording agreement (see shadow-judge.ts). For validating the
   * local judge on real traffic before it is allowed to decide. Insight text still goes
   * to the cloud judge in this mode, as it did before the local judge existed.
   */
  shadow?: boolean
}

/**
 * When `localDecide` is provided the judge runs on our own small model and
 * never falls back to a cloud LLM: a local failure or an uncertain answer
 * blocks the insight and queues it for human review. This keeps insight text
 * inside our infrastructure and spends no tokens. With `opts.shadow` the cloud judge
 * decides and the local one is only measured.
 */
export function createMoveJudge(
  llmFor: (tenantId: string) => LlmFn,
  db: Db,
  decideFor?: (tenantId: string) => DecisionFn | undefined,
  opts: CreateMoveJudgeOptions = {},
): MoveJudge {
  if (decideFor && !opts.shadow)
    return new MoveJudge(createLocalJudgeEvaluator(decideFor), { useGuard: true })

  const cloud = createCloudJudgeEvaluator(llmFor, db)
  if (!decideFor) return new MoveJudge(cloud, { useGuard: true })

  const record = async (r: ShadowRecord) => {
    recordShadowComparison('judge', r.outcome)
    // No insight text or figures: ids, decisions and outcome only.
    await db
      .collection('judge_shadow_results')
      .insertOne({
        ...r,
        created_at: new Date(),
        expires_at: new Date(Date.now() + SHADOW_RETENTION_MS),
      })
  }
  return new MoveJudge(withShadow(cloud, createLocalJudgeEvaluator(decideFor), { record }), {
    useGuard: true,
  })
}

function createCloudJudgeEvaluator(llmFor: (tenantId: string) => LlmFn, db: Db): JudgeEvaluator {
  const budgetGuard = new LlmBudgetGuard(db)
  const guardEventSink = createGuardEventSink(db, 'move-judge')

  return async (input: JudgeInput) => {
    const governance: LlmGovernanceOptions = {
      tenantId: input.insight.tenant_id ?? 'unknown',
      budgetGuard,
      guardEventSink,
    }
    // Governed per-tenant fn: model allowlist, input ceiling, deadline and
    // breaker come from the insight.delivery_judge.v1 policy (intent 01).
    const result = await callStructured(llmFor(input.insight.tenant_id ?? 'unknown'), {
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
  }
}
