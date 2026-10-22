import { createLlmRouter, createLlmRouterFromEnv } from '@lifekeel/platform'
import { DEFAULT_LOCAL_MODEL } from '../local-model.js'
import { evalAuthHeaders } from './local-model-eval.js'
import type { TextLlm } from './assistant-eval.js'

/**
 * The text model for the eval CLIs. With LOCAL_JUDGE_BASE_URL set it is the
 * self-hosted model configured exactly as familyDataLlmFromEnv configures it
 * (same model, temperature and token cap) but WITHOUT the output guard, so the
 * eval sees the raw answers. Otherwise it is the normal router.
 */
export async function evalTextLlm(): Promise<{ llm: TextLlm; model: string }> {
  const baseUrl = process.env['LOCAL_JUDGE_BASE_URL']
  if (!baseUrl) return { llm: createLlmRouterFromEnv() as TextLlm, model: 'router' }
  const model =
    process.env['LOCAL_TEXT_MODEL'] || process.env['LOCAL_JUDGE_MODEL'] || DEFAULT_LOCAL_MODEL
  const getHeaders = await evalAuthHeaders(baseUrl)
  return {
    model,
    llm: createLlmRouter({
      provider: 'ollama',
      ollamaBaseUrl: baseUrl,
      ...(getHeaders ? { ollamaHeaders: getHeaders } : {}),
      tierModels: { fast: model, balanced: model, powerful: model },
      maxTokens: 700,
      temperature: 0.2,
    }) as TextLlm,
  }
}
