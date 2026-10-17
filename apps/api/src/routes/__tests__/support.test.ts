import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerSupportRoutes } from '../support.js'
import { registerOperatorRoutes } from '../operator.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

async function buildApp(userId = 'user-1', withOperator = false): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook('onRequest', async (request) => {
    request.authContext = { user_id: userId, tenant_id: 'family-1', roles: ['admin'] }
  })
  registerSupportRoutes(app, db)
  if (withOperator) await registerOperatorRoutes(app, db)
  await app.ready()
  return app
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('support-routes')
})

beforeEach(async () => {
  await db.dropDatabase()
  await db.collection('users').insertMany([
    { id: 'user-1', tenant_id: 'family-1', email: 'one@example.com', name: 'One', roles: ['admin'], status: 'active', created_at: new Date() },
    { id: 'user-2', tenant_id: 'family-2', email: 'two@example.com', name: 'Two', roles: ['admin'], status: 'active', created_at: new Date() },
    { id: 'operator-1', tenant_id: 'operator-tenant', email: 'op@example.com', name: 'Op', roles: ['admin'], status: 'active', created_at: new Date() },
  ])
  await db.collection('tenants').insertOne({ tenant_id: 'family-1', name: 'Family One', plan: 'plus', status: 'active', created_at: new Date() })
})

afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('support channel', () => {
  it('answers /support/ask gracefully even without an LLM provider', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/support/ask', payload: { question: 'How do I add a family member?' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(typeof body.answer).toBe('string')
    // No LLM key in test env — falls back honestly.
    expect(body.isLive).toBe(false)
    await app.close()
  })

  it('creates a case with the triage transcript and lists only the owner\'s cases', async () => {
    const app = await buildApp('user-1')
    const create = await app.inject({
      method: 'POST',
      url: '/support/cases',
      payload: {
        subject: 'Cannot add my partner',
        message: 'The invite code says invalid',
        triage: [{ question: 'how do invites work?', answer: 'Each member joins via the invite code in Family settings.' }],
      },
    })
    expect(create.statusCode).toBe(201)
    const created = create.json().case
    expect(created.status).toBe('open')
    expect(created.ai_triaged).toBe(true)
    // triage turn + the escalation message
    expect(created.messages).toHaveLength(3)
    expect(created.messages[1].author).toBe('keel')
    expect(created.email).toBe('one@example.com')

    // Another user sees none of it.
    const other = await buildApp('user-2')
    const list = await other.inject({ method: 'GET', url: '/support/cases' })
    expect(list.json().cases).toHaveLength(0)
    const denied = await other.inject({ method: 'GET', url: `/support/cases/${created.id}` })
    expect(denied.statusCode).toBe(404)
    await other.close()
    await app.close()
  })

  it('appends user messages and reopens a resolved case', async () => {
    const app = await buildApp('user-1')
    const create = await app.inject({
      method: 'POST', url: '/support/cases',
      payload: { subject: 'Billing question', message: 'I was charged twice' },
    })
    const id = create.json().case.id
    await db.collection('support_cases').updateOne({ id }, { $set: { status: 'resolved' } })

    const res = await app.inject({ method: 'POST', url: `/support/cases/${id}/messages`, payload: { text: 'It happened again' } })
    expect(res.statusCode).toBe(200)
    const doc = await db.collection('support_cases').findOne({ id })
    expect(doc?.['status']).toBe('open')
    expect(doc?.['messages']).toHaveLength(2)
    expect(doc?.['resolved_at']).toBeUndefined()
    await app.close()
  })

  it('operator lists, replies, and resolves — with audit entries', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const userApp = await buildApp('user-1')
    const create = await userApp.inject({
      method: 'POST', url: '/support/cases',
      payload: { subject: 'Locked out', message: 'My account shows suspended' },
    })
    const id = create.json().case.id
    await userApp.close()

    const op = await buildApp('operator-1', true)
    const list = await op.inject({ method: 'GET', url: '/operator/support?status=open' })
    expect(list.statusCode).toBe(200)
    expect(list.json().cases).toHaveLength(1)
    expect(list.json().statuses.open).toBe(1)

    const detail = await op.inject({ method: 'GET', url: `/operator/support/${id}` })
    expect(detail.json().user.email).toBe('one@example.com')
    expect(detail.json().tenant.plan).toBe('plus')

    const replyRes = await op.inject({ method: 'POST', url: `/operator/support/${id}/reply`, payload: { text: 'We lifted the suspension — try signing in again.' } })
    expect(replyRes.statusCode).toBe(200)
    let doc = await db.collection('support_cases').findOne({ id })
    expect(doc?.['status']).toBe('answered')
    expect(doc?.['messages'].at(-1)?.['author']).toBe('operator')

    const resolve = await op.inject({ method: 'POST', url: `/operator/support/${id}/resolve`, payload: { reason: 'Customer confirmed access restored' } })
    expect(resolve.statusCode).toBe(200)

    const reopen = await op.inject({ method: 'POST', url: `/operator/support/${id}/reopen`, payload: { reason: 'Customer replied again' } })
    expect(reopen.statusCode).toBe(200)
    doc = await db.collection('support_cases').findOne({ id })
    expect(doc?.['status']).toBe('open')

    const actions = (await db.collection('operator_audit_log').find({ target_id: id }).toArray()).map((e) => e['action']).sort()
    expect(actions).toEqual(['operator.support.reopen', 'operator.support.reply', 'operator.support.resolve'])
    await op.close()
  })

  it('denies the inbox to roles without support.read', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['finance_operator'] })
    const app = await buildApp('operator-1', true)
    const res = await app.inject({ method: 'GET', url: '/operator/support' })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('denies reply/draft to read-only support roles', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['operations'] })
    const userApp = await buildApp('user-1')
    const create = await userApp.inject({
      method: 'POST', url: '/support/cases',
      payload: { subject: 'Question', message: 'Something' },
    })
    const id = create.json().case.id
    await userApp.close()

    const app = await buildApp('operator-1', true)
    // operations has support.read but not support.manage
    const read = await app.inject({ method: 'GET', url: `/operator/support/${id}` })
    expect(read.statusCode).toBe(200)
    const replyRes = await app.inject({ method: 'POST', url: `/operator/support/${id}/reply`, payload: { text: 'hi' } })
    expect(replyRes.statusCode).toBe(403)
    const draft = await app.inject({ method: 'POST', url: `/operator/support/${id}/draft`, payload: {} })
    expect(draft.statusCode).toBe(403)
    await app.close()
  })

  it('draft endpoint degrades to 503 without an LLM provider', async () => {
    await db.collection('platform_operators').insertOne({ user_id: 'operator-1', status: 'active', roles: ['support'] })
    const userApp = await buildApp('user-1')
    const create = await userApp.inject({
      method: 'POST', url: '/support/cases',
      payload: { subject: 'Plan question', message: 'What does Plus include?' },
    })
    const id = create.json().case.id
    await userApp.close()

    const app = await buildApp('operator-1', true)
    const res = await app.inject({ method: 'POST', url: `/operator/support/${id}/draft`, payload: {} })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})
