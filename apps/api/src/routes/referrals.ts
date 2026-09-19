/**
 * PRD-112: friend referral loop — a standard invite-a-friend growth
 * mechanic, deliberately distinct from PRD-110's family invite_code
 * (which adds a real household member to an *existing* family) and from
 * auth-users.ts's own `invite_code` concept (a platform-wide B2B signup
 * gate). This one attributes a brand-new, separate signup to whoever
 * referred them, and rewards both once the referred family has actually
 * started using the product.
 *
 * GET /referrals/my-code — the caller's own shareable referral code (generated on first request)
 * GET /referrals         — the caller's own referral summary (pending/rewarded counts)
 *
 * rewardReferralIfPending() is exported for family-financial-profile.ts
 * to call on a tenant's first-ever final profile submit — the "real use
 * has started" milestone, not just an account existing.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import { getReferralCodesCollection, getReferralsCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { recordLedgerEntry } from '../billing/credit-ledger.js'
import { generateInviteCode } from './family-group.js'

// Matches pack_25, the smallest existing credit pack — a reasonable
// default reward size, not a magic number chosen for this feature alone.
const REFERRAL_REWARD_CREDITS = 25

async function getOrCreateReferralCode(db: Db, tenantId: string): Promise<string> {
  const col = getReferralCodesCollection(db)
  const existing = await col.findOne({ tenant_id: tenantId })
  if (existing) return existing['code'] as string

  // Globally unique, same astronomically-rare-collision retry shape as
  // POST /family/invite-code/reset in family-join.ts.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    try {
      await col.insertOne({ tenant_id: tenantId, code, created_at: new Date() })
      return code
    } catch {
      continue
    }
  }
  throw new Error('Could not generate a referral code')
}

async function creditTenant(db: Db, tenantId: string, referredTenantId: string): Promise<void> {
  await getTenantCollection(db, 'tenants', tenantId).updateOne(
    {},
    { $inc: { 'billing.credits_balance': REFERRAL_REWARD_CREDITS }, $set: { updated_at: new Date() } },
  )
  await recordLedgerEntry(db, {
    tenantId,
    type: 'referral_reward',
    amount: REFERRAL_REWARD_CREDITS,
    reference: referredTenantId,
    reason: 'Friend referral reward',
    actor: 'system',
  }).catch(() => {})
}

/**
 * Called on a tenant's first-ever final profile submit. No-op if there's
 * no pending referral for this tenant (the common case). The update's
 * own filter (status: 'pending') is the atomic guard against a
 * concurrent double-reward — a second racing call finds modifiedCount
 * 0 and does nothing further, the same shape redeemPromoCode's
 * insert-as-guard uses for promo codes.
 */
export async function rewardReferralIfPending(db: Db, referredTenantId: string): Promise<void> {
  const referralsCol = getReferralsCollection(db)
  const referral = await referralsCol.findOne({ referred_tenant_id: referredTenantId, status: 'pending' })
  if (!referral) return

  const result = await referralsCol.updateOne(
    { referred_tenant_id: referredTenantId, status: 'pending' },
    { $set: { status: 'rewarded', rewarded_at: new Date() } },
  )
  if (result.modifiedCount === 0) return

  const referrerTenantId = referral['referrer_tenant_id'] as string
  await creditTenant(db, referrerTenantId, referredTenantId)
  await creditTenant(db, referredTenantId, referredTenantId)

  getAuditLogger()?.log({
    tenant_id: referredTenantId,
    user_id: 'system',
    action: 'referral.rewarded',
    resource_type: 'referral',
    resource_id: referredTenantId,
    metadata: { referrer_tenant_id: referrerTenantId, credits: REFERRAL_REWARD_CREDITS },
    ip: '',
    user_agent: '',
    timestamp: new Date(),
  })
}

/**
 * Called from auth-users.ts's signup handler once the new tenant exists.
 * Silent no-op on an invalid/missing code or a tenant that's somehow
 * already attributed — signup must never fail because of a bad referral
 * code, and the unique index on referred_tenant_id is the real guard
 * against double-attribution.
 */
export async function attributeReferral(db: Db, referredTenantId: string, ref?: string): Promise<void> {
  if (!ref?.trim()) return
  const code = ref.trim().toUpperCase()
  const codeDoc = await getReferralCodesCollection(db).findOne({ code })
  if (!codeDoc) return
  const referrerTenantId = codeDoc['tenant_id'] as string
  if (referrerTenantId === referredTenantId) return // defensive — not reachable at signup time, the tenant doesn't exist yet

  try {
    await getReferralsCollection(db).insertOne({
      referrer_tenant_id: referrerTenantId,
      referred_tenant_id: referredTenantId,
      code,
      status: 'pending',
      created_at: new Date(),
    })
  } catch {
    // Unique index on referred_tenant_id rejected a duplicate — fine,
    // silently ignored, same posture as an invalid code.
    return
  }

  getAuditLogger()?.log({
    tenant_id: referredTenantId,
    user_id: 'system',
    action: 'referral.attributed',
    resource_type: 'referral',
    resource_id: referredTenantId,
    metadata: { referrer_tenant_id: referrerTenantId },
    ip: '',
    user_agent: '',
    timestamp: new Date(),
  })
}

export function registerReferralRoutes(fastify: FastifyInstance, db: Db): void {
  getReferralCodesCollection(db).createIndex({ code: 1 }, { unique: true }).catch(() => {})
  getReferralCodesCollection(db).createIndex({ tenant_id: 1 }, { unique: true }).catch(() => {})
  getReferralsCollection(db).createIndex({ referred_tenant_id: 1 }, { unique: true }).catch(() => {})

  fastify.get('/referrals/my-code', async (req) => {
    const { tenant_id } = req.authContext
    const code = await getOrCreateReferralCode(db, tenant_id)
    return { code }
  })

  fastify.get('/referrals', async (req) => {
    const { tenant_id } = req.authContext
    const docs = await getReferralsCollection(db).find({ referrer_tenant_id: tenant_id }).toArray()
    const pending = docs.filter((d) => d['status'] === 'pending').length
    const rewarded = docs.filter((d) => d['status'] === 'rewarded').length
    return { pending, rewarded }
  })
}
