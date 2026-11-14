/**
 * GET /audit-log/operator-access (G-OFI-04): a household sees when LifeKeel
 * staff opened or changed its account, and nothing about other households
 * or the operator's identity and reason.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerAuditLogRoutes } from '../audit-log.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

async function buildApp(
  tenantId = 'family-1',
  userId = 'user-a',
  roles: string[] = ['admin'],
): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.authContext = { tenant_id: tenantId, user_id: userId, roles }
  })
  registerAuditLogRoutes(app, db)
  await app.ready()
  return app
}

function op(action: string, targetType: string, targetId: string, minutesAgo: number) {
  return {
    operator_user_id: 'operator-1',
    operator_roles: ['support'],
    operator_source: 'database',
    action,
    target_type: targetType,
    target_id: targetId,
    reason: 'internal note that must not leak',
    request_id: 'req',
    ip: '10.0.0.1',
    user_agent: 'ua',
    created_at: new Date(Date.now() - minutesAgo * 60_000),
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('operator-access')
})

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('users').insertMany([
    { id: 'user-a', tenant_id: 'family-1' },
    { id: 'user-b', tenant_id: 'family-1' },
    { id: 'user-x', tenant_id: 'family-10' },
  ])
  await db
    .collection('tenants')
    .insertMany([{ tenant_id: 'family-1', id: 'fam-1-alias' }, { tenant_id: 'family-10' }])
  await db.collection('operator_audit_log').insertMany([
    op('operator.user.view', 'user', 'user-a', 1),
    op('operator.user.password_reset', 'user', 'user-b', 2),
    op('operator.tenant.suspend', 'tenant', 'fam-1-alias', 3),
    op('operator.connector.revoke', 'connector', 'family-1/gmail', 4),
    // Other household, including one whose id shares the prefix "family-1".
    op('operator.user.view', 'user', 'user-x', 5),
    op('operator.connector.revoke', 'connector', 'family-10/gmail', 6),
    op('operator.tenant.view', 'tenant', 'family-10', 7),
    // Not about a household at all.
    op('operator.blog.publish', 'blog_post', 'post-1', 8),
    // About this household, but not on the household-visible allow-list.
    op('autopilot.propose', 'user', 'user-a', 9),
    op('operator.dual_control.request', 'tenant', 'family-1', 10),
  ])
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('GET /audit-log/operator-access', () => {
  it('lists only operator activity on this household, newest first', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/audit-log/operator-access' })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<Record<string, unknown>>
    expect(entries.map((e) => e['action'])).toEqual([
      'operator.user.view',
      'operator.user.password_reset',
      'operator.tenant.suspend',
      'operator.connector.revoke',
    ])
    expect(entries.map((e) => e['about_you'])).toEqual([true, false, false, false])
  })

  it('never returns the operator identity, reason or request metadata', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/audit-log/operator-access' })
    const body = res.body
    for (const leak of ['operator-1', 'internal note', '10.0.0.1', 'support', 'user-b']) {
      expect(body).not.toContain(leak)
    }
    expect(Object.keys(res.json().entries[0]).sort()).toEqual([
      'about_you',
      'action',
      'target_type',
      'timestamp',
    ])
  })

  it('pages with the "before" cursor and rejects a bad one', async () => {
    const app = await buildApp()
    const first = await app.inject({ method: 'GET', url: '/audit-log/operator-access?limit=2' })
    const page1 = first.json().entries as Array<{ timestamp: string }>
    expect(page1).toHaveLength(2)
    const next = await app.inject({
      method: 'GET',
      url: `/audit-log/operator-access?before=${encodeURIComponent(page1[1].timestamp)}`,
    })
    expect(next.json().entries).toHaveLength(2)
    const bad = await app.inject({ method: 'GET', url: '/audit-log/operator-access?before=nope' })
    expect(bad.statusCode).toBe(400)
  })

  it('treats regex characters in a tenant id literally', async () => {
    await db
      .collection('operator_audit_log')
      .insertOne(op('operator.connector.revoke', 'connector', 'famXly/gmail', 0))
    const app = await buildApp('fam.ly', 'nobody')
    const res = await app.inject({ method: 'GET', url: '/audit-log/operator-access' })
    expect(res.json().entries).toEqual([])
  })

  it('hides automated and unconfirmed rows that are not on the allow-list', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/audit-log/operator-access?limit=100' })
    const actions = (res.json().entries as Array<{ action: string }>).map((e) => e.action)
    expect(actions).not.toContain('autopilot.propose')
    expect(actions).not.toContain('operator.dual_control.request')
  })

  it("shows a non-editor only staff actions on their own account, not other members'", async () => {
    await db.collection('family_groups').insertOne({
      tenant_id: 'family-1',
      members: [{ id: 'm-a', user_id: 'user-a', role: 'adult', status: 'active' }],
    })
    const app = await buildApp('family-1', 'user-a', ['viewer'])
    const res = await app.inject({ method: 'GET', url: '/audit-log/operator-access' })
    const actions = (res.json().entries as Array<{ action: string }>).map((e) => e.action)
    expect(actions).toContain('operator.user.view')
    expect(actions).not.toContain('operator.user.password_reset')
    expect(actions).toContain('operator.tenant.suspend')
  })
})
