/**
 * Readiness feed event writer (PRD-136 §1).
 *
 * One tenant-scoped `readiness_events` collection; every emitter in the
 * codebase goes through emitReadinessEvent so dedupe, validation, and
 * failure behavior live in exactly one place. Writes are fire-and-forget
 * by design — the feed narrates work that already happened, so a feed
 * write must never break (or even delay) the write path that triggered
 * it. Same discipline as lib/insight-attribution.ts, including tolerating
 * the partial/fake collections tests hand in (no updateOne, no sort).
 */
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { createLogger, getTenantCollection } from '@agentoak/platform'
import { ReadinessEventSchema, type ReadinessEventType } from './event-schema.js'

const log = createLogger({ service: 'readiness-feed', version: '0.0.0' })

export interface ReadinessEventDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  type: ReadinessEventType
  severity: 'info' | 'notice' | 'attention' | 'critical'
  direction: 'up' | 'down' | 'flat' | null
  member_id: string | null
  domain: string | null
  title: string
  summary: string
  evidence: { label: string; value?: string; value_minor?: number }[]
  links: { kind: 'insight' | 'component' | 'document' | 'scenario' | 'member' | 'profile_field'; id: string }[]
  next_check_at: Date | null
  dedupe_key: string
  created_at: Date
  feedback?: { user_id: string; value: 'useful' | 'not_relevant' | 'handled' | 'remind_later' | 'data_wrong'; at: Date }[]
}

/**
 * Idempotent identity for an event: type + subject + day. A second emit
 * for the same subject on the same day refreshes the existing doc's
 * fields rather than growing a duplicate feed row.
 */
export function buildDedupeKey(type: string, subject: string, date = new Date().toISOString().slice(0, 10)): string {
  return `${type}:${subject}:${date}`
}

/**
 * Fire-and-forget event write. Synchronous signature on purpose: callers
 * must not be able to accidentally await feed bookkeeping into their own
 * latency or error path. The whole body is deferred so even a synchronous
 * driver error (missing method on a partial db, closed client) lands in
 * the catch rather than at the call site.
 */
export function emitReadinessEvent(
  db: Db,
  tenantId: string,
  evt: Omit<ReadinessEventDoc, 'id' | 'tenant_id' | 'created_at'>,
): void {
  void Promise.resolve()
    .then(async () => {
      const parsed = ReadinessEventSchema.safeParse(evt)
      if (!parsed.success) {
        log.warn(
          { tenant_id: tenantId, type: evt?.type, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
          'Readiness event failed schema validation — skipped',
        )
        return
      }
      const col = getTenantCollection<ReadinessEventDoc>(db, 'readiness_events', tenantId)
      if (typeof col.updateOne !== 'function') return
      await col.updateOne(
        { dedupe_key: parsed.data.dedupe_key },
        {
          $set: { ...parsed.data },
          $setOnInsert: { id: randomUUID(), created_at: new Date() },
        },
        { upsert: true },
      )
    })
    .catch(() => {})
}
