import { createLocalDecisionFn, type DecisionFn } from '@agentoak/platform'

/** Default is the smallest size that did not pass unsafe copy in testing (see infra/local-judge/README.md). */
const DEFAULT_LOCAL_MODEL = 'qwen2.5:7b'

/**
 * Self-hosted model client, or undefined when LOCAL_JUDGE_BASE_URL is unset
 * (callers then keep their existing cloud path). One Ollama server backs both
 * the move judge, the email classifier and document extraction; LOCAL_CLASSIFIER_MODEL
 * and LOCAL_OCR_MODEL optionally override the model for those tasks.
 */
export function localDecisionFromEnv(purpose: 'judge' | 'classifier' | 'ocr'): DecisionFn | undefined {
  const baseUrl = process.env['LOCAL_JUDGE_BASE_URL']
  if (!baseUrl) return undefined
  const judgeModel = process.env['LOCAL_JUDGE_MODEL'] || DEFAULT_LOCAL_MODEL
  const classifierModel = process.env['LOCAL_CLASSIFIER_MODEL'] || judgeModel
  const model = purpose === 'judge' ? judgeModel
    : purpose === 'classifier' ? classifierModel
    : (process.env['LOCAL_OCR_MODEL'] || classifierModel)
  return createLocalDecisionFn({ baseUrl, model, timeoutMs: 120_000 })
}
