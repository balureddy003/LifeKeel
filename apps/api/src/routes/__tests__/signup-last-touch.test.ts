/**
 * Marketing intelligence: signup stores the visitor's last touch next to the
 * first touch, sanitised the same way — known keys only, bounded strings —
 * because both are client-supplied and unverifiable (analytics, not auth).
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

async function signupWith(body: Record<string, unknown>) {
  const app = Fastify()
  await registerAuthUserRoutes(app, new AuthService('test-secret'))
  return app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: {
      email: 'person@example.com',
      name: 'Test Person',
      password: 'long-enough-password',
      workspace: 'touch-workspace',
      ...body,
    },
  })
}

beforeEach(() => {
  tenants.length = 0
  users.length = 0
})

describe('POST /auth/signup stores last touch beside first touch', () => {
  it('keeps both, sanitised', async () => {
    const res = await signupWith({
      attribution: { utm_source: 'bluesky', utm_campaign: 'pillar_chart' },
      last_touch: {
        utm_source: 'x',
        utm_campaign: 'pillar_guides',
        utm_content: 'post_9',
        evil: 'drop me',
        referrer: 'r'.repeat(5000),
      },
    })
    expect(res.statusCode).toBe(201)
    const stored = users[0]!
    expect(stored['attribution']).toEqual({ utm_source: 'bluesky', utm_campaign: 'pillar_chart' })
    const last = stored['last_touch'] as Record<string, string>
    expect(last).toMatchObject({
      utm_source: 'x',
      utm_campaign: 'pillar_guides',
      utm_content: 'post_9',
    })
    expect(last).not.toHaveProperty('evil')
    expect(last['referrer']!.length).toBeLessThanOrEqual(300)
  })

  it('is optional — a signup with no last touch still succeeds', async () => {
    const res = await signupWith({ attribution: { utm_source: 'bluesky' } })
    expect(res.statusCode).toBe(201)
    expect(users[0]!['last_touch']).toBeUndefined()
  })

  it('ignores a last touch that is not an object', async () => {
    const res = await signupWith({ last_touch: 'utm_source=x' })
    expect(res.statusCode).toBe(201)
    expect(users[0]!['last_touch']).toBeUndefined()
  })
})
