/**
 * Persistent Keel conversations (Phase 4). Owner-scoped, not just
 * tenant-scoped: every query carries tenant_id AND user_id, so a partner in
 * the same household cannot read the other adult's history. Text is
 * encrypted under the tenant's key. Retention is a fixed 30 days from last
 * activity; Mongo TTL deletes in the background, so every read also filters
 * on expires_at.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { decryptEnveloped, encryptForTenant } from '../crypto/envelope.js'
import type { KeelContext } from './context.js'
import { unwrapDoc } from './mongo-result.js'

export const RETENTION_DAYS = 30
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000

interface ThreadDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  user_id: string
  title_enc: string
  /** Messages written so far; incremented atomically to give each message its place. */
  msg_count: number
  created_at: Date
  last_active_at: Date
  expires_at: Date
}

interface MessageDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  user_id: string
  thread_id: string
  /** Position within the thread; created_at can tie within one millisecond. */
  seq: number
  author: 'user' | 'keel'
  content_enc: string
  answer_route?: string
  cards?: unknown[]
  data_as_of?: string
  created_at: Date
  expires_at: Date
}

export interface StoredMessage {
  id: string
  author: 'user' | 'keel'
  content: string
  answer_route?: string
  cards?: unknown[]
  data_as_of?: string
  created_at: string
}

export interface ThreadSummary {
  id: string
  title: string
  last_active_at: string
}

const threads = (db: Db, ctx: KeelContext) =>
  getTenantCollection<ThreadDoc>(db, 'keel_threads', ctx.tenant_id)
const messages = (db: Db, ctx: KeelContext) =>
  getTenantCollection<MessageDoc>(db, 'keel_messages', ctx.tenant_id)

const live = (ctx: KeelContext, extra: Record<string, unknown> = {}) => ({
  user_id: ctx.user_id,
  expires_at: { $gt: new Date() },
  ...extra,
})

/** Returns the thread id to use: the caller's own live thread, or a new one. */
export async function ensureThread(
  db: Db,
  ctx: KeelContext,
  requestedId: string | undefined,
  firstMessage: string,
): Promise<string> {
  const now = new Date()
  if (requestedId) {
    const expires_at = new Date(now.getTime() + RETENTION_MS)
    const res = (await threads(db, ctx).updateOne(live(ctx, { id: requestedId }), {
      $set: { last_active_at: now, expires_at },
    })) as { matchedCount?: number }
    if ((res.matchedCount ?? 0) > 0) {
      // Retention is per conversation: an active thread keeps all of its messages.
      await messages(db, ctx).updateMany(
        { user_id: ctx.user_id, thread_id: requestedId },
        { $set: { expires_at } },
      )
      return requestedId
    }
  }
  const id = randomUUID()
  await threads(db, ctx).insertOne({
    id,
    user_id: ctx.user_id,
    title_enc: await encryptForTenant(db, ctx.tenant_id, firstMessage.slice(0, 60)),
    msg_count: 0,
    created_at: now,
    last_active_at: now,
    expires_at: new Date(now.getTime() + RETENTION_MS),
  })
  return id
}

export async function appendMessage(
  db: Db,
  ctx: KeelContext,
  threadId: string,
  msg: {
    author: 'user' | 'keel'
    content: string
    answer_route?: string
    cards?: unknown[]
    data_as_of?: string
  },
): Promise<string> {
  const now = new Date()
  const id = randomUUID()
  // Atomic, so two tabs (or a retry racing the original) can never share a position.
  const thread = unwrapDoc<ThreadDoc>(
    await threads(db, ctx).findOneAndUpdate(
      { user_id: ctx.user_id, id: threadId },
      { $inc: { msg_count: 1 } },
      { returnDocument: 'after' },
    ),
  )
  if (!thread) throw new Error('thread not found for this user')
  const seq = thread.msg_count
  await messages(db, ctx).insertOne({
    id,
    user_id: ctx.user_id,
    thread_id: threadId,
    seq,
    author: msg.author,
    content_enc: await encryptForTenant(db, ctx.tenant_id, msg.content),
    ...(msg.answer_route ? { answer_route: msg.answer_route } : {}),
    ...(msg.cards?.length ? { cards: msg.cards } : {}),
    ...(msg.data_as_of ? { data_as_of: msg.data_as_of } : {}),
    created_at: now,
    expires_at: new Date(now.getTime() + RETENTION_MS),
  })
  return id
}

export async function listThreads(db: Db, ctx: KeelContext): Promise<ThreadSummary[]> {
  const docs = (await threads(db, ctx)
    .find(live(ctx))
    .sort({ last_active_at: -1 })
    .limit(50)
    .toArray()) as ThreadDoc[]
  return Promise.all(
    docs.map(async (d) => ({
      id: d.id,
      title: (await decryptEnveloped(db, d.title_enc)) ?? '',
      last_active_at: d.last_active_at.toISOString(),
    })),
  )
}

/** null = not found for this user (also covers another tenant's or user's id). */
export async function getThread(
  db: Db,
  ctx: KeelContext,
  id: string,
): Promise<{ id: string; messages: StoredMessage[] } | null> {
  const thread = await threads(db, ctx).findOne(live(ctx, { id }))
  if (!thread) return null
  const docs = (await messages(db, ctx)
    .find(live(ctx, { thread_id: id }))
    .sort({ seq: 1 })
    .limit(500)
    .toArray()) as MessageDoc[]
  return {
    id,
    messages: await Promise.all(
      docs.map(async (m) => ({
        id: m.id,
        author: m.author,
        content: (await decryptEnveloped(db, m.content_enc)) ?? '',
        ...(m.answer_route ? { answer_route: m.answer_route } : {}),
        ...(m.cards ? { cards: m.cards } : {}),
        ...(m.data_as_of ? { data_as_of: m.data_as_of } : {}),
        created_at: m.created_at.toISOString(),
      })),
    ),
  }
}

export async function deleteThread(db: Db, ctx: KeelContext, id: string): Promise<boolean> {
  const res = (await threads(db, ctx).deleteOne({ user_id: ctx.user_id, id })) as {
    deletedCount?: number
  }
  if ((res.deletedCount ?? 0) === 0) return false
  await messages(db, ctx).deleteMany({ user_id: ctx.user_id, thread_id: id })
  return true
}

export async function deleteAllThreads(db: Db, ctx: KeelContext): Promise<void> {
  await threads(db, ctx).deleteMany({ user_id: ctx.user_id })
  await messages(db, ctx).deleteMany({ user_id: ctx.user_id })
}

export const KEEL_COLLECTIONS = [
  'keel_threads',
  'keel_messages',
  'keel_proposals',
  'keel_preferences',
] as const

export async function ensureKeelIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('keel_threads').createIndex({ tenant_id: 1, user_id: 1, last_active_at: -1 }),
    db.collection('keel_threads').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection('keel_messages').createIndex({ tenant_id: 1, user_id: 1, thread_id: 1, seq: 1 }),
    db.collection('keel_messages').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    db.collection('keel_proposals').createIndex({ tenant_id: 1, user_id: 1, id: 1 }),
    // Keep decided proposals for a week after expiry for audit, then TTL removes them.
    db
      .collection('keel_proposals')
      .createIndex({ expires_at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }),
    db.collection('keel_preferences').createIndex({ tenant_id: 1, user_id: 1 }, { unique: true }),
  ])
}
