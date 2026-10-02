import { z } from 'zod'
import type { JudgeEvaluator, JudgeInput, JudgeScores } from '@agentoak/engine'
import type { DecisionFn } from '@agentoak/platform'

/**
 * Judge evaluator backed by a small local model (see
 * @agentoak/platform createLocalDecisionFn). Asks yes/no checklist questions,
 * which small models answer far more reliably than 1-5 scores, and maps them
 * deterministically onto the existing JudgeScores so MoveJudge.decide() is
 * unchanged. Runs entirely inside our infrastructure.
 */

export const LocalJudgeChecklistSchema = z.object({
  coherent: z.boolean(),
  grounded: z.boolean(),
  actionable: z.boolean(),
  gives_advice_or_names_provider: z.boolean(),
  contains_pii_or_credentials: z.boolean(),
  uncertain: z.boolean(),
  feedback: z.string().max(300),
})
export type LocalJudgeChecklist = z.infer<typeof LocalJudgeChecklistSchema>

// Ollama constrains decoding with this; LocalJudgeChecklistSchema validates the result.
export const LOCAL_JUDGE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    coherent: { type: 'boolean' },
    grounded: { type: 'boolean' },
    actionable: { type: 'boolean' },
    gives_advice_or_names_provider: { type: 'boolean' },
    contains_pii_or_credentials: { type: 'boolean' },
    uncertain: { type: 'boolean' },
    feedback: { type: 'string' },
  },
  required: [
    'coherent', 'grounded', 'actionable', 'gives_advice_or_names_provider',
    'contains_pii_or_credentials', 'uncertain', 'feedback',
  ],
} as const

const SYSTEM = `You check a family-finance insight before it is shown to a household.
Answer each question true or false.
- coherent: the reasoning reads logically and is not garbled.
- grounded: every figure and claim in the reasoning is supported by the evidence given.
- actionable: the listed actions are specific enough for a person to carry out.
- gives_advice_or_names_provider: true ONLY if it tells the family to buy, switch, sell or invest, or names or favours a specific product or provider. Telling them to consult a licensed professional or compare quotes from several providers is NOT advice, answer false.
- contains_pii_or_credentials: true if it contains an email, ID or card number, or a secret.
- uncertain: true if you cannot decide confidently.
Keep feedback to one short sentence.`

// CPU inference cost scales with prompt length; the checklist needs only the
// copy and a compact evidence summary.
const MAX_EVIDENCE_CHARS = 1500

export class LocalJudgeUncertainError extends Error {
  constructor() {
    super('Local judge was uncertain; routing to human review')
    this.name = 'LocalJudgeUncertainError'
  }
}

export function checklistToScores(c: LocalJudgeChecklist): JudgeScores {
  if (c.uncertain) throw new LocalJudgeUncertainError()
  return {
    coherence: c.coherent ? 5 : 2,
    groundedness: c.grounded ? 5 : 2,
    actionability: c.actionable ? 5 : 2,
    // The model isn't asked about impact size; the deterministic guard already
    // rejects invalid impact ranges before any model call.
    proportionality: 5,
    safety: c.gives_advice_or_names_provider || c.contains_pii_or_credentials ? 1 : 5,
    feedback: c.feedback,
  }
}

export function createLocalJudgeEvaluator(decide: DecisionFn): JudgeEvaluator {
  return async (input: JudgeInput): Promise<JudgeScores> => {
    const evidence = JSON.stringify(input.evidence).slice(0, MAX_EVIDENCE_CHARS)
    const { value } = await decide({
      system: SYSTEM,
      schema: LocalJudgeChecklistSchema,
      jsonSchema: LOCAL_JUDGE_JSON_SCHEMA,
      prompt: JSON.stringify({
        evidence,
        reasoning: input.insight.reasoning,
        actions: input.insight.actions,
        estimated_impact_range: [input.insight.estimated_impact_low, input.insight.estimated_impact_high],
      }),
    })
    // Throws on `uncertain`; MoveJudge turns any throw into a block + human review.
    return checklistToScores(value)
  }
}
