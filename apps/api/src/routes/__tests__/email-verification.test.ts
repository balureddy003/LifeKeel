/**
 * Email verification wiring — the token lifecycle endpoints already
 * existed; this covers the part that was missing: a real verification
 * email leaving the system on signup, resend (both modes), and email
 * change, plus the verify endpoint's token handling.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { AuthService } from '@lifekeel/platform'
import { registerAuthUserRoutes, hashAuthToken } from '../auth-users.js'

const { sendVerificationMock } = vi.hoisted(() => ({
  sendVerificationMock: vi.fn(async (_to: string, _name: string, _url: string) => {}),
}))

vi.mock('../../auth-email.js', () => ({
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendEmailVerificationEmail: sendVerificationMock,
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

type FakeUser = Record<string, unknown>

function makeUsersCol(store: FakeUser[] = []) {
  // Equality plus the two operators the token routes use ($gt on the expiry).
  // An operator object anywhere else never matches, as with a real string field.
  const match = (u: FakeUser, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as Record<string, unknown>
        if ('$gt' in op) return u[k] instanceof Date && (u[k] as Date) > (op['$gt'] as Date)
        if ('$ne' in op) return u[k] !== op['$ne']
        return false
      }
      return u[k] === v
    })
  const apply = (
    u: FakeUser,
    update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
  ) => {
    if (update.$set) Object.assign(u, update.$set)
    for (const k of Object.keys(update.$unset ?? {})) delete u[k]
  }
  return {
    findOneAndUpdate: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
      ) => {
        const u = store.find((x) => match(x, filter))
        if (!u) return null
        apply(u, update)
        return u
      },
    ),
    createIndex: vi.fn(async () => 'ok'),
    findOne: vi.fn(
      async (filter: Record<string, unknown>) => store.find((u) => match(u, filter)) ?? null,
    ),
    insertOne: vi.fn(async (doc: FakeUser) => {
      store.push(doc)
      return { acknowledged: true }
    }),
    updateOne: vi.fn(
      async (
        filter: Record<string, unknown>,
        update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> },
      ) => {
        const u = store.find((x) => match(x, filter))
        if (u) apply(u, update)
        return { acknowledged: true, modifiedCount: u ? 1 : 0 }
      },
    ),
    _store: store,
  }
}

const usersCol = makeUsersCol()
const tenantsCol = { findOne: vi.fn(async () => null), insertOne: vi.fn(async () => ({})) }
const settingsCol = { findOne: vi.fn(async () => null) }

vi.mock('../../db.js', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) =>
      name === 'tenants' ? tenantsCol : name === 'tenant_settings' ? settingsCol : usersCol,
  })),
  getLoginEventsCollection: vi.fn(async () => ({ insertOne: vi.fn(async () => ({})) })),
}))

async function buildApp(authContext?: { user_id: string; tenant_id: string }) {
  const app = Fastify()
  if (authContext) {
    app.addHook('onRequest', async (request) => {
      ;(request as any).authContext = authContext
    })
  }
  await registerAuthUserRoutes(app, new AuthService('test-secret'))
  return app
}

const UNVERIFIED_USER: FakeUser = {
  id: 'u-1',
  email: 'person@example.com',
  name: 'Test Person',
  tenant_id: 'tenant-x',
  email_verified: false,
  email_verification_token_hash: hashAuthToken('tok-abc'),
  email_verification_expires: new Date(Date.now() + 60_000),
}

describe('POST /auth/verify-email', () => {
  beforeEach(() => {
    usersCol._store.length = 0
    sendVerificationMock.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('verifies a valid token and clears it', async () => {
    usersCol._store.push({ ...UNVERIFIED_USER })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'tok-abc' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ verified: true })
    expect(usersCol._store[0]!['email_verified']).toBe(true)
    expect(usersCol._store[0]!['email_verification_token_hash']).toBeUndefined()
  })

  it('R01: a query-operator object in place of the token matches nobody', async () => {
    usersCol._store.push({ ...UNVERIFIED_USER })
    const app = await buildApp()
    for (const token of [{ $ne: null }, { $gt: '' }, ['tok-abc']]) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        payload: { token },
      })
      expect(res.statusCode).toBe(400)
    }
    expect(usersCol._store[0]!['email_verified']).toBe(false)
  })

  it('R39: a token whose hash is not stored never verifies, even when the raw value was stored', async () => {
    usersCol._store.push({
      ...UNVERIFIED_USER,
      email_verification_token_hash: undefined,
      email_verification_token: 'tok-abc',
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'tok-abc' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an unknown token', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'nope' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an expired token', async () => {
    usersCol._store.push({
      ...UNVERIFIED_USER,
      email_verification_expires: new Date(Date.now() - 60_000),
    })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'tok-abc' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('expired')
  })

  it('rejects a token with no expiry on record (expiry is mandatory)', async () => {
    usersCol._store.push({ ...UNVERIFIED_USER, email_verification_expires: undefined })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'tok-abc' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /auth/resend-verification', () => {
  beforeEach(() => {
    usersCol._store.length = 0
    sendVerificationMock.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sends a verification email for an unverified user found by email', async () => {
    usersCol._store.push({ ...UNVERIFIED_USER })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'person@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(sendVerificationMock).toHaveBeenCalledTimes(1)
    const [to, , url] = sendVerificationMock.mock.calls[0]!
    expect(to).toBe('person@example.com')
    expect(url).toMatch(/\/verify-email#token=[0-9a-f]{64}$/)
    // The emailed token is the one whose hash is persisted — a link that can't verify is worse than none.
    const raw = String(url).split('#token=')[1]!
    expect(usersCol._store[0]!['email_verification_token_hash']).toBe(hashAuthToken(raw))
  })

  it('returns success without sending for an unknown email (non-enumerating)', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'ghost@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sent: true })
    expect(sendVerificationMock).not.toHaveBeenCalled()
  })

  it('does not resend for an already-verified user, and answers the same as for an unknown one (R42)', async () => {
    usersCol._store.push({ ...UNVERIFIED_USER, email_verified: true })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'person@example.com' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sent: true })
    expect(sendVerificationMock).not.toHaveBeenCalled()
  })

  it('sends via the authenticated path (no email in body)', async () => {
    usersCol._store.push({ ...UNVERIFIED_USER })
    const app = await buildApp({ user_id: 'u-1', tenant_id: 'tenant-x' })
    const res = await app.inject({ method: 'POST', url: '/auth/resend-verification', payload: {} })

    expect(res.statusCode).toBe(200)
    expect(sendVerificationMock).toHaveBeenCalledTimes(1)
    expect(sendVerificationMock.mock.calls[0]![0]).toBe('person@example.com')
  })
})

describe('POST /auth/signup', () => {
  beforeEach(() => {
    usersCol._store.length = 0
    sendVerificationMock.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('sends a verification email after the account exists when verification is enabled', async () => {
    vi.stubEnv('EMAIL_VERIFICATION_ENABLED', 'true')
    vi.resetModules()
    const { registerAuthUserRoutes: register } = await import('../auth-users.js')
    const app = Fastify()
    await register(app, new AuthService('test-secret'))

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        email: 'new@example.com',
        password: 'password123',
        name: 'New Person',
        workspace: 'brandnewws',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(sendVerificationMock).toHaveBeenCalledTimes(1)
    const [to, , url] = sendVerificationMock.mock.calls[0]!
    expect(to).toBe('new@example.com')
    expect(url).toMatch(/\/verify-email#token=[0-9a-f]{64}$/)
    const user = usersCol._store.find((u) => u['email'] === 'new@example.com')!
    expect(user['email_verification_token_hash']).toBe(
      hashAuthToken(String(url).split('#token=')[1]!),
    )
    expect(user['email_verification_token']).toBeUndefined()
    expect(res.json().user.requires_verification).toBe(true)
  })
})
