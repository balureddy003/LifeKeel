/**
 * OAK-001: OAuth (Google/GitHub) signup must reject a tenant_id collision
 * exactly like password signup already does (auth-users.ts:124-127) — the
 * OAuth path derives the same tenant_id from the email local-part but,
 * before this fix, silently admitted a brand-new admin user into whatever
 * tenant already existed there. No test existed for this route at all
 * before this file.
 *
 * OAK-005: a login that matches an EXISTING user by email alone (not by an
 * already-linked external_id+provider) must not be silently merged into
 * that account unless the provider attests the email as verified —
 * otherwise anyone who signs up with an unverified copy of someone else's
 * email address could get linked into that person's account.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import crypto from 'node:crypto'
import Fastify from 'fastify'
import { AuthService } from '@agentoak/platform'
import { registerSocialAuthRoutes } from '../auth-social.js'

const JWT_SECRET = 'test-secret'

function signState(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')
  return `${body}.${sig}`
}

function matchesClause(doc: Record<string, unknown>, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([k, v]) => doc[k] === v)
}

function makeDb(existingTenantIds: string[] = [], existingUsers: Record<string, unknown>[] = []) {
  const users: Record<string, unknown>[] = existingUsers.map((u) => ({ _id: u['id'], ...u }))
  const tenants: Record<string, unknown>[] = existingTenantIds.map((tenant_id) => ({ tenant_id }))

  const usersCol = {
    findOne: vi.fn(async (filter: { $or?: Record<string, unknown>[] }) =>
      users.find((u) => (filter.$or ?? []).some((clause) => matchesClause(u, clause))) ?? null,
    ),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => {
      users.push(doc)
      return { insertedId: 'stub' }
    }),
    // Mutates the stored doc — OAK-005's merge tests assert the persisted
    // email_verified/external_id after a merge, not just insert counts.
    updateOne: vi.fn(async (filter: { _id: unknown }, update: { $set: Record<string, unknown> }) => {
      const doc = users.find((u) => u['_id'] === filter._id)
      if (doc) Object.assign(doc, update.$set)
      return { acknowledged: true }
    }),
  }
  const tenantsCol = {
    findOne: vi.fn(async (filter: { tenant_id: string }) => tenants.find((t) => t['tenant_id'] === filter.tenant_id) ?? null),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => {
      tenants.push(doc)
      return { insertedId: 'stub' }
    }),
  }

  const db = {
    collection: (name: string) => {
      if (name === 'users') return usersCol
      if (name === 'tenants') return tenantsCol
      throw new Error(`unexpected collection: ${name}`)
    },
  }
  return { db: db as any, users, tenants }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response
}

async function buildApp(existingTenantIds: string[] = [], existingUsers: Record<string, unknown>[] = []) {
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['GOOGLE_CLIENT_ID'] = 'g-client'
  process.env['GOOGLE_CLIENT_SECRET'] = 'g-secret'
  process.env['GITHUB_CLIENT_ID'] = 'gh-client'
  process.env['GITHUB_CLIENT_SECRET'] = 'gh-secret'

  const app = Fastify()
  const auth = new AuthService(JWT_SECRET)
  const { db, users, tenants } = makeDb(existingTenantIds, existingUsers)
  await registerSocialAuthRoutes(app, auth, db)
  return { app, users, tenants }
}

// Module-level so per-test overrides (googleVerifiedEmail/githubEmailVerified)
// can vary the mocked userinfo/emails responses without redefining the whole stub.
let googleVerifiedEmail = true
let githubEmailVerified = true

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'g-tok' })
    if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
      return jsonResponse({ id: 'google-1', email: 'sarah@gmail.com', name: 'Sarah', verified_email: googleVerifiedEmail })
    }
    if (url === 'https://github.com/login/oauth/access_token') return jsonResponse({ access_token: 'gh-tok' })
    if (url === 'https://api.github.com/user') {
      return jsonResponse({ id: 99, email: 'sarah@users.example', login: 'sarah', name: 'Sarah' })
    }
    if (url === 'https://api.github.com/user/emails') {
      return jsonResponse([{ email: 'sarah@users.example', primary: true, verified: githubEmailVerified }])
    }
    throw new Error(`unexpected fetch: ${url}`)
  }))
}

describe('OAK-001: OAuth signup rejects a colliding tenant_id', () => {
  beforeEach(() => {
    googleVerifiedEmail = true
    githubEmailVerified = true
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POST /auth/google/exchange: 409 + no user inserted when tenant_id "sarah" already exists', async () => {
    const { app, users } = await buildApp(['sarah'])
    const state = signState({ provider: 'google' })

    const res = await app.inject({ method: 'POST', url: '/auth/google/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already taken/i)
    expect(users).toHaveLength(0)
  })

  it('GET /auth/google/callback: redirects with error=workspace_taken, no user inserted', async () => {
    const { app, users } = await buildApp(['sarah'])
    const state = signState({ provider: 'google', app: 'family' })

    const res = await app.inject({ method: 'GET', url: `/auth/google/callback?code=c&state=${encodeURIComponent(state)}` })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/error=workspace_taken/)
    expect(users).toHaveLength(0)
  })

  it('POST /auth/github/exchange: 409 + no user inserted when tenant_id "sarah" already exists', async () => {
    const { app, users } = await buildApp(['sarah'])
    const state = signState({ provider: 'github' })

    const res = await app.inject({ method: 'POST', url: '/auth/github/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/already taken/i)
    expect(users).toHaveLength(0)
  })

  it('GET /auth/github/callback: redirects with error=workspace_taken, no user inserted', async () => {
    const { app, users } = await buildApp(['sarah'])
    const state = signState({ provider: 'github' })

    const res = await app.inject({ method: 'GET', url: `/auth/github/callback?code=c&state=${encodeURIComponent(state)}` })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/error=workspace_taken/)
    expect(users).toHaveLength(0)
  })

  it('non-colliding new signup still succeeds on both providers', async () => {
    const { app: googleApp, users: googleUsers, tenants: googleTenants } = await buildApp([])
    const googleState = signState({ provider: 'google' })
    const googleRes = await googleApp.inject({ method: 'POST', url: '/auth/google/exchange', payload: { code: 'c', state: googleState } })
    expect(googleRes.statusCode).toBe(200)
    expect(googleUsers).toHaveLength(1)
    expect(googleTenants).toHaveLength(1)

    const { app: githubApp, users: githubUsers } = await buildApp([])
    const githubState = signState({ provider: 'github' })
    const githubRes = await githubApp.inject({ method: 'POST', url: '/auth/github/exchange', payload: { code: 'c', state: githubState } })
    expect(githubRes.statusCode).toBe(200)
    expect(githubUsers).toHaveLength(1)
  })
})

describe('OAK-005: OAuth merge onto an existing account requires a verified email', () => {
  beforeEach(() => {
    googleVerifiedEmail = true
    githubEmailVerified = true
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const existingUserByEmail = { id: 'existing-1', email: 'sarah@gmail.com', tenant_id: 'sarah-family', roles: ['admin'] }
  const existingUserByExternalId = { id: 'existing-2', email: 'someone-else@example.com', tenant_id: 'other-family', roles: ['admin'], external_id: 'google-1', external_provider: 'google' }

  it('Google: unverified email matched by email alone is rejected (409), user untouched', async () => {
    googleVerifiedEmail = false
    const { app, users } = await buildApp([], [existingUserByEmail])
    const state = signState({ provider: 'google' })

    const res = await app.inject({ method: 'POST', url: '/auth/google/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/not verified/i)
    expect(users[0]?.['external_id']).toBeUndefined()
  })

  it('Google: verified email matched by email alone merges successfully', async () => {
    googleVerifiedEmail = true
    const { app, users } = await buildApp([], [existingUserByEmail])
    const state = signState({ provider: 'google' })

    const res = await app.inject({ method: 'POST', url: '/auth/google/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(200)
    expect(users[0]?.['external_id']).toBe('google-1')
    expect(users[0]?.['email_verified']).toBe(true)
  })

  it('Google: match via already-linked external_id+provider merges regardless of verified_email', async () => {
    googleVerifiedEmail = false
    const { app } = await buildApp([], [existingUserByExternalId])
    const state = signState({ provider: 'google' })

    const res = await app.inject({ method: 'POST', url: '/auth/google/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(200)
  })

  it('Google: GET /auth/google/callback redirects with error=email_not_verified when unverified', async () => {
    googleVerifiedEmail = false
    const { app, users } = await buildApp([], [existingUserByEmail])
    const state = signState({ provider: 'google', app: 'family' })

    const res = await app.inject({ method: 'GET', url: `/auth/google/callback?code=c&state=${encodeURIComponent(state)}` })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toMatch(/error=email_not_verified/)
    expect(users[0]?.['external_id']).toBeUndefined()
  })

  it('GitHub: unverified email matched by email alone is rejected (403), user untouched', async () => {
    githubEmailVerified = false
    const existingGithubUser = { id: 'existing-3', email: 'sarah@users.example', tenant_id: 'sarah-family', roles: ['admin'] }
    const { app, users } = await buildApp([], [existingGithubUser])
    const state = signState({ provider: 'github' })

    const res = await app.inject({ method: 'POST', url: '/auth/github/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/not verified/i)
    expect(users[0]?.['external_id']).toBeUndefined()
  })

  it('GitHub: verified email matched by email alone merges successfully', async () => {
    githubEmailVerified = true
    const existingGithubUser = { id: 'existing-4', email: 'sarah@users.example', tenant_id: 'sarah-family', roles: ['admin'] }
    const { app, users } = await buildApp([], [existingGithubUser])
    const state = signState({ provider: 'github' })

    const res = await app.inject({ method: 'POST', url: '/auth/github/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(200)
    expect(users[0]?.['external_id']).toBe('99')
  })

  it('GitHub: match via already-linked external_id+provider merges regardless of verified flag', async () => {
    githubEmailVerified = false
    const existingGithubUser = { id: 'existing-5', email: 'someone-else@example.com', tenant_id: 'other-family', roles: ['admin'], external_id: '99', external_provider: 'github' }
    const { app } = await buildApp([], [existingGithubUser])
    const state = signState({ provider: 'github' })

    const res = await app.inject({ method: 'POST', url: '/auth/github/exchange', payload: { code: 'c', state } })

    expect(res.statusCode).toBe(200)
  })
})
