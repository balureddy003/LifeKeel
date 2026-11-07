import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { summariseDomains } from '../summary.js'

const T = 't-sum'
const NOW = new Date('2026-11-07T00:00:00Z')
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('summary-test')
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
  await db.collection('family_groups').insertOne({
    tenant_id: T,
    members: [
      { id: 'sam', user_id: 'u-sam', name: 'Sam', role: 'organizer', status: 'active' },
      { id: 'alex', user_id: 'u-alex', name: 'Alex', role: 'adult', status: 'active' },
    ],
  })
})

describe('summariseDomains', () => {
  it('says nothing for a household with nothing on file', async () => {
    expect(await summariseDomains(db, T, NOW)).toEqual([])
  })

  it('counts records, notes who has seen them and names the soonest date, without names or amounts', async () => {
    await db.collection('family_financial_profile').insertOne({
      tenant_id: T,
      policies: [
        {
          id: 'p1',
          type: 'life',
          provider: 'Provider A',
          member_id: 'sam',
          renewal_date: '2026-11-20',
        },
        { id: 'p2', type: 'life', provider: 'Provider B', member_id: 'alex' },
        { id: 'p3', type: 'car', provider: 'Motor Co', member_id: 'sam' },
      ],
    })
    const lines = await summariseDomains(db, T, NOW)
    const life = lines.find((l) => l.title === 'Life and income protection')!
    expect(life).toMatchObject({ records: 2, seen_by_all: false })
    expect(life.next).toEqual({ label: 'A policy renewal date is coming up', date: '2026-11-20' })
    expect(lines.find((l) => l.title === 'Car and transport')).toMatchObject({
      records: 1,
      next: null,
    })
    expect(JSON.stringify(lines)).not.toMatch(/Provider|Motor|Sam|Alex/)
  })

  it('reports seen-by-all once every adult has confirmed the current version', async () => {
    await db.collection('family_financial_profile').insertOne({
      tenant_id: T,
      policies: [{ id: 'p1', type: 'life', provider: 'A', member_id: 'sam' }],
    })
    const { buildDomainView } = await import('../view.js')
    const { getDomain } = await import('../registry.js')
    const pack = getDomain('life_protection')!
    const v = await buildDomainView(db, T, pack)
    for (const u of ['u-sam', 'u-alex'])
      await db.collection('domain_confirmations').insertOne({
        tenant_id: T,
        domain_id: pack.id,
        user_id: u,
        result_version: v.result_version,
        confirmed_at: NOW,
      })
    const life = (await summariseDomains(db, T, NOW)).find((l) => l.title === pack.title)!
    expect(life.seen_by_all).toBe(true)
  })
})
