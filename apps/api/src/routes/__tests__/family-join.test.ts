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
import { hashPassword } from '../auth-users.js'

const TENANT = 'tenant-join-test'
const ORGANIZER_ID = 'organizer-user-1'
const OTHER_ADULT_ID = 'other-adult-user-1'
const INVITE_CODE = 'ABC123'

const PENDING_MEMBER_ID = 'pending-member-1'

interface FakeState {
  users: Record<string, unknown>[]
  familyGroups: Record<string, unknown>[]
  joinRequests: Record<string, unknown>[]
  memberInvites: Record<string, unknown>[]
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
          { id: PENDING_MEMBER_ID, name: 'Sam Pending', email: 'sam@example.com', role: 'adult', status: 'pending', joined_at: '2026-01-01T00:00:00.000Z' },
        ],
        created_at: new Date(),
        updated_at: new Date(),
      },
    ],
    joinRequests: [],
    memberInvites: [],
  }
}

function match(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    // 'members.id' — the dotted-path filter the routes use for positional
    // updates on the roster array.
    if (k === 'members.id') return (doc['members'] as { id: string }[]).some((m) => m.id === v)
    return doc[k] === v
  })
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
      if (update.$set) {
        for (const [key, value] of Object.entries(update.$set)) {
          if (key.startsWith('members.$.')) {
            // Positional update — apply to the member matched by the
            // 'members.id' filter.
            const memberId = filter['members.id']
            const member = (doc['members'] as Record<string, unknown>[]).find((m) => m['id'] === memberId)
            if (member) member[key.slice('members.$.'.length)] = value
          } else {
            doc[key] = value
          }
        }
      }
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

  const memberInvitesCol = {
    findOne: async (filter: Record<string, unknown>) => state.memberInvites.find((i) => match(i, filter)) ?? null,
    insertOne: async (doc: Record<string, unknown>) => { state.memberInvites.push(doc); return { insertedId: doc['id'] } },
    deleteOne: async (filter: Record<string, unknown>) => {
      const idx = state.memberInvites.findIndex((i) => match(i, filter))
      if (idx === -1) return { deletedCount: 0 }
      state.memberInvites.splice(idx, 1)
      return { deletedCount: 1 }
    },
    deleteMany: async (filter: Record<string, unknown>) => {
      const before = state.memberInvites.length
      state.memberInvites = state.memberInvites.filter((i) => !match(i, filter))
      return { deletedCount: before - state.memberInvites.length }
    },
    createIndex: async () => undefined,
  }

  return {
    collection: (name: string) => {
      if (name === 'users') return usersCol
      if (name === 'family_groups') return familyGroupsCol
      if (name === 'family_join_requests') return joinRequestsCol
      if (name === 'family_member_invites') return memberInvitesCol
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

// Minimal AuthService stand-in — accept only needs `sign`.
const fakeAuth = { sign: async (payload: { sub: string }) => `signed:${payload.sub}` }

async function buildApp(callerId: string | null) {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (callerId) (request as any).authContext = { tenant_id: TENANT, user_id: callerId }
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerFamilyJoinRoutes(app, makeFakeDb(state) as any, fakeAuth as any)
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
    expect(members).toHaveLength(4) // organizer + other adult + pending sam + new jane
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

describe('POST /family/members/:id/invite (PRD-123)', () => {
  beforeEach(() => { state = makeState() })

  it('creates an invite for a pending adult member and returns the URL', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: `/family/members/${PENDING_MEMBER_ID}/invite`, payload: {} })
    expect(res.statusCode).toBe(201)
    expect(state.memberInvites).toHaveLength(1)
    const invite = state.memberInvites[0]!
    expect(invite['member_id']).toBe(PENDING_MEMBER_ID)
    expect(invite['email']).toBe('sam@example.com')
    expect(String(res.json().invite_url)).toContain(String(invite['token']))
  })

  it('403s for a non-organizer roster member', async () => {
    const app = await buildApp(OTHER_ADULT_ID)
    const res = await app.inject({ method: 'POST', url: `/family/members/${PENDING_MEMBER_ID}/invite`, payload: {} })
    expect(res.statusCode).toBe(403)
    expect(state.memberInvites).toHaveLength(0)
  })

  it('409s for a member who is already active, 400s for a child, 404s for unknown', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const active = await app.inject({ method: 'POST', url: `/family/members/${OTHER_ADULT_ID}/invite`, payload: {} })
    expect(active.statusCode).toBe(409)
    const members = state.familyGroups[0]!['members'] as { id: string; role: string }[]
    members.push({ id: 'kid-1', role: 'child' } as never)
    const child = await app.inject({ method: 'POST', url: '/family/members/kid-1/invite', payload: {} })
    expect(child.statusCode).toBe(400)
    const unknown = await app.inject({ method: 'POST', url: '/family/members/nobody/invite', payload: {} })
    expect(unknown.statusCode).toBe(404)
    expect(state.memberInvites).toHaveLength(0)
  })

  it('takes email from the body when the roster entry has none, and persists it', async () => {
    const members = state.familyGroups[0]!['members'] as Record<string, unknown>[]
    const noEmail = { id: 'no-email-1', name: 'No Email', email: '', role: 'adult', status: 'pending', joined_at: '2026-01-01T00:00:00.000Z' }
    members.push(noEmail)
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/members/no-email-1/invite', payload: { email: 'new@example.com' } })
    expect(res.statusCode).toBe(201)
    expect(noEmail['email']).toBe('new@example.com')
  })

  it('rotates the token on re-invite so only one outstanding invite exists', async () => {
    const app = await buildApp(ORGANIZER_ID)
    await app.inject({ method: 'POST', url: `/family/members/${PENDING_MEMBER_ID}/invite`, payload: {} })
    const first = state.memberInvites[0]!['token']
    await app.inject({ method: 'POST', url: `/family/members/${PENDING_MEMBER_ID}/invite`, payload: {} })
    expect(state.memberInvites).toHaveLength(1)
    expect(state.memberInvites[0]!['token']).not.toBe(first)
  })
})

