import type { Db } from 'mongodb'
import { getInviteCodesCollection } from './db.js'

export interface InviteCodeDoc {
  code: string
  grant_credits: number
  max_uses: number
  used_count: number
  active: boolean
  expires_at?: Date
  created_at: Date
}

export interface InviteCodeValidation {
  ok: boolean
  grant_credits: number
  reason?: string
}

function inviteCodeRequired(): boolean {
  return process.env['INVITE_CODE_REQUIRED'] === 'true'
}

export async function ensureInviteCodeIndexes(db: Db): Promise<void> {
  await getInviteCodesCollection(db)
    .createIndex({ code: 1 }, { unique: true })
    .catch(() => {})
}

async function loadInviteCode(db: Db, code?: string): Promise<{ ok: false; reason: string } | { ok: true; doc: InviteCodeDoc; normalized: string }> {
  if (!inviteCodeRequired()) {
    return { ok: true, doc: { code: '', grant_credits: 0, max_uses: 0, used_count: 0, active: true, created_at: new Date() }, normalized: '' }
  }

  if (!code || code.trim().length === 0) {
    return { ok: false, reason: 'Invite code required' }
  }

  await ensureInviteCodeIndexes(db)

  const normalized = code.trim().toUpperCase()
  const col = getInviteCodesCollection(db) as any
  const doc = await col.findOne({ code: normalized }) as InviteCodeDoc | null

  if (!doc) return { ok: false, reason: 'Invalid invite code' }
  if (!doc.active) return { ok: false, reason: 'Invite code inactive' }
  if (doc.expires_at && doc.expires_at < new Date()) return { ok: false, reason: 'Invite code expired' }
  if (doc.max_uses > 0 && doc.used_count >= doc.max_uses) return { ok: false, reason: 'Invite code fully redeemed' }

  return { ok: true, doc, normalized }
}

export async function checkInviteCode(db: Db, code?: string): Promise<InviteCodeValidation> {
  const result = await loadInviteCode(db, code)
  if (!result.ok) return { ok: false, grant_credits: 0, reason: result.reason }
  return { ok: true, grant_credits: result.doc.grant_credits }
}

export async function consumeInviteCode(db: Db, code?: string): Promise<InviteCodeValidation> {
  if (!inviteCodeRequired()) {
    return { ok: true, grant_credits: 0 }
  }

  const result = await loadInviteCode(db, code)
  if (!result.ok) return { ok: false, grant_credits: 0, reason: result.reason }

  const { doc, normalized } = result
  const col = getInviteCodesCollection(db) as any
  const update = await col.updateOne(
    { code: normalized, used_count: { $lt: (doc as unknown as Record<string, number>).max_uses } },
    { $inc: { used_count: 1 } },
  )

  if (update.modifiedCount === 0) {
    return { ok: false, grant_credits: 0, reason: 'Invite code fully redeemed' }
  }

  return { ok: true, grant_credits: doc.grant_credits }
}

export async function validateAndConsumeInviteCode(
  db: Db,
  code?: string,
): Promise<InviteCodeValidation> {
  const check = await checkInviteCode(db, code)
  if (!check.ok) return check
  return consumeInviteCode(db, code)
}

export async function seedInviteCodes(db: Db, codes: Array<{ code: string; grant_credits: number; max_uses: number }>): Promise<void> {
  await ensureInviteCodeIndexes(db)
  const col = getInviteCodesCollection(db)
  for (const code of codes) {
    await col.updateOne(
      { code: code.code.toUpperCase() },
      {
        $setOnInsert: {
          code: code.code.toUpperCase(),
          grant_credits: code.grant_credits,
          max_uses: code.max_uses,
          used_count: 0,
          active: true,
          created_at: new Date(),
        },
      },
      { upsert: true },
    )
  }
}
