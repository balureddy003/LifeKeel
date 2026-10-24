/**
 * PRD-112: friend referral loop. Covers code generation idempotency,
 * signup attribution (valid/invalid/missing ref, never blocking signup),
 * and the reward-on-first-submit path including the concurrent-double-
 * submit race the unique index on referred_tenant_id guards against.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerReferralRoutes, attributeReferral, rewardReferralIfPending } from '../referrals.js'

vi.mock('../../billing/credit-ledger.js', () => ({
  recordLedgerEntry: vi.fn(async () => null),
}))

const REFERRER = 'tenant-referrer'
const REFEREE = 'tenant-referee'

interface Doc extends Record<string, unknown> {}

function makeFakeDb() {
  const referralCodes: Doc[] = []
  const referrals: Doc[] = []
  const tenants: Doc[] = [
    { tenant_id: REFERRER, billing: { credits_balance: 0 } },
    { tenant_id: REFEREE, billing: { credits_balance: 0 } },
  ]

  function makeCol(store: Doc[], uniqueKeys: string[][] = []) {
    return {
      findOne: async (filter: Record<string, unknown>) =>
        store.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v)) ?? null,
      find: (filter: Record<string, unknown>) => ({
        toArray: async () =>
          store.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)),
      }),
      countDocuments: async (filter: Record<string, unknown>) =>
        store.filter((d) => Object.entries(filter).every(([k, v]) => d[k] === v)).length,
      insertOne: async (doc: Doc) => {
        for (const keys of uniqueKeys) {
          const dup = store.some((d) => keys.every((k) => d[k] === doc[k]))
          if (dup) throw new Error('duplicate key')
        }
        store.push(doc)
        return { insertedId: 'x' }
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $inc?: Record<string, number> },
      ) => {
        const doc = store.find((d) => Object.entries(filter).every(([k, v]) => d[k] === v))
        if (!doc) return { matchedCount: 0, modifiedCount: 0 }
        if (update.$set) Object.assign(doc, update.$set)
        if (update.$inc) {
          for (const [path, amount] of Object.entries(update.$inc)) {
            // Only path actually used here: 'billing.credits_balance'
            const [a, b] = path.split('.')
            ;(doc[a!] as Record<string, number>)[b!] =
              ((doc[a!] as Record<string, number>)[b!] ?? 0) + amount
          }
        }
        return { matchedCount: 1, modifiedCount: 1 }
      },
      createIndex: async () => ({}),
    }
  }

  const referralCodesCol = makeCol(referralCodes, [['code']])
  const referralsCol = makeCol(referrals, [['referred_tenant_id']])
  const tenantsCol = makeCol(tenants)

  return {
    collection: (name: string) =>
      name === 'referral_codes'
        ? referralCodesCol
        : name === 'referrals'
          ? referralsCol
          : tenantsCol,
    _referralCodes: referralCodes,
    _referrals: referrals,
    _tenants: tenants,
  } as any
}

vi.mock('@lifekeel/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lifekeel/platform')>()
  return {
    ...actual,
    getTenantCollection: (db: any, name: string, tenantId: string) => ({
      updateOne: (filter: Record<string, unknown>, update: any) =>
        db.collection(name).updateOne({ tenant_id: tenantId, ...filter }, update),
    }),
  }
})

async function buildApp(db: any) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: REFERRER, user_id: 'user-1' }
  })
  registerReferralRoutes(app, db)
  return app
}

describe('PRD-112: GET /referrals/my-code', () => {
  it('generates a code on first request and returns the same one on repeat calls', async () => {
    const db = makeFakeDb()
    const app = await buildApp(db)

    const first = await app.inject({ method: 'GET', url: '/referrals/my-code' })
    const second = await app.inject({ method: 'GET', url: '/referrals/my-code' })
    expect(first.statusCode).toBe(200)
    expect(first.json().code).toBeTruthy()
    expect(second.json().code).toBe(first.json().code)
  })
})

describe('PRD-112: attributeReferral (signup)', () => {
  it('creates a pending referral for a valid code', async () => {
    const db = makeFakeDb()
    db._referralCodes.push({ tenant_id: REFERRER, code: 'ABC123', created_at: new Date() })

    await attributeReferral(db, REFEREE, 'abc123') // lowercase input, normalized to uppercase
    expect(db._referrals).toHaveLength(1)
    expect(db._referrals[0]).toMatchObject({
      referrer_tenant_id: REFERRER,
      referred_tenant_id: REFEREE,
      status: 'pending',
    })
  })

  it('is a silent no-op for an invalid code — never throws', async () => {
    const db = makeFakeDb()
    await expect(attributeReferral(db, REFEREE, 'NOTREAL')).resolves.toBeUndefined()
    expect(db._referrals).toHaveLength(0)
  })

  it('is a silent no-op when no ref is given', async () => {
    const db = makeFakeDb()
    await expect(attributeReferral(db, REFEREE, undefined)).resolves.toBeUndefined()
    expect(db._referrals).toHaveLength(0)
  })

  it('a tenant can only ever be attributed once — a second attempt is a no-op', async () => {
    const db = makeFakeDb()
    db._referralCodes.push({ tenant_id: REFERRER, code: 'ABC123', created_at: new Date() })
    await attributeReferral(db, REFEREE, 'ABC123')
    await attributeReferral(db, REFEREE, 'ABC123')
    expect(db._referrals).toHaveLength(1)
  })
})

describe('PRD-112: rewardReferralIfPending (first-submit reward)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rewards both tenants exactly once and marks the referral rewarded', async () => {
    const db = makeFakeDb()
    db._referrals.push({
      referrer_tenant_id: REFERRER,
      referred_tenant_id: REFEREE,
      code: 'ABC123',
      status: 'pending',
      created_at: new Date(),
    })

    await rewardReferralIfPending(db, REFEREE)

    expect(db._referrals[0]!['status']).toBe('rewarded')
    const referrerTenant = db._tenants.find((t: Doc) => t['tenant_id'] === REFERRER)!
    const refereeTenant = db._tenants.find((t: Doc) => t['tenant_id'] === REFEREE)!
    expect((referrerTenant['billing'] as Record<string, number>)['credits_balance']).toBe(25)
    expect((refereeTenant['billing'] as Record<string, number>)['credits_balance']).toBe(25)
  })

  it('is a no-op when no pending referral exists for the tenant', async () => {
    const db = makeFakeDb()
    await expect(rewardReferralIfPending(db, REFEREE)).resolves.toBeUndefined()
    const refereeTenant = db._tenants.find((t: Doc) => t['tenant_id'] === REFEREE)!
    expect((refereeTenant['billing'] as Record<string, number>)['credits_balance']).toBe(0)
  })

  it('does not reward a second time once already rewarded', async () => {
    const db = makeFakeDb()
    db._referrals.push({
      referrer_tenant_id: REFERRER,
      referred_tenant_id: REFEREE,
      code: 'ABC123',
      status: 'pending',
      created_at: new Date(),
    })

    await rewardReferralIfPending(db, REFEREE)
    await rewardReferralIfPending(db, REFEREE) // second call — referral is now 'rewarded', not 'pending'

    const refereeTenant = db._tenants.find((t: Doc) => t['tenant_id'] === REFEREE)!
    expect((refereeTenant['billing'] as Record<string, number>)['credits_balance']).toBe(25)
  })

  it('a concurrent double-submit race rewards exactly once, not twice', async () => {
    const db = makeFakeDb()
    db._referrals.push({
      referrer_tenant_id: REFERRER,
      referred_tenant_id: REFEREE,
      code: 'ABC123',
      status: 'pending',
      created_at: new Date(),
    })

    await Promise.all([rewardReferralIfPending(db, REFEREE), rewardReferralIfPending(db, REFEREE)])

    const refereeTenant = db._tenants.find((t: Doc) => t['tenant_id'] === REFEREE)!
    expect((refereeTenant['billing'] as Record<string, number>)['credits_balance']).toBe(25)
  })
})
