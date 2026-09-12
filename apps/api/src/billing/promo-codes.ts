import type { Db } from 'mongodb'
import { getTenantCollection } from '@kairos/platform'
import { getPromoCodesCollection, getPromoRedemptionsCollection, getTenantsCollection } from '../db.js'
import { recordLedgerEntry } from './credit-ledger.js'

interface PromoCodeDoc {
  code: string
  grant_credits: number
  max_uses: number
  used_count: number
  active: boolean
  expires_at?: Date
  created_at: Date
}

interface PromoCodeResult {
  ok: boolean
  grant_credits: number
  new_balance: number
  reason?: string
}

async function ensurePromoCodeIndexes(db: Db): Promise<void> {
  await Promise.all([
    getPromoCodesCollection(db)
      .createIndex({ code: 1 }, { unique: true })
      .catch(() => {}),
    getPromoRedemptionsCollection(db)
      .createIndex({ tenant_id: 1, code: 1 }, { unique: true })
      .catch(() => {}),
  ])
}

export async function redeemPromoCode(
  db: Db,
  tenantId: string,
  code?: string,
): Promise<PromoCodeResult> {
  if (!code || code.trim().length === 0) {
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Promo code required' }
  }

  await ensurePromoCodeIndexes(db)

  const normalized = code.trim().toUpperCase()
  const promoCol = getPromoCodesCollection(db) as any
  const doc = (await promoCol.findOne({ code: normalized })) as PromoCodeDoc | null

  if (!doc) {
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Invalid promo code' }
  }

  if (!doc.active) {
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Promo code inactive' }
  }

  if (doc.expires_at && doc.expires_at < new Date()) {
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Promo code expired' }
  }

  if (doc.max_uses > 0 && doc.used_count >= doc.max_uses) {
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Promo code fully redeemed' }
  }

  // C4 fix: The redemption record insert is the atomic guard.
  // The unique index on { tenant_id, code } prevents duplicate redemptions.
  // We insert the redemption record FIRST — if it fails (duplicate), we bail
  // out before touching the balance. Then we atomically increment the balance
  // with $inc (not $set) so concurrent redemptions of different codes don't
  // overwrite each other.
  try {
    await getPromoRedemptionsCollection(db).insertOne({
      tenant_id: tenantId,
      code: normalized,
      grant_credits: doc.grant_credits,
      redeemed_at: new Date(),
    })
  } catch {
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Promo code already redeemed by this workspace' }
  }

  // Atomic increment of promo code usage
  const codeUpdate = await promoCol.updateOne(
    { code: normalized, used_count: { $lt: (doc as unknown as Record<string, number>).max_uses } },
    { $inc: { used_count: 1 } },
  )

  if (codeUpdate.modifiedCount === 0) {
    // Code was fully redeemed between our check and now — remove the
    // redemption record we just inserted and return error.
    await getPromoRedemptionsCollection(db).deleteOne({
      tenant_id: tenantId, code: normalized,
    }).catch(() => {})
    return { ok: false, grant_credits: 0, new_balance: 0, reason: 'Promo code fully redeemed' }
  }

  // C4 fix: Use $inc (atomic) instead of $set with a read-then-write.
  // This prevents lost updates when two concurrent redemptions of
  // different codes both read the same balance and overwrite each other.
  await getTenantCollection(db, 'tenants', tenantId).updateOne(
    {},
    { $inc: { 'billing.credits_balance': doc.grant_credits }, $set: { updated_at: new Date() } },
  )

  // Read the updated balance after the atomic increment
  const updatedTenant = await getTenantsCollection(db).findOne({ tenant_id: tenantId }) as Record<string, any> | null
  const newBalance = Number(updatedTenant?.['billing']?.['credits_balance'] ?? 0)

  // Record in the append-only credit ledger
  await recordLedgerEntry(db, {
    tenantId,
    type: 'promo_grant',
    amount: doc.grant_credits,
    reference: code.trim().toUpperCase(),
    reason: `Promo code ${code.trim().toUpperCase()} redeemed`,
    actor: 'user',
  }).catch(() => {})

  return { ok: true, grant_credits: doc.grant_credits, new_balance: newBalance }
}
