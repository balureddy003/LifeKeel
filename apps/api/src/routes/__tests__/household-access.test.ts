/**
 * Household access boundaries from the security review, against a real
 * MongoDB (MongoMemoryServer):
 *  - R03: removing a member ends their login and sessions.
 *  - R05: export never carries MFA material, and a viewer gets only their own record.
 *  - Deleting the household is the organizer's decision, not any member's.
 *  - R09: deletion cancels the subscription, and retries until it can.
 *  - R43: family and member names can't carry links or phone numbers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerFamilyGroupRoutes } from '../family-group.js'
import { registerAccountRoutes } from '../account.js'
import { cancelSubscriptionForDeletedTenant } from '../../billing/cancel-on-delete.js'

const TENANT = 'tenant-household'
const ORGANIZER = { id: 'org-1', role: 'organizer' as const }
const MEMBER = { id: 'mem-1', role: 'adult' as const }

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('household-access')
})

beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('tenants').insertOne({ tenant_id: TENANT, status: 'active' })
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    name: 'The Testers',
    members: [
      {
        id: ORGANIZER.id,
        name: 'Org',
        email: 'org@example.com',
        role: 'organizer',
        status: 'active',
        joined_at: '2026-01-01',
      },
      {
        id: MEMBER.id,
        name: 'Mem',
        email: 'mem@example.com',
        role: 'adult',
        status: 'active',
        joined_at: '2026-01-01',
      },
    ],
  })
  await db.collection('users').insertMany([
    {
      id: ORGANIZER.id,
      tenant_id: TENANT,
      email: 'org@example.com',
      roles: ['admin'],
      status: 'active',
    },
    {
      id: MEMBER.id,
      tenant_id: TENANT,
      email: 'mem@example.com',
      roles: ['viewer'],
      status: 'active',
      password_hash: 'h',
      salt: 's',
      mfa_secret: 'dek:secret',
      mfa_recovery_hashes: ['abc'],
      mfa_pending_secret: 'pending',
    },
  ])
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

async function appAs(userId: string, roles: string[]): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.authContext = { tenant_id: TENANT, user_id: userId, roles } as never
  })
  registerFamilyGroupRoutes(app, db)
  registerAccountRoutes(app, db)
  await app.ready()
  return app
}

describe('R03: removing a member ends their access', () => {
  it('marks the login removed, revokes its sessions and drops pending invites', async () => {
    await db
      .collection('family_member_invites')
      .insertOne({ tenant_id: TENANT, member_id: MEMBER.id, token: 'x' })
    const app = await appAs(ORGANIZER.id, ['admin'])
    const res = await app.inject({ method: 'DELETE', url: `/family/members/${MEMBER.id}` })
    expect(res.statusCode).toBe(200)
    const user = await db.collection('users').findOne({ id: MEMBER.id })
    expect(user?.['status']).toBe('removed')
    expect(user?.['sessions_revoked_at']).toBeInstanceOf(Date)
    expect(
      await db.collection('family_member_invites').countDocuments({ member_id: MEMBER.id }),
    ).toBe(0)
    const organizer = await db.collection('users').findOne({ id: ORGANIZER.id })
    expect(organizer?.['status']).toBe('active')
  })
})

describe('R05: export', () => {
  it('never includes password or MFA material in any user record', async () => {
    const app = await appAs(ORGANIZER.id, ['admin'])
    const res = await app.inject({ method: 'GET', url: '/account/export' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.scope).toBe('household')
    const text = res.body
    for (const secret of [
      'mfa_secret',
      'mfa_recovery_hashes',
      'mfa_pending_secret',
      'password_hash',
      'dek:secret',
    ]) {
      expect(text, secret).not.toContain(secret)
    }
    expect(body.household_users.map((u: { id: string }) => u.id).sort()).toEqual(
      [MEMBER.id, ORGANIZER.id].sort(),
    )
  })

  it('a viewer exports their own account and roster entry, not the household', async () => {
    await db
      .collection('documents')
      .insertOne({ tenant_id: TENANT, id: 'will', category: 'estate_vault', filename: 'will.pdf' })
    const app = await appAs(MEMBER.id, ['viewer'])
    const res = await app.inject({ method: 'GET', url: '/account/export' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.scope).toBe('self')
    expect(body.user.id).toBe(MEMBER.id)
    expect(body.family_member.id).toBe(MEMBER.id)
    expect(body.documents).toBeUndefined()
    expect(res.body).not.toContain('will.pdf')
  })
})

describe('deleting the household', () => {
  it('is refused for a viewer, even with the right confirmation', async () => {
    const app = await appAs(MEMBER.id, ['viewer'])
    const res = await app.inject({
      method: 'POST',
      url: '/account/delete',
      payload: { confirmation: 'mem@example.com' },
    })
    expect(res.statusCode).toBe(403)
    expect((await db.collection('tenants').findOne({ tenant_id: TENANT }))?.['status']).toBe(
      'active',
    )
  })
})

describe('R09: cancelling billing on deletion', () => {
  it('cancels the subscription and clears it, treating an already-cancelled one as done', async () => {
    await db
      .collection('tenants')
      .updateOne(
        { tenant_id: TENANT },
        { $set: { stripe_subscription_id: 'sub_1', 'billing.cancellation_pending': true } },
      )
    const cancel = vi.fn(async () => ({}))
    const ok = await cancelSubscriptionForDeletedTenant(db, TENANT, {
      subscriptions: { cancel },
    } as never)
    expect(ok).toBe(true)
    expect(cancel).toHaveBeenCalledWith('sub_1', undefined, {
      idempotencyKey: `delete-${TENANT}-sub_1`,
    })
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT })
    expect(tenant?.['stripe_subscription_id']).toBeUndefined()
    expect(tenant?.['billing']?.['cancellation_pending']).toBeUndefined()
  })

  it('keeps the pending flag when Stripe fails, so the replay retries', async () => {
    await db
      .collection('tenants')
      .updateOne(
        { tenant_id: TENANT },
        { $set: { stripe_subscription_id: 'sub_2', 'billing.cancellation_pending': true } },
      )
    const cancel = vi.fn(async () => {
      throw Object.assign(new Error('network down'), { code: 'api_connection_error' })
    })
    const ok = await cancelSubscriptionForDeletedTenant(db, TENANT, {
      subscriptions: { cancel },
    } as never)
    expect(ok).toBe(false)
    const tenant = await db.collection('tenants').findOne({ tenant_id: TENANT })
    expect(tenant?.['stripe_subscription_id']).toBe('sub_2')
    expect(tenant?.['billing']?.['cancellation_pending']).toBe(true)
  })
})

describe('R43: names in outbound email', () => {
  it('a family or member name carrying a link or phone number is refused', async () => {
    const app = await appAs(ORGANIZER.id, ['admin'])
    const add = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: {
        name: 'Account suspended, call 0800 123 4567',
        email: 'x@example.com',
        role: 'adult',
      },
    })
    expect(add.statusCode).toBe(400)
  })
})