describe('GET /family/invite/:token and POST /family/invite/accept (PRD-123)', () => {
  beforeEach(() => { state = makeState() })

  async function inviteSam(app: Awaited<ReturnType<typeof buildApp>>): Promise<string> {
    const res = await app.inject({ method: 'POST', url: `/family/members/${PENDING_MEMBER_ID}/invite`, payload: {} })
    expect(res.statusCode).toBe(201)
    return String(state.memberInvites.at(-1)!['token'])
  }

  it('resolves the token to member + family names without exposing financial data', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const token = await inviteSam(app)
    const res = await app.inject({ method: 'GET', url: `/family/invite/${token}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().member_name).toBe('Sam Pending')
    expect(res.json().family_name).toBe('The Rivera Family')
    expect(res.json()).not.toHaveProperty('email')
  })

  it('404s the lookup for an unknown or expired token', async () => {
    const app = await buildApp(ORGANIZER_ID)
    expect((await app.inject({ method: 'GET', url: '/family/invite/not-a-token' })).statusCode).toBe(404)
    const token = await inviteSam(app)
    state.memberInvites[0]!['expires_at'] = new Date(Date.now() - 1000)
    expect((await app.inject({ method: 'GET', url: `/family/invite/${token}` })).statusCode).toBe(404)
  })

  it('accept activates the existing roster entry — no duplicate member, user_id linked', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const token = await inviteSam(app)
    const res = await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token, password: 'password123' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().token).toContain('signed:')

    expect(state.users).toHaveLength(1)
    const user = state.users[0]!
    expect(user['email']).toBe('sam@example.com')
    expect(user['tenant_id']).toBe(TENANT)
    expect(user['roles']).toEqual(['viewer'])

    const members = state.familyGroups[0]!['members'] as Record<string, unknown>[]
    // The roster still has exactly one Sam — the pending entry, now active.
    expect(members.filter((m) => m['email'] === 'sam@example.com')).toHaveLength(1)
    const sam = members.find((m) => m['id'] === PENDING_MEMBER_ID)!
    expect(sam['status']).toBe('active')
    expect(sam['user_id']).toBe(user['id'])
    expect(sam['id']).toBe(PENDING_MEMBER_ID)

    // Token is one-time — deleted on use.
    expect(state.memberInvites).toHaveLength(0)
    const replay = await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token, password: 'password123' } })
    expect(replay.statusCode).toBe(400)
  })

  it('links an existing same-tenant account when the password verifies', async () => {
    state.users.push({ id: 'sam-user', email: 'sam@example.com', tenant_id: TENANT, password_hash: hashPassword('right-password', 's'), salt: 's' })
    const app = await buildApp(ORGANIZER_ID)
    const token = await inviteSam(app)
    const res = await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token, password: 'right-password' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.id).toBe('sam-user')
    expect(state.users).toHaveLength(1)
    const sam = (state.familyGroups[0]!['members'] as Record<string, unknown>[]).find((m) => m['id'] === PENDING_MEMBER_ID)!
    expect(sam['user_id']).toBe('sam-user')
  })

  it('401s on a wrong password for an existing account without consuming the invite', async () => {
    state.users.push({ id: 'sam-user', email: 'sam@example.com', tenant_id: TENANT, password_hash: hashPassword('right-password', 's'), salt: 's' })
    const app = await buildApp(ORGANIZER_ID)
    const token = await inviteSam(app)
    const res = await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token, password: 'wrong-password' } })
    expect(res.statusCode).toBe(401)
    expect(state.memberInvites).toHaveLength(1)
    const sam = (state.familyGroups[0]!['members'] as Record<string, unknown>[]).find((m) => m['id'] === PENDING_MEMBER_ID)!
    expect(sam['status']).toBe('pending')
  })

  it('409s at invite time when the email belongs to a different tenant — and at accept time as defense in depth', async () => {
    state.users.push({ id: 'elsewhere', email: 'sam@example.com', tenant_id: 'other-tenant' })
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: `/family/members/${PENDING_MEMBER_ID}/invite`, payload: {} })
    expect(res.statusCode).toBe(409)
    // Even if an invite somehow exists (email registered between invite and
    // accept), accept refuses cross-tenant linking too.
    state.memberInvites.push({ id: 'stale', tenant_id: TENANT, member_id: PENDING_MEMBER_ID, email: 'sam@example.com', token: 'tok1', expires_at: new Date(Date.now() + 10000), created_at: new Date() })
    const accept = await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token: 'tok1', password: 'password123' } })
    expect(accept.statusCode).toBe(409)
  })

  it('rejects accept on an already-activated member', async () => {
    const app = await buildApp(ORGANIZER_ID)
    const token = await inviteSam(app)
    await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token, password: 'password123' } })
    // A second invite created before the first was used should fail on accept.
    state.memberInvites.push({ id: 'stale', tenant_id: TENANT, member_id: PENDING_MEMBER_ID, email: 'sam@example.com', token: 'stale-token', expires_at: new Date(Date.now() + 10000), created_at: new Date() })
    const res = await app.inject({ method: 'POST', url: '/family/invite/accept', payload: { token: 'stale-token', password: 'password123' } })
    expect(res.statusCode).toBe(400)
  })
})

describe('PRD-123: approve links an existing pending roster member instead of duplicating', () => {
  beforeEach(() => { state = makeState() })

  it('activates the pending entry matched by email rather than pushing a second row', async () => {
    state.joinRequests.push({ id: 'req-1', tenant_id: TENANT, name: 'Sam Pending', email: 'sam@example.com', password_hash: 'x', salt: 'y', status: 'pending', requested_at: new Date() })
    const app = await buildApp(ORGANIZER_ID)
    const res = await app.inject({ method: 'POST', url: '/family/access-requests/req-1/approve' })
    expect(res.statusCode).toBe(200)

    const members = state.familyGroups[0]!['members'] as Record<string, unknown>[]
    expect(members).toHaveLength(3) // organizer + other adult + sam — not 4
    const sam = members.find((m) => m['id'] === PENDING_MEMBER_ID)!
    expect(sam['status']).toBe('active')
    expect(sam['user_id']).toBe(state.users[0]!['id'])
  })
})
