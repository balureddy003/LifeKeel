import { createLocalDecisionFn, type DecisionFn } from '@agentoak/platform'

/** Default is the smallest size that did not pass unsafe copy in testing (see infra/local-judge/README.md). */
const DEFAULT_LOCAL_MODEL = 'qwen2.5:7b'

/**
 * Self-hosted model client, or undefined when LOCAL_JUDGE_BASE_URL is unset
 * (callers then keep their existing cloud path). One Ollama server backs both
 * the move judge and the email classifier; LOCAL_CLASSIFIER_MODEL optionally
 * overrides the model for classification only.
 */
export function localDecisionFromEnv(purpose: 'judge' | 'classifier'): DecisionFn | undefined {
  const baseUrl = process.env['LOCAL_JUDGE_BASE_URL']
  if (!baseUrl) return undefined
  const judgeModel = process.env['LOCAL_JUDGE_MODEL'] || DEFAULT_LOCAL_MODEL
  const model = purpose === 'classifier' ? (process.env['LOCAL_CLASSIFIER_MODEL'] || judgeModel) : judgeModel
  return createLocalDecisionFn({ baseUrl, model, timeoutMs: 120_000 })
}
