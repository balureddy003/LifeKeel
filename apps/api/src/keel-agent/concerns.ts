/**
 * AI concern reports (G-AI-03, ISO/IEC 42001 A.3.3 / A.8.3). A family member
 * flags a Keel reply as wrong, unsafe, advice-like or a privacy problem.
 * The optional note is free text, so it is encrypted under the tenant's key
 * like Keel history; operators triage from category and route, which is all
 * the alert carries. Kept a year, then TTL removes it; erased with the account.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { encryptForTenant } from '../crypto/envelope.js'
import type { KeelContext } from './context.js'

export const CONCERN_CATEGORIES = ['incorrect', 'harmful', 'advice', 'privacy', 'other'] as const
export type ConcernCategory = (typeof CONCERN_CATEGORIES)[number]

export const CONCERN_RETENTION_MS = 365 * 24 * 60 * 60 * 1000

interface ConcernDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  user_id: string
  category: ConcernCategory
  answer_route?: string
  thread_id?: string
  note_enc?: string
  status: 'open'
  created_at: Date
  expires_at: Date
}

export async function recordConcern(
  db: Db,
  ctx: KeelContext,
  input: { category: ConcernCategory; route?: string; thread_id?: string; note?: string },
  now: Date = new Date(),
): Promise<string> {
  const id = randomUUID()
  await getTenantCollection<ConcernDoc>(db, 'keel_concerns', ctx.tenant_id).insertOne({
    id,
    user_id: ctx.user_id,
    category: input.category,
    ...(input.route ? { answer_route: input.route } : {}),
    ...(input.thread_id ? { thread_id: input.thread_id } : {}),
    ...(input.note ? { note_enc: await encryptForTenant(db, ctx.tenant_id, input.note) } : {}),
    status: 'open',
    created_at: now,
    expires_at: new Date(now.getTime() + CONCERN_RETENTION_MS),
  })
  return id
}
