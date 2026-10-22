import { AsyncLocalStorage } from 'node:async_hooks'

export interface LlmCallContext {
  task_id: string
  tenant_id: string
  /**
   * Aborted when the task's deadline passes. A client that honours it stops
   * the upstream request instead of leaving a slow self-hosted model busy on
   * an answer nobody is waiting for (which then makes the next calls queue or
   * be rejected).
   */
  signal?: AbortSignal
}

/**
 * Carries (task, tenant) from governedLlm into the router's onUsage
 * callback, so the CostLedger record is attributed to the task that caused
 * it — not just the tenant. AsyncLocalStorage keeps it correct under
 * concurrent calls sharing one router. It also carries the deadline signal.
 *
 * Lives in its own module so the model clients (llm.ts, local-decision.ts) can
 * read it without importing the gateway, which imports them.
 */
export const llmCallContext = new AsyncLocalStorage<LlmCallContext>()

/** The deadline signal of the call in progress, if any. */
export function currentDeadlineSignal(): AbortSignal | undefined {
  return llmCallContext.getStore()?.signal
}
