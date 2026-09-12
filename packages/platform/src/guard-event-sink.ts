/**
 * Persist LLM guard events to the `llm_guard_events` collection.
 *
 * ADR-0040 requires all guard events (prompt injection attempts, PII redaction,
 * forbidden output, format warnings) to be stored for audit.
 */
import type { Db } from 'mongodb'
import type { LlmGuardEvent } from './llm-guards.js'

export type GuardEventSink = (events: LlmGuardEvent[]) => Promise<void>

export function createGuardEventSink(db: Db, callSite: string): GuardEventSink {
  return async (events: LlmGuardEvent[]) => {
    if (events.length === 0) return
    const docs = events.map(e => ({ ...e, call_site: callSite, persisted_at: new Date() }))
    await db.collection('llm_guard_events').insertMany(docs)
  }
}
