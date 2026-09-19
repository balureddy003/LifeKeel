/**
 * PATCH /family/members/:id (and POST /family/members) accepting an
 * optional date_of_birth — the field Financial Profile derives age and
 * years-until-university from, instead of asking for those as raw numbers
 * that drift stale. See apps/web/src/lib/age.ts for the derivation and
 * docs/prd (financial-profile wizard) for the full feature.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import Fastify from 'fastify'
import type { Db } from 'mongodb'
import { registerFamilyGroupRoutes, type FamilyGroupDoc } from '../family-group.js'

const TENANT = 'tenant-dob'

function makeFakeDb(initialDoc: FamilyGroupDoc) {
  let doc: FamilyGroupDoc = structuredClone(initialDoc)
  return {
    collection: () => ({
      createIndex: async () => undefined,
      findOne: async () => doc,
      findOneAndUpdate: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const memberId = filter['members.id'] as string | undefined
        if (memberId && !doc.members.some((m) => m.id === memberId)) return null
        const set = (update['$set'] ?? {}) as Record<string, unknown>
        for (const [path, value] of Object.entries(set)) {
          if (path.startsWith('members.$.')) {
            const field = path.replace('members.$.', '')
            const idx = doc.members.findIndex((m) => m.id === memberId)
            ;(doc.members[idx] as unknown as Record<string, unknown>)[field] = value
          }
        }
        const push = update['$push'] as { members?: FamilyGroupDoc['members'][number] } | undefined
        if (push?.members) doc = { ...doc, members: [...doc.members, push.members] }
        return doc
      },
    }),
  } as unknown as Db
}

function buildApp(fakeDb: Db, userId = 'organizer-1') {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    ;(request as any).authContext = { tenant_id: TENANT, user_id: userId }
  })
  registerFamilyGroupRoutes(app, fakeDb)
  return app
}

const BASE_DOC: FamilyGroupDoc = {
  id: 'family-1',
  tenant_id: TENANT,
  name: 'The Rivera Family',
  invite_code: 'ABC123',
  members: [
    { id: 'organizer-1', name: 'Alex Rivera', email: 'alex@example.com', role: 'organizer', status: 'active', joined_at: '2026-01-01T00:00:00.000Z' },
    { id: 'child-1', name: 'Sam Rivera', email: '', role: 'child', status: 'active', joined_at: '2026-01-01T00:00:00.000Z' },
  ],
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
}

describe('family management authorization', () => {
  it.each([
    { method: 'PATCH' as const, url: '/family/members/child-1', payload: { role: 'organizer' } },
    { method: 'POST' as const, url: '/family/members', payload: { name: 'Another', role: 'adult' } },
    { method: 'DELETE' as const, url: '/family/members/organizer-1' },
    { method: 'PATCH' as const, url: '/family', payload: { name: 'Changed' } },
  ])('rejects non-organizer $method $url', async (request) => {
    const app = buildApp(makeFakeDb(BASE_DOC), 'child-1')
    expect((await app.inject(request)).statusCode).toBe(403)
  })

  it('does not let the last organizer remove their own role', async () => {
    const app = buildApp(makeFakeDb(BASE_DOC))
    expect((await app.inject({ method: 'PATCH', url: '/family/members/organizer-1', payload: { role: 'adult' } })).statusCode).toBe(409)
  })
})

describe('PATCH /family/members/:id — date_of_birth', () => {
  let app: ReturnType<typeof buildApp>
  beforeEach(() => {
    app = buildApp(makeFakeDb(BASE_DOC))
  })

  it('persists a valid date_of_birth and returns it on the member', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/child-1',
      payload: { date_of_birth: '2016-03-01' },
    })
    expect(res.statusCode).toBe(200)
    const child = res.json().family.members.find((m: any) => m.id === 'child-1')
    expect(child.dateOfBirth).toBe('2016-03-01')
  })

  it('leaves role unchanged when only date_of_birth is sent', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/child-1',
      payload: { date_of_birth: '2016-03-01' },
    })
    const child = res.json().family.members.find((m: any) => m.id === 'child-1')
    expect(child.role).toBe('child')
  })

  it('rejects a malformed date', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/child-1',
      payload: { date_of_birth: '03/01/2016' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects an impossible calendar date', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/child-1',
      payload: { date_of_birth: '2016-02-30' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a date of birth in the future', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/child-1',
      payload: { date_of_birth: '2099-01-01' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a request with neither role nor date_of_birth', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/family/members/child-1', payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('still accepts a role-only update, unchanged from before this field existed', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/family/members/child-1',
      payload: { role: 'adult' },
    })
    expect(res.statusCode).toBe(200)
    const child = res.json().family.members.find((m: any) => m.id === 'child-1')
    expect(child.role).toBe('adult')
  })
})

describe('POST /family/members — date_of_birth', () => {
  it('accepts and persists an optional date_of_birth on creation', async () => {
    const app = buildApp(makeFakeDb(BASE_DOC))
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: { name: 'Jamie Rivera', email: '', role: 'child', date_of_birth: '2018-06-15' },
    })
    expect(res.statusCode).toBe(201)
    const added = res.json().family.members.find((m: any) => m.name === 'Jamie Rivera')
    expect(added.dateOfBirth).toBe('2018-06-15')
  })

  it('creates a member with no date_of_birth field at all when omitted', async () => {
    const app = buildApp(makeFakeDb(BASE_DOC))
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: { name: 'Jamie Rivera', email: '', role: 'child' },
    })
    const added = res.json().family.members.find((m: any) => m.name === 'Jamie Rivera')
    expect(added.dateOfBirth).toBeUndefined()
  })

  it('rejects an invalid date_of_birth on creation', async () => {
    const app = buildApp(makeFakeDb(BASE_DOC))
    const res = await app.inject({
      method: 'POST',
      url: '/family/members',
      payload: { name: 'Jamie Rivera', email: '', role: 'child', date_of_birth: 'not-a-date' },
    })
    expect(res.statusCode).toBe(400)
  })
})
