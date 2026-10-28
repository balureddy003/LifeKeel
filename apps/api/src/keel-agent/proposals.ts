/**
 * Tier 1 proposals: Keel prepares a settings change, the signed-in organizer
 * applies it with their own click. Keel has no write path of its own — the
 * confirm route re-checks identity, role, expiry and current values, then
 * writes only PROPOSABLE_SETTINGS keys. It never calls ActionExecutor.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import type { KeelContext } from './context.js'
import { unwrapDoc } from './mongo-result.js'
import {
  PROPOSABLE_SETTINGS,
  currentNotificationSettings,
  type ProposableKey,
  type ProposableValue,
  type SettingChange,
} from './presets.js'

const PROPOSAL_TTL_MS = 15 * 60 * 1000

type ProposalFields = {
  id: string
  user_id: string
  preset_id: string
  diff: SettingChange[]
  status: 'pending' | 'applying' | 'applied' | 'dismissed' | 'conflict'
  created_at: Date
  expires_at: Date
  decided_at?: Date
  approved_by?: string
}

export type ProposalDoc = ProposalFields & { tenant_id: string } & Record<string, unknown>

export type ConfirmResult =
  { ok: true } | { ok: false; code: 'not_found' | 'forbidden' | 'conflict' | 'failed' }

const proposals = (db: Db, ctx: KeelContext) =>
  getTenantCollection<ProposalDoc>(db, 'keel_proposals', ctx.tenant_id)

export async function createProposal(
  db: Db,
  ctx: KeelContext,
  presetId: string,
  diff: SettingChange[],
): Promise<ProposalDoc | null> {
  if (!ctx.isOrganizer || diff.length === 0) return null
  const now = new Date()
  const doc: ProposalFields = {
    id: randomUUID(),
    user_id: ctx.user_id,
    preset_id: presetId,
    diff,
    status: 'pending',
    created_at: now,
    expires_at: new Date(now.getTime() + PROPOSAL_TTL_MS),
  }
  await proposals(db, ctx).insertOne(doc)
  return { ...doc, tenant_id: ctx.tenant_id }
}

/** Owner-scoped lookup: another user's or another tenant's id is simply not found. */
const owned = (ctx: KeelContext, id: string) => ({ id, user_id: ctx.user_id })

export async function confirmProposal(
  db: Db,
  ctx: KeelContext,
  id: string,
): Promise<ConfirmResult> {
  const col = proposals(db, ctx)
  const now = new Date()
  // Claim atomically so a double click cannot apply twice.
  const doc = unwrapDoc<ProposalDoc>(
    await col.findOneAndUpdate(
      { ...owned(ctx, id), status: 'pending', expires_at: { $gt: now } },
      { $set: { status: 'applying' } },
      { returnDocument: 'after' },
    ),
  )
  if (!doc) return { ok: false, code: 'not_found' }

  const release = (status: ProposalDoc['status']) =>
    col.updateOne({ id }, { $set: { status, decided_at: new Date() } })

  if (!ctx.isOrganizer) {
    await release('pending')
    return { ok: false, code: 'forbidden' }
  }

  // Re-validate against what is saved now; if anything moved, make a fresh proposal.
  const current = await currentNotificationSettings(db, ctx)
  const stale = doc.diff.some((c) => current[c.key] !== c.from)
  if (stale) {
    await release('conflict')
    return { ok: false, code: 'conflict' }
  }

  const $set: Record<string, ProposableValue | Date> = { reviewed_at: new Date() }
  for (const change of doc.diff) {
    if (!PROPOSABLE_SETTINGS.includes(change.key as ProposableKey)) {
      await release('conflict')
      return { ok: false, code: 'failed' }
    }
    $set[change.key] = change.to
  }

  try {
    await getTenantCollection(db, 'delivery_preferences', ctx.tenant_id).updateOne(
      {},
      {
        $set,
        ...($set['digest_mode'] === true ? { $unset: { digest_offer: '' } } : {}),
        $setOnInsert: { enabled: true },
      },
      { upsert: true },
    )
  } catch {
    await release('pending')
    return { ok: false, code: 'failed' }
  }

  await col.updateOne(
    { id },
    { $set: { status: 'applied', decided_at: new Date(), approved_by: ctx.user_id } },
  )
  return { ok: true }
}

export async function dismissProposal(db: Db, ctx: KeelContext, id: string): Promise<boolean> {
  const res = (await proposals(db, ctx).updateOne(
    { ...owned(ctx, id), status: 'pending' },
    { $set: { status: 'dismissed', decided_at: new Date() } },
  )) as { matchedCount?: number; modifiedCount?: number }
  return (res.matchedCount ?? res.modifiedCount ?? 0) > 0
}
