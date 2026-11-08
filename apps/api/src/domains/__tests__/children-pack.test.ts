import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { buildDomainView } from '../view.js'
import { getDomain } from '../registry.js'

const T = 't-children'
const NOW = new Date('2026-11-08T00:00:00Z')
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('children-pack-test')
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
      { id: 'finn', name: 'Finn', role: 'child', date_of_birth: '2016-05-04', status: 'active' },
    ],
  })
})

const pack = () => getDomain('children')!

describe('children and school pack', () => {
  it('lists only policies that cover a child, so one policy is not on two lists', async () => {
    await db.collection('family_financial_profile').insertOne({
      tenant_id: T,
      policies: [
        {
          id: 'p-adult',
          type: 'life',
          provider: 'A',
          member_id: 'sam',
          beneficiary_member_id: 'alex',
        },
        {
          id: 'p-child',
          type: 'life',
          provider: 'B',
          member_id: 'sam',
          beneficiary_member_id: 'finn',
        },
        { id: 'p-none', type: 'life', provider: 'C', member_id: 'sam' },
      ],
    })
    const v = await buildDomainView(db, T, pack(), undefined, NOW)
    const ids = v.rows.map((r) => r.id)
    expect(ids).toEqual(['p-child'])
  })

  it('shows nothing until a child date or a child policy is on the list', async () => {
    const v = await buildDomainView(db, T, pack(), undefined, NOW)
    expect(v.rows).toEqual([])
  })

  it('prompts for a school or fees date ahead of time, and in no other words', async () => {
    await db.collection('domain_records').insertOne({
      tenant_id: T,
      id: 'dr1',
      domain_id: 'children',
      record: 'milestone',
      holder_member_id: null,
      covers_member_id: null,
      values: { child: 'finn', type: 'fees_start', date: '2026-12-20' },
      created_by: 'u-sam',
      created_at: NOW,
      updated_at: NOW,
    })
    const v = await buildDomainView(db, T, pack(), undefined, NOW)
    expect(v.upcoming.map((u) => u.label)).toContain('A school or fees date is coming up')
    expect(v.upcoming[0]?.date).toBe('2026-12-20')
  })
})
