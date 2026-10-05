/**
 * Feed mutes (PRD-136 §3) — the "not relevant" control's backend.
 *
 * A mute lives in tenant-scoped `feed_mutes` and matches an event two
 * ways: by the insight it links to (`rule_id` + `entity_key`, resolved
 * against the insights collection at emit/read time) or, for events
 * with no insight behind them, by `{type, subject}` where subject is
 * the dedupe_key minus its `:YYYY-MM-DD` suffix — the recurring shape
 * of the event, not one day's instance of it.
 *
 * Every helper is best-effort and tolerant of fake/absent collections:
 * a missing collection means no mutes, never a throw, same discipline
 * as emit.ts itself.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { ReadinessEventDoc } from './emit.js'

export interface FeedMuteDoc extends Record<string, unknown> {
  tenant_id: string
  /** Insight-keyed mutes. */
  rule_id?: string
  entity_key?: string
  /** Type-keyed mutes for events with no insight link. */
  type?: string
  subject?: string
  until: Date
  by_user_id: string
  event_id: string
  created_at: Date
}

export function muteSubject(dedupeKey: string): string {
  return dedupeKey.replace(/:\d{4}-\d{2}-\d{2}$/, '')
}

async function insightKeysFor(
  db: Db,
  tenantId: string,
  links: { kind: string; id: string }[],
): Promise<{ rule_id: string; entity_key: string }[]> {
  const out: { rule_id: string; entity_key: string }[] = []
  for (const link of links) {
    if (link.kind !== 'insight') continue
    try {
      const doc = await db
        .collection('insights')
        .findOne({ tenant_id: tenantId, id: link.id })
      if (doc && typeof doc['rule_id'] === 'string') {
        out.push({ rule_id: doc['rule_id'], entity_key: (doc['entity_key'] as string | undefined) ?? '' })
      }
    } catch {
      // no insights collection on this db — no insight keys to match
    }
  }
  return out
}

async function liveMutes(db: Db, tenantId: string): Promise<FeedMuteDoc[]> {
  try {
    const col = getTenantCollection<FeedMuteDoc>(db, 'feed_mutes', tenantId)
    if (typeof col.find !== 'function') return []
    const mutes = (await col.find({}).toArray()) as FeedMuteDoc[]
    const now = Date.now()
    return mutes.filter((m) => new Date(m.until).getTime() > now)
  } catch {
    return []
  }
}

function matches(
  mute: FeedMuteDoc,
  evt: Pick<ReadinessEventDoc, 'type' | 'dedupe_key'>,
  insightKeys: { rule_id: string; entity_key: string }[],
): boolean {
  if (mute.subject !== undefined) {
    return mute.type === evt.type && mute.subject === muteSubject(evt.dedupe_key)
  }
  return insightKeys.some((k) => k.rule_id === mute.rule_id && k.entity_key === (mute.entity_key ?? ''))
}

/** The unexpired mute covering this event, or null. */
export async function findEventMute(
  db: Db,
  tenantId: string,
  evt: Pick<ReadinessEventDoc, 'type' | 'dedupe_key' | 'links'>,
): Promise<FeedMuteDoc | null> {
  const mutes = await liveMutes(db, tenantId)
  if (mutes.length === 0) return null
  const insightKeys = await insightKeysFor(db, tenantId, evt.links ?? [])
  return mutes.find((m) => matches(m, evt, insightKeys)) ?? null
}

/** "Not relevant" → 90-day mute keyed the way findEventMute reads it. */
export async function upsertEventMute(
  db: Db,
  tenantId: string,
  userId: string,
  event: ReadinessEventDoc,
  until: Date,
): Promise<void> {
  try {
    const col = getTenantCollection<FeedMuteDoc>(db, 'feed_mutes', tenantId)
    if (typeof col.updateOne !== 'function') return
    const insightKeys = await insightKeysFor(db, tenantId, event.links ?? [])
    const key =
      insightKeys.length > 0
        ? { rule_id: insightKeys[0]!.rule_id, entity_key: insightKeys[0]!.entity_key }
        : { type: event.type, subject: muteSubject(event.dedupe_key) }
    await col.updateOne(
      key,
      {
        $set: { ...key, until, by_user_id: userId, event_id: event.id },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true },
    )
  } catch {
    // mute bookkeeping never breaks the feedback write
  }
}

/** Undo: POST feedback 'useful' clears every mute this event created. */
export async function deleteEventMutes(
  db: Db,
  tenantId: string,
  event: ReadinessEventDoc,
): Promise<void> {
  try {
    const col = getTenantCollection<FeedMuteDoc>(db, 'feed_mutes', tenantId)
    if (typeof col.find !== 'function' || typeof col.deleteMany !== 'function') return
    const insightKeys = await insightKeysFor(db, tenantId, event.links ?? [])
    const subject = muteSubject(event.dedupe_key)
    const all = (await col.find({}).toArray()) as FeedMuteDoc[]
    const doomed = all.filter(
      (m) =>
        (m.subject !== undefined && m.type === event.type && m.subject === subject) ||
        (m.rule_id !== undefined &&
          insightKeys.some((k) => k.rule_id === m.rule_id && k.entity_key === (m.entity_key ?? ''))),
    )
    for (const m of doomed) {
      const key = m.rule_id !== undefined ? { rule_id: m.rule_id, entity_key: m.entity_key } : { type: m.type, subject: m.subject }
      await col.deleteMany(key).catch(() => {})
    }
  } catch {
    // as above
  }
}
