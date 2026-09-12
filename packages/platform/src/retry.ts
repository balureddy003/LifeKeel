export interface RetryConfig {
  maxAttempts: number
  delaysMs: number[]
  jitter: number
  retryableStatuses: number[]
}

export const RETRY_CONFIGS: Record<string, RetryConfig> = {
  llm_enrichment: { maxAttempts: 3, delaysMs: [1000, 2000, 4000], jitter: 0.2, retryableStatuses: [429, 500, 502, 503, 504] },
  llm_workflow: { maxAttempts: 3, delaysMs: [2000, 4000, 8000], jitter: 0.2, retryableStatuses: [429, 500, 502, 503, 504] },
  mongodb_write: { maxAttempts: 2, delaysMs: [500, 500], jitter: 0, retryableStatuses: [] },
  connector_api: { maxAttempts: 3, delaysMs: [2000, 4000, 8000], jitter: 0.3, retryableStatuses: [429, 500, 502, 503] },
  webhook_delivery: { maxAttempts: 5, delaysMs: [10000, 30000, 60000, 120000, 300000], jitter: 0.2, retryableStatuses: [400, 401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504] },
  delivery_channel: { maxAttempts: 3, delaysMs: [5000, 15000, 30000], jitter: 0.1, retryableStatuses: [400, 408, 425, 429, 500, 502, 503, 504] },
}

export async function retryWithPolicy<T>(
  policy: keyof typeof RETRY_CONFIGS,
  operation: () => Promise<T>,
): Promise<T> {
  const config = RETRY_CONFIGS[policy]!
  let lastError: unknown
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (err) {
      lastError = err
      if (attempt === config.maxAttempts - 1 || !isRetryable(err, config)) break
      const base = config.delaysMs[Math.min(attempt, config.delaysMs.length - 1)] ?? 0
      const factor = 1 - config.jitter + Math.random() * config.jitter * 2
      await new Promise(resolve => setTimeout(resolve, base * factor))
    }
  }
  throw lastError
}

function isRetryable(error: unknown, config: RetryConfig): boolean {
  if (!(error instanceof Error)) return false
  if (config.retryableStatuses.length === 0) {
    return /network|timeout|writeconcern|connection/i.test(error.message)
  }
  const status = Number(error.message.match(/\b([45]\d\d)\b/)?.[1])
  return config.retryableStatuses.includes(status)
    || /network|timeout|rate limit|overloaded|unavailable/i.test(error.message)
}
