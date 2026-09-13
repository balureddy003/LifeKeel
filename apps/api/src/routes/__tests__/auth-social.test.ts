/**
 * OAK-001: OAuth (Google/GitHub) signup must reject a tenant_id collision
 * exactly like password signup already does (auth-users.ts:124-127) — the
 * OAuth path derives the same tenant_id from the email local-part but,
 * before this fix, silently admitted a brand-new admin user into whatever
 * tenant already existed there. No test existed for this route at all
 * before this file.
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

function makeDb(existingTenantIds: string[] = []) {
  const users: Record<string, unknown>[] = []
  const tenants: Record<string, unknown>[] = existingTenantIds.map((tenant_id) => ({ tenant_id }))

  const usersCol = {
    findOne: vi.fn(async (filter: { $or?: Record<string, unknown>[] }) =>
      users.find((u) => (filter.$or ?? []).some((clause) => matchesClause(u, clause))) ?? null,
    ),
    insertOne: vi.fn(async (doc: Record<string, unknown>) => {
      users.push(doc)
      return { insertedId: 'stub' }
    }),
    updateOne: vi.fn(async () => ({ acknowledged: true })),
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

async function buildApp(existingTenantIds: string[] = []) {
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['GOOGLE_CLIENT_ID'] = 'g-client'
  process.env['GOOGLE_CLIENT_SECRET'] = 'g-secret'
  process.env['GITHUB_CLIENT_ID'] = 'gh-client'
  process.env['GITHUB_CLIENT_SECRET'] = 'gh-secret'

  const app = Fastify()
  const auth = new AuthService(JWT_SECRET)
  const { db, users, tenants } = makeDb(existingTenantIds)
  await registerSocialAuthRoutes(app, auth, db)
  return { app, users, tenants }
}

describe('OAK-001: OAuth signup rejects a colliding tenant_id', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://oauth2.googleapis.com/token') return jsonResponse({ access_token: 'g-tok' })
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return jsonResponse({ id: 'google-1', email: 'sarah@gmail.com', name: 'Sarah' })
      }
      if (url === 'https://github.com/login/oauth/access_token') return jsonResponse({ access_token: 'gh-tok' })
      if (url === 'https://api.github.com/user') {
        return jsonResponse({ id: 99, email: 'sarah@users.example', login: 'sarah', name: 'Sarah' })
      }
      throw new Error(`unexpected fetch: ${url}`)
    }))
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
