/**
 * UAT D16: a deleted account's tenant row is intentionally kept as an
 * audit tombstone (status: 'deleted'), but signup rejected ANY existing
 * tenant slug — so the same email could never re-register ("workspace
 * name already taken" forever). The tombstone's slug stays reserved;
 * signup now mints a suffixed slug instead of a permanent 409. Live
 * tenants ('active', 'trial', 'deleting' — the wipe may be mid-flight)
 * still block.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { AuthService } from '@lifekeel/platform'
import { registerAuthUserRoutes } from '../auth-users.js'

vi.mock('../../auth-email.js', () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendEmailVerificationEmail: vi.fn(async () => {}),
  sendFamilyInviteEmail: vi.fn(async () => {}),
}))
vi.mock('../invite-codes.js', () => ({
  checkInviteCode: vi.fn(async () => ({ ok: true })),
  consumeInviteCode: vi.fn(async () => ({ ok: true, grant_credits: 0 })),
}))
vi.mock('../billing/credit-ledger.js', () => ({ recordLedgerEntry: vi.fn(async () => {}) }))
vi.mock('../operator/platform-config.js', () => ({
  getPlatformConfig: vi.fn(async () => ({ signups_enabled: true })),
}))
vi.mock('../referrals.js', () => ({ attributeReferral: vi.fn(async () => {}) }))

type Doc = Record<string, unknown>

const tenants: Doc[] = []
const users: Doc[] = []

const match = (doc: Doc, filter: Record<string, unknown>) =>
  Object.entries(filter).every(([k, v]) => doc[k] === v)

const tenantsCol = {
  findOne: vi.fn(
    async (filter: Record<string, unknown>) => tenants.find((t) => match(t, filter)) ?? null,
  ),
  insertOne: vi.fn(async (doc: Doc) => {
    tenants.push(doc)
    return { acknowledged: true }
  }),
}
const usersCol = {
  createIndex: vi.fn(async () => 'ok'),
  findOne: vi.fn(
    async (filter: Record<string, unknown>) => users.find((u) => match(u, filter)) ?? null,
  ),
  insertOne: vi.fn(async (doc: Doc) => {
    users.push(doc)
    return { acknowledged: true }
  }),
}
const settingsCol = { findOne: vi.fn(async () => null) }

vi.mock('../../db.js', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) =>
      name === 'tenants' ? tenantsCol : name === 'tenant_settings' ? settingsCol : usersCol,
  })),
  getLoginEventsCollection: vi.fn(async () => ({ insertOne: vi.fn(async () => ({})) })),
}))

async function signup(email = 'person@example.com', workspace?: string) {
  const app = Fastify()
  await registerAuthUserRoutes(app, new AuthService('test-secret'))
  return app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, name: 'Test Person', password: 'long-enough-password', workspace },
  })
}

beforeEach(() => {
  tenants.length = 0
  users.length = 0
  vi.clearAllMocks()
})

describe('POST /auth/signup with a deleted tenant tombstone', () => {
  it("re-registers past a 'deleted' tombstone by minting a suffixed slug", async () => {
    tenants.push({ tenant_id: 'person', status: 'deleted', name: 'person' })
    const res = await signup()
    expect(res.statusCode).toBe(201)
    const newTenant = tenants.find((t) => t['status'] === 'active')!
    expect(newTenant['tenant_id']).toBe('person-2')
    expect(res.json().user.tenant_id).toBe('person-2')
    // The tombstone itself is untouched — its slug stays reserved.
    expect(tenants.find((t) => t['tenant_id'] === 'person')?.['status']).toBe('deleted')
  })

  it('still 409s on a live tenant holding the slug', async () => {
    tenants.push({ tenant_id: 'person', status: 'active' })
    const res = await signup()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toContain('already taken')
    expect(users).toHaveLength(0)
  })

  it("still 409s on a 'deleting' tenant — the wipe may be mid-flight", async () => {
    tenants.push({ tenant_id: 'person', status: 'deleting' })
    const res = await signup()
    expect(res.statusCode).toBe(409)
  })

  it('walks past stacked tombstones to the next free slug', async () => {
    tenants.push({ tenant_id: 'person', status: 'deleted' })
    tenants.push({ tenant_id: 'person-2', status: 'deleted' })
    const res = await signup()
    expect(res.statusCode).toBe(201)
    expect(tenants.find((t) => t['status'] === 'active')?.['tenant_id']).toBe('person-3')
  })
})
