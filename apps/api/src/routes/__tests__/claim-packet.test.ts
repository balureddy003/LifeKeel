/**
 * PRD-235 claim packet: record-only assembly for life policies — contact as
 * printed, policy number, checklist of papers on file or not located, fixed
 * draft. Gaps shown as gaps; nothing sent; no model call.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerClaimPacketRoutes } from '../family-claim-packet.js'

const TENANT = 't-packet'
const ADULT = 'user-sam'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance
let authed = true

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('packet-test')
  app = Fastify()
  app.addHook('onRequest', async (request) => {
    if (authed) {
      ;(request as unknown as Record<string, unknown>)['authContext'] = {
        tenant_id: TENANT,
        user_id: ADULT,
        roles: ['admin'],
      }
    }
  })
  registerClaimPacketRoutes(app, db)
  await app.ready()
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  authed = true
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: TENANT,
    members: [
      { id: 'm-sam', user_id: ADULT, name: 'Sam', role: 'adult', status: 'active' },
      { id: 'm-alex', name: 'Alex', role: 'adult', status: 'active' },
    ],
  })
})

const seed = (policies: Record<string, unknown>[]) =>
  db.collection('family_financial_profile').insertOne({ tenant_id: TENANT, policies })

const packet = (i = 0) => app.inject({ method: 'POST', url: `/family/policies/${i}/claim-packet` })

describe('assembly', () => {
  it('assembles contact, number, holder and checklist from the record', async () => {
    await seed([
      {
        type: 'life',
        provider: 'Acme Life',
        policy_number: 'AL-991',
        member_id: 'm-alex',
        contact_phone: '0800 111 222',
        contact_email: 'claims@acme.example',
      },
    ])
    await db.collection('documents').insertOne({ tenant_id: TENANT, title: 'Acme life policy.pdf' })
    const r = await packet()
    expect(r.statusCode).toBe(200)
    const p = r.json().packet
    expect(p.provider).toBe('Acme Life')
    expect(p.policy_number).toBe('AL-991')
    expect(p.holder).toBe('Alex')
    expect(p.contact.phone).toBe('0800 111 222')
    expect(
      p.checklist.find((c: { item: string }) => c.item === 'The policy document').on_file,
    ).toBe(true)
    expect(
      p.checklist.find((c: { item: string }) => c.item.includes('Death certificate')).on_file,
    ).toBe(false)
    expect(p.draft_notification).toContain('To the claims team at Acme Life')
    expect(p.draft_notification).toContain('AL-991')
    expect(p.authority_note).toContain('claim pack is the authority')
  })

  it('shows gaps as gaps', async () => {
    await seed([{ type: 'life', provider: 'Acme Life', member_id: 'm-sam' }])
    const p = (await packet()).json().packet
    expect(p.gaps).toContain('Policy number not on file')
    expect(p.gaps).toContain('Claims contact not on file')
    expect(p.draft_notification).toContain('not on file')
  })

  it('refuses non-life policies, bad indexes, and unauthenticated calls', async () => {
    await seed([
      { type: 'car', provider: 'Acme' },
      { type: 'life', provider: 'Acme Life' },
    ])
    expect((await packet(0)).statusCode).toBe(400)
    expect((await packet(9)).statusCode).toBe(404)
    authed = false
    expect((await packet(1)).statusCode).toBe(401)
  })
})
