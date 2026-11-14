/**
 * GET /family reports a pending member's invite status from the invites
 * that actually exist (intent 63): no invite → 'not_sent', an invite →
 * 'sent', an opened invite → 'viewed'. A pending adult added in setup used
 * to read "Invite sent" before anyone had been invited.
 */

import { describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { Db } from 'mongodb'
import { registerFamilyGroupRoutes, type FamilyGroupDoc } from '../family-group.js'

const TENANT = 'tenant-invites'

const DOC: FamilyGroupDoc = {
  id: 'family-1',
  tenant_id: TENANT,
  name: 'The Rivera Family',
  invite_code: 'ABC123',
  members: [
    {
      id: 'org',
      name: 'Alex',
      email: 'alex@example.com',
      role: 'organizer',
      status: 'active',
      joined_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'never',
      name: 'Bo',
      email: '',
      role: 'adult',
      status: 'pending',
      joined_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'sent',
      name: 'Cy',
      email: 'cy@example.com',
      role: 'adult',
      status: 'pending',
      joined_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'opened',
      name: 'Di',
      email: 'di@example.com',
      role: 'parent',
      status: 'pending',
      joined_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
}

const INVITES = [
  { tenant_id: TENANT, member_id: 'sent' },
  { tenant_id: TENANT, member_id: 'opened', viewed_at: new Date('2026-02-01T00:00:00.000Z') },
]

function fakeDb(): Db {
  return {
    collection: (name: string) => ({
      createIndex: async () => undefined,
      findOne: async () => (name === 'family_groups' ? DOC : null),
      find: () => ({ toArray: async () => (name === 'family_member_invites' ? INVITES : []) }),
    }),
  } as unknown as Db
}

describe('GET /family invite status', () => {
  it('reports not_sent, sent and viewed from the invites on file', async () => {
    const app = Fastify()
    app.addHook('onRequest', async (request) => {
      ;(request as unknown as { authContext: unknown }).authContext = {
        tenant_id: TENANT,
        user_id: 'org',
      }
    })
    registerFamilyGroupRoutes(app, fakeDb())

    const res = await app.inject({ method: 'GET', url: '/family' })
    expect(res.statusCode).toBe(200)
    const members = res.json().family.members as {
      id: string
      inviteStatus?: string
      inviteViewedAt?: string
    }[]
    const byId = Object.fromEntries(members.map((m) => [m.id, m]))
    expect(byId['org']?.inviteStatus).toBeUndefined()
    expect(byId['never']?.inviteStatus).toBe('not_sent')
    expect(byId['sent']?.inviteStatus).toBe('sent')
    expect(byId['opened']?.inviteStatus).toBe('viewed')
    expect(byId['opened']?.inviteViewedAt).toBe('2026-02-01T00:00:00.000Z')
  })
})
