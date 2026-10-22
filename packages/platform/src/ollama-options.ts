/**
 * The context window every Ollama request asks for.
 *
 * Without an explicit `num_ctx`, Ollama uses its own default (4096 tokens on
 * the version measured) and silently drops whatever does not fit, with no
 * error: a long prompt just loses its start. The task registry allows up to
 * 8000 input tokens plus 1500 output (definitions/ai-tasks.yaml), so the
 * default is 10240. Memory cost is small (the KV cache for a 7b model is
 * well under 1 GB at this size) and only tokens actually sent are processed.
 *
 * OLLAMA_NUM_CTX overrides it; an invalid value falls back to the default
 * rather than failing a request.
 */
export const DEFAULT_OLLAMA_NUM_CTX = 10240

export function ollamaNumCtx(raw: string | undefined = process.env['OLLAMA_NUM_CTX']): number {
  if (raw === undefined || raw === '') return DEFAULT_OLLAMA_NUM_CTX
  const n = Number(raw)
  return Number.isInteger(n) && n >= 2048 && n <= 131072 ? n : DEFAULT_OLLAMA_NUM_CTX
}
