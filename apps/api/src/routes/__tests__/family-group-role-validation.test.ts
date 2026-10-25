/**
 * Live-verification finding: neither POST /family/members nor
 * PATCH /family/members/:id validated `role` at runtime — only
 * TypeScript-typed, which doesn't exist once a request actually arrives.
 * Confirmed live: a member persisted with an out-of-enum role value gets no
 * ROLE_LABELS/ROLE_BRANCHES entry on the frontend, silently rendering with
 * no label and no sections ("Nothing set up for X yet") instead of a clean
 * rejection at the point the bad data was written.
 *
 * Both requests use a role invalid enough (400) to prove the check runs
 * before any Mongo call — the fake `db` below would throw if `collection()`
 * were ever invoked with real query intent, so a passing test here means
 * validation genuinely short-circuits before the database, not just that
 * the final response happens to be a 400.
 */

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { Db } from 'mongodb'
import { registerFamilyGroupRoutes } from '../family-group.js'

const TENANT = 'tenant-role-validation'

function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: 'user-1' }
  })
  // Registration calls db.collection('family_groups') once; a handler
  // reaching a real query beyond that is exactly what this test asserts
  // never happens for an invalid role, so findOneAndUpdate is intentionally
  // absent from this stub.
  const fakeDb = {
    collection: () => ({ createIndex: async () => undefined }),
  } as unknown as Db
  registerFamilyGroupRoutes(app, fakeDb)
  return app
}

describe('POST /family/members rejects an invalid role', () => {
  it.each(['partner', 'guardian', 'owner', ''])('rejects role=%s with 400', async (role) => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: { name: 'Alex Rivera', email: 'alex@example.com', role },
    })
    expect(res.statusCode).toBe(400)
  })

  it('names the valid roles in the error message', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: { name: 'Alex Rivera', email: 'alex@example.com', role: 'partner' },
    })
    const body = res.json()
    expect(body.error).toContain('organizer')
    expect(body.error).toContain('parent')
    expect(body.error).toContain('adult')
    expect(body.error).toContain('child')
  })
})

describe('PATCH /family/members/:id rejects an invalid role', () => {
  it('rejects role=partner with 400', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/some-id',
      payload: { role: 'partner' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /family/members relationship_label validation (intent 25)', () => {
  it('rejects an out-of-enum relationship_label with 400 before any DB call', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: {
        name: 'Alex Rivera',
        email: 'alex@example.com',
        role: 'child',
        relationship_label: 'cousin',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects relationship_label on a non-child member', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: {
        name: 'Sam Rivera',
        email: 'sam@example.com',
        role: 'adult',
        relationship_label: 'my_child',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('child')
  })
})

describe('PATCH /family/members/:id relationship_label validation', () => {
  it('rejects an out-of-enum relationship_label with 400', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/member-1',
      payload: { relationship_label: 'cousin' },
    })
    expect(res.statusCode).toBe(400)
  })
})
