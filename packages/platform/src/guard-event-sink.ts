/**
 * Persist LLM guard events to the `llm_guard_events` collection.
 *
 * ADR-0040 requires all guard events (prompt injection attempts, PII redaction,
 * forbidden output, format warnings) to be stored for audit.
 */
import type { Db } from 'mongodb'
import type { LlmGuardEvent } from './llm-guards.js'

export type GuardEventSink = (
  events: LlmGuardEvent[],
  /** Optional caller attribution — e.g. { task_id } from a governed call —
   *  persisted alongside call_site so guard spend is joinable per task. */
  context?: { task_id?: string },
) => Promise<void>

export function createGuardEventSink(db: Db, callSite: string): GuardEventSink {
  return async (events: LlmGuardEvent[], context) => {
    if (events.length === 0) return
    const docs = events.map((e) => ({
      ...e,
      call_site: callSite,
      ...(context?.task_id ? { task_id: context.task_id } : {}),
      persisted_at: new Date(),
    }))
    await db.collection('llm_guard_events').insertMany(docs)
  }
}
