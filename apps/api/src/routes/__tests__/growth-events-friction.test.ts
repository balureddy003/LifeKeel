/**
 * PRD-230 friction events carry counts and timings only. The allow-list
 * guards the event name; this guards the payload — an event that arrives
 * with a money-looking or free-text property is refused outright, so no
 * figure, name or typed value can land in the anonymous collection even
 * from a modified client.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerGrowthEventRoutes } from '../growth-events.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let app: FastifyInstance

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('growth-friction-test')
  app = Fastify()
  await registerGrowthEventRoutes(app, db)
})
beforeEach(async () => {
  for (const c of await db.listCollections().toArray()) await db.collection(c.name).deleteMany({})
})
afterAll(async () => {
  await app.close()
  await client.close()
  await mongod.stop()
})

const send = (event: string, meta?: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/growth/events', payload: { event, anon_id: 'a', meta } })

describe('friction events (PRD-230)', () => {
  it('accepts counts, timings and booleans on both new events', async () => {
    const started = await send('brief_form_started', {
      problem_type: 'earning_less',
      fields_entered: 0,
      needed_account: false,
      needed_connection: false,
      needed_upload: false,
    })
    expect(started.statusCode).toBe(204)

    const shown = await send('brief_first_number_shown', {
      problem_type: 'income_stops',
      ms_since_form_start: 41_200,
      fields_entered: 4,
      steps_seen: 2,
      needed_account: false,
      needed_connection: false,
      needed_upload: false,
    })
    expect(shown.statusCode).toBe(204)
    const row = await db.collection('growth_events').findOne({ event: 'brief_first_number_shown' })
    expect(row?.['meta']).toEqual({
      problem_type: 'income_stops',
      ms_since_form_start: 41_200,
      fields_entered: 4,
      steps_seen: 2,
      needed_account: false,
      needed_connection: false,
      needed_upload: false,
    })
  })

  it('accepts the event with no meta at all', async () => {
    expect((await send('brief_form_started')).statusCode).toBe(204)
  })

  it('rejects a money-looking property', async () => {
    for (const meta of [
      { monthly_income_minor: 300_000 },
      { amount: '5000' },
      { savings_gbp: 9000.5 },
      { problem_type: 'earning_less', income: '£4,200' },
    ]) {
      const r = await send('brief_first_number_shown', meta)
      expect(r.statusCode, JSON.stringify(meta)).toBe(400)
    }
    expect(await db.collection('growth_events').countDocuments()).toBe(0)
  })

  it('rejects a free-text property', async () => {
    for (const meta of [
      { note: 'my salary is 5000' },
      { member_name: 'Alex' },
      { step: 'step_two' },
      { problem_type: 'earning less this month' },
      { problem_type: ['earning_less'] },
    ]) {
      const r = await send('brief_form_started', meta)
      expect(r.statusCode, JSON.stringify(meta)).toBe(400)
    }
    expect(await db.collection('growth_events').countDocuments()).toBe(0)
  })

  it('rejects wrong-typed counts and flags', async () => {
    for (const meta of [
      { fields_entered: 'four' },
      { steps_seen: { n: 2 } },
      { ms_since_form_start: '41200' },
      { needed_connection: 'yes' },
      { needed_upload: 1 },
    ]) {
      const r = await send('brief_first_number_shown', meta)
      expect(r.statusCode, JSON.stringify(meta)).toBe(400)
    }
    expect(await db.collection('growth_events').countDocuments()).toBe(0)
  })

  it('a catalogue id is the only string allowed anywhere', async () => {
    // Even inside the one string property, only a known problem_type passes.
    expect(
      (await send('brief_form_started', { problem_type: 'not_in_the_catalogue' })).statusCode,
    ).toBe(400)
    expect(
      (await send('brief_form_started', { problem_type: 'medical_contacts' })).statusCode,
    ).toBe(204)
  })
})
