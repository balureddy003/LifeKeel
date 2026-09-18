/**
 * PRD-110: a second real login for an existing family, gated on explicit
 * organizer approval. Covers the core safety property this feature exists
 * to have — POST /family/join never creates a `users` row or grants any
 * access by itself — plus the organizer-only guard on approve/deny/reset,
 * which is a genuinely new check (every other /family/* write today only
 * checks tenant_id, not role, because there was never a second real login
 * to distinguish from the organizer).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { registerFamilyJoinRoutes } from '../family-join.js'

const TENANT = 'tenant-join-test'
const ORGANIZER_ID = 'organizer-user-1'
const OTHER_ADULT_ID = 'other-adult-user-1'
const INVITE_CODE = 'ABC123'

interface FakeState {
  users: Record<string, unknown>[]
  familyGroups: Record<string, unknown>[]
  joinRequests: Record<string, unknown>[]
}

function makeState(): FakeState {
  return {
    users: [],
    familyGroups: [
      {
        id: 'family-1',
        tenant_id: TENANT,
        name: 'The Rivera Family',
        invite_code: INVITE_CODE,
        members: [
          { id: ORGANIZER_ID, name: 'Organizer', email: 'organizer@example.com', role: 'organizer', status: 'active', joined_at: '2026-01-01T00:00:00.000Z' },
          { id: OTHER_ADULT_ID, name: 'Other Adult', email: 'other@example.com', role: 'adult', status: 'active', joined_at: '2026-01-01T00:00:00.000Z' },
        ],
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    joinRequests: [],
  }
}

function match(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => doc[k] === v)
}

function makeFakeDb(state: FakeState) {
  const usersCol = {
    findOne: async (filter: Record<string, unknown>) => state.users.find((u) => match(u, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => { state.users.push(doc); return { insertedId: doc['id'] } },
    createIndex: async () => undefined,
  }

  const familyGroupsCol = {
    findOne: async (filter: Record<string, unknown>) => state.familyGroups.find((f) => match(f, filter)) ?? null,
    updateOne: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown>; $push?: Record<string, unknown> }) => {
      const doc = state.familyGroups.find((f) => match(f, filter))
      if (!doc) return { matchedCount: 0 }
      if (update.$push) {
        for (const [key, value] of Object.entries(update.$push)) {
          ;(doc[key] as unknown[]).push(value)
        }
      }
      if (update.$set) Object.assign(doc, update.$set)
      return { matchedCount: 1 }
    },
    createIndex: async () => undefined,
  }

  const joinRequestsCol = {
    findOne: async (filter: Record<string, unknown>) => state.joinRequests.find((r) => match(r, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => { state.joinRequests.push(doc); return { insertedId: doc['id'] } },
    deleteOne: async (filter: Record<string, unknown>) => {
      const idx = state.joinRequests.findIndex((r) => match(r, filter))
      if (idx === -1) return { deletedCount: 0 }
      state.joinRequests.splice(idx, 1)
      return { deletedCount: 1 }
    },
    find: (filter: Record<string, unknown>) => {
      const results = state.joinRequests.filter((r) => match(r, filter))
      return { sort: () => ({ toArray: async () => results }) }
    },
    createIndex: async () => undefined,
  }

  return {
    collection: (name: string) => {
      if (name === 'users') return usersCol
      if (name === 'family_groups') return familyGroupsCol
      if (name === 'family_join_requests') return joinRequestsCol
      throw new Error(`unexpected collection: ${name}`)
    },
  }
}

let state: FakeState

vi.mock('../../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db.js')>()
  return {
    ...actual,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getDb: async () => makeFakeDb(state) as any,
  }
})

async function buildApp(callerId: string | null) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (callerId) (request as any).authContext = { tenant_id: TENANT, user_id: callerId }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerFamilyJoinRoutes(app, makeFakeDb(state) as any)
  return app
}

describe('POST /family/join', () => {
  beforeEach(() => { state = makeState() })

  it('creates a pending join request and does NOT create a users row', async () => {
    const app = await buildApp(null)
    const res = await app.inject({
      method: 'POST',
      url: '/family/join',
      payload: { invite_code: INVITE_CODE, name: 'Jane Doe', email: 'jane@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(201)
    expect(state.joinRequests).toHaveLength(1)
    expect(state.joinRequests[0]!['status']).toBe('pending')
    // The core safety property this whole feature exists to have.
    expect(state.users).toHaveLength(0)
  })

  it('rejects an invalid invite code with no side effects', async () => {
    const app = await buildApp(null)
    const res = await app.inject({
      method: 'POST',
      url: '/family/join',
      payload: { invite_code: 'WRONGCODE', name: 'Jane Doe', email: 'jane@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(400)
    expect(state.joinRequests).toHaveLength(0)
  })

  it('rejects an email already registered anywhere', async () => {
    state.users.push({ id: 'existing', email: 'jane@example.com', tenant_id: 'some-other-tenant' })
    const app = await buildApp(null)
    const res = await app.inject({
      method: 'POST',
      url: '/family/join',
      payload: { invite_code: INVITE_CODE, name: 'Jane Doe', email: 'jane@example.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already registered/i)
  })

  it('rejects a duplicate pending request for the same email', async () => {
    const app = await buildApp(null)
    await app.inject({ method: 'POST', url: '/family/join', payload: { invite_code: INVITE_CODE, name: 'Jane', email: 'jane@example.com', password: 'password123' } })
    const res = await app.inject({ method: 'POST', url: '/family/join', payload: { invite_code: INVITE_CODE, name: 'Jane', email: 'jane@example.com', password: 'password123' } })
    expect(res.statusCode).toBe(409)
    expect(state.joinRequests).toHaveLength(1)
  })

  it('rejects a short password and a missing name before touching the database', async () => {
    const app = await buildApp(null)
    const shortPw = await app.inject({ method: 'POST', url: '/family/join', payload: { invite_code: INVITE_CODE, name: 'Jane', email: 'jane@example.com', password: 'short' } })
    expect(shortPw.statusCode).toBe(400)
    const noName = await app.inject({ method: 'POST', url: '/family/join', payload: { invite_code: INVITE_CODE, name: '', email: 'jane@example.com', password: 'password123' } })
    expect(noName.statusCode).toBe(400)
    expect(state.joinRequests).toHaveLength(0)
  })
})

describe('organizer-only guard on access-requests / approve / deny / invite-code reset', () => {
  beforeEach(() => { state = makeState() })

  it('403s GET /family/access-requests for a non-organizer roster member', async () => {
    const app = await buildApp(OTHER_ADULT_ID)
    const res = await app.inject({ method: 'GET', url: '/family/access-requests' })
    expect(res.statusCode).toBe(403)
  })

  it('403s approve/deny/reset for a non-organizer roster member', async () => {
    state.joinRequests.push({ id: 'req-1', tenant_id: TENANT, name: 'Jane', email: 'jane@example.com', password_hash: 'x', salt: 'y', status: 'pending', requested_at: new Date() })
    const app = await buildApp(OTHER_ADULT_ID)
    const approve = await app.inject({ method: 'POST', url: '/family/access-requests/req-1/approve' })
    const deny = await app.inject({ method: 'POST', url: '/family/access-requests/req-1/deny' })
    const reset = await app.inject({ method: 'POST', url: '/family/invite-code/reset' })
    expect(approve.statusCode).toBe(403)
    expect(deny.statusCode).toBe(403)
    expect(reset.statusCode).toBe(403)
    // Nothing changed as a side effect of the denied attempt.
    expect(state.joinRequests).toHaveLength(1)
    expect(state.users).toHaveLength(0)
  })

  it('403s for an authenticated caller with no roster entry at all', async () => {
    const app = await buildApp('someone-not-on-the-roster')
    const res = await app.inject({ method: 'GET', url: '/family/access-requests' })
    expect(res.statusCode).toBe(403)
  })

  it('lets the organizer list pending requests', async () => {
    state.joinRequests.push({ id: 'req-1', tenant_id: TENANT, name: 'Jane', email: 'jane@example.com', password_hash: 'x', salt: 'y', status: 'pending', requested_at: new Date() })
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'GET', url: '/family/access-requests' })
    expect(res.statusCode).toBe(200)
    expect(res.json().requests).toHaveLength(1)
    expect(res.json().requests[0].email).toBe('jane@example.com')
  })
})

describe('POST /family/access-requests/:id/approve', () => {
  beforeEach(() => { state = makeState() })

  it('creates a real user sharing the family tenant_id, adds them to the roster as role=adult, and removes the request', async () => {
    state.joinRequests.push({ id: 'req-1', tenant_id: TENANT, name: 'Jane Doe', email: 'jane@example.com', password_hash: 'hashed', salt: 'salt123', status: 'pending', requested_at: new Date() })
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/access-requests/req-1/approve' })

    expect(res.statusCode).toBe(200)
    expect(state.users).toHaveLength(1)
    const newUser = state.users[0]!
    expect(newUser['tenant_id']).toBe(TENANT)
    expect(newUser['email']).toBe('jane@example.com')
    expect(newUser['password_hash']).toBe('hashed')

    const family = state.familyGroups[0]!
    const members = family['members'] as { id: string; role: string; status: string }[]
    expect(members).toHaveLength(3)
    const joined = members.find((m) => m.id === newUser['id'])
    expect(joined?.role).toBe('adult')
    expect(joined?.status).toBe('active')

    expect(state.joinRequests).toHaveLength(0)
  })

  it('404s for a request that does not exist or already resolved', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/access-requests/does-not-exist/approve' })
    expect(res.statusCode).toBe(404)
  })

  it('rejects and discards the request if the email was registered elsewhere since it was made', async () => {
    state.joinRequests.push({ id: 'req-1', tenant_id: TENANT, name: 'Jane', email: 'jane@example.com', password_hash: 'x', salt: 'y', status: 'pending', requested_at: new Date() })
    state.users.push({ id: 'someone-else', email: 'jane@example.com', tenant_id: 'a-different-tenant' })
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/access-requests/req-1/approve' })
    expect(res.statusCode).toBe(409)
    expect(state.joinRequests).toHaveLength(0)
    // Only the pre-existing user, no new one created.
    expect(state.users).toHaveLength(1)
  })
})

describe('POST /family/access-requests/:id/deny', () => {
  beforeEach(() => { state = makeState() })

  it('discards the request without ever touching users', async () => {
    state.joinRequests.push({ id: 'req-1', tenant_id: TENANT, name: 'Jane', email: 'jane@example.com', password_hash: 'x', salt: 'y', status: 'pending', requested_at: new Date() })
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/access-requests/req-1/deny' })
    expect(res.statusCode).toBe(200)
    expect(state.joinRequests).toHaveLength(0)
    expect(state.users).toHaveLength(0)
  })
})

describe('POST /family/invite-code/reset', () => {
  beforeEach(() => { state = makeState() })

  it('replaces the invite code for the organizer', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/invite-code/reset' })
    expect(res.statusCode).toBe(200)
    const newCode = res.json().inviteCode
    expect(newCode).not.toBe(INVITE_CODE)
    expect(state.familyGroups[0]!['invite_code']).toBe(newCode)
  })
})
