/**
 * Cover matrix: employer cover appears as a row beside policies, so a household
 * whose only cover is through a job still shows it. Facts on file only.
 * Fictional data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { buildDomainView } from '../view.js'
import { getDomain } from '../registry.js'

const T = 't-cover-matrix'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('cover-matrix-test')
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
      { id: 'sam', user_id: 'u-sam', name: 'Sam Rowan', role: 'organizer', status: 'active' },
      { id: 'alex', user_id: 'u-alex', name: 'Alex Rowan', role: 'adult', status: 'active' },
    ],
  })
  await db.collection('family_financial_profile').insertOne({
    tenant_id: T,
    policies: [{ id: 'p1', type: 'life', provider: 'Example Life Ltd', member_id: 'sam' }],
  })
  await db.collection('employer_cover_facts').insertOne({
    id: 'ec1',
    tenant_id: T,
    member_label: 'Alex Rowan',
    type: 'death_in_service',
    name_as_printed: 'Acme Group Life',
    ends_with_employment: true,
  })
})

describe('life protection matrix with employer cover', () => {
  it('adds a row for employer cover with the employee’s cell marked as through their employer', async () => {
    const v = await buildDomainView(db, T, getDomain('life_protection')!)
    const rows = v.matrix!.rows
    expect(rows.map((r) => r.id)).toEqual(['p1', 'ec1'])
    expect(rows[1]!.cells).toEqual({ sam: null, alex: 'employer' })
    expect(rows[0]!.cells).toEqual({ sam: 'holds', alex: null })
  })

  it('labels the employer row with what is printed, not a judgement', async () => {
    const v = await buildDomainView(db, T, getDomain('life_protection')!)
    expect(v.matrix!.rows[1]!.label).toContain('Acme Group Life')
  })

  it('lists each person no policy or employer cover on file names, and nobody else', async () => {
    await db.collection('family_groups').updateOne({ tenant_id: T }, {
      $push: {
        members: { id: 'kit', name: 'Kit Rowan', role: 'adult', status: 'active' },
      },
    } as never)
    const v = await buildDomainView(db, T, getDomain('life_protection')!)
    expect(v.matrix!.no_policy_on_file).toEqual([{ id: 'kit', name: 'Kit Rowan' }])
  })

  it('counts being the covered person as on file', async () => {
    await db.collection('family_groups').updateOne({ tenant_id: T }, {
      $push: { members: { id: 'kit', name: 'Kit Rowan', role: 'child', status: 'active' } },
    } as never)
    await db
      .collection('family_financial_profile')
      .updateOne({ tenant_id: T }, { $set: { 'policies.0.beneficiary_member_id': 'kit' } })
    const v = await buildDomainView(db, T, getDomain('life_protection')!)
    expect(v.matrix!.no_policy_on_file).toEqual([])
  })

  it('shows a nominated person as named on the policy, matched on full name only', async () => {
    await db
      .collection('family_financial_profile')
      .updateOne(
        { tenant_id: T },
        { $set: { 'policies.0.nomination': { nominated_label: 'alex rowan' } } },
      )
    const v = await buildDomainView(db, T, getDomain('life_protection')!)
    expect(v.matrix!.rows[0]!.cells).toEqual({ sam: 'holds', alex: 'nominated' })
    await db
      .collection('family_financial_profile')
      .updateOne(
        { tenant_id: T },
        { $set: { 'policies.0.nomination': { nominated_label: 'Alex' } } },
      )
    const v2 = await buildDomainView(db, T, getDomain('life_protection')!)
    expect(v2.matrix!.rows[0]!.cells['alex']).toBeNull()
  })
})
