import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerMarketingBankRoutes } from '../marketing-bank.js'
import { BANK_ENTRY_TTL_DAYS, bankCollection } from '../../marketing/bank.js'
import { contentHash } from '../../marketing/content-plan.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const NOW = new Date('2026-10-20T10:00:00Z')
const GOOD = 'Where does your family stand? A look at what is on file. Free to start.'
const BAD = 'You should buy this policy today. Free to start.'

async function buildApp(tenant = 't1', user = 'op-1') {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    req.authContext = { user_id: user, tenant_id: tenant, roles: ['admin'] } as never
  })
  registerMarketingBankRoutes(app, db, { operatorTenants: ['t1', 't2'], now: () => NOW })
  await app.ready()
  return app
}

async function add(
  app: Awaited<ReturnType<typeof buildApp>>,
  content = GOOD,
  channels = ['bluesky'],
) {
  const res = await app.inject({
    method: 'POST',
    url: '/marketing/bank',
    payload: { content, channels },
  })
  expect(res.statusCode).toBe(201)
  return res.json() as { id: string; content_hash: string }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('marketing-bank')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('content bank', () => {
  it('adds a candidate that is not usable until approved', async () => {
    const app = await buildApp()
    const e = await add(app)
    const doc = await bankCollection(db).findOne({ id: e.id })
    expect(doc?.status).toBe('candidate')
    expect(doc?.approved_by).toBeUndefined()
    expect(e.content_hash).toBe(contentHash(GOOD))
  })

  it('approves by the hash the reviewer saw, recording who and when, with a 90 day life', async () => {
    const app = await buildApp()
    const e = await add(app)
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: { items: [{ id: e.id, content_hash: e.content_hash }] },
    })
    expect(res.json()).toMatchObject({ approved: 1, refused: 0 })
    const doc = await bankCollection(db).findOne({ id: e.id })
    expect(doc?.status).toBe('approved')
    expect(doc?.approved_by).toBe('op-1')
    expect(doc?.approved_at).toEqual(NOW)
    expect(doc?.expires_at?.getTime()).toBe(NOW.getTime() + BANK_ENTRY_TTL_DAYS * 86_400_000)
  })

  it('refuses a stale hash, a copy-guard failure and a missing image, one entry at a time', async () => {
    const app = await buildApp()
    const ok = await add(app)
    const bad = await add(app, BAD)
    const ig = await add(app, GOOD + ' Instagram.', ['instagram'])
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: {
        items: [
          { id: ok.id, content_hash: 'stale' },
          { id: bad.id, content_hash: bad.content_hash },
          { id: ig.id, content_hash: ig.content_hash },
        ],
      },
    })
    const body = res.json() as { results: { id: string; ok: boolean; error?: string }[] }
    expect(body.results.find((r) => r.id === ok.id)?.error).toBe('text_changed_since_review')
    expect(body.results.find((r) => r.id === bad.id)?.error).toMatch(/^copy_guard_failed/)
    expect(body.results.find((r) => r.id === ig.id)?.error).toMatch(/^image_required/)
    expect(await bankCollection(db).countDocuments({ status: 'approved' })).toBe(0)
  })

  it('an instagram entry with a card spec is approvable', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/bank',
      payload: {
        content: GOOD,
        channels: ['instagram'],
        card: { layout: 'headline', headline: 'One thing to check' },
      },
    })
    const e = res.json() as { id: string; content_hash: string }
    const a = await app.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: { items: [{ id: e.id, content_hash: e.content_hash }] },
    })
    expect(a.json()).toMatchObject({ approved: 1 })
  })

  it('an approved entry cannot be edited; a candidate can, and its hash changes', async () => {
    const app = await buildApp()
    const e = await add(app)
    const edit = await app.inject({
      method: 'PATCH',
      url: `/marketing/bank/${e.id}`,
      payload: { content: GOOD + ' Edited.' },
    })
    expect(edit.statusCode).toBe(200)
    const after = await bankCollection(db).findOne({ id: e.id })
    expect(after?.content_hash).toBe(contentHash(GOOD + ' Edited.'))
    // The old hash no longer approves it.
    const stale = await app.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: { items: [{ id: e.id, content_hash: e.content_hash }] },
    })
    expect(stale.json()).toMatchObject({ approved: 0, refused: 1 })
    await app.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: { items: [{ id: e.id, content_hash: after!.content_hash }] },
    })
    const locked = await app.inject({
      method: 'PATCH',
      url: `/marketing/bank/${e.id}`,
      payload: { content: 'Changed after approval.' },
    })
    expect(locked.statusCode).toBe(409)
    expect((await bankCollection(db).findOne({ id: e.id }))?.content).toBe(GOOD + ' Edited.')
  })

  it('retire takes an entry out of use and keeps the reason', async () => {
    const app = await buildApp()
    const e = await add(app)
    const res = await app.inject({
      method: 'POST',
      url: `/marketing/bank/${e.id}/retire`,
      payload: { reason: 'out of date' },
    })
    expect(res.statusCode).toBe(200)
    const doc = await bankCollection(db).findOne({ id: e.id })
    expect(doc).toMatchObject({
      status: 'retired',
      retired_by: 'op-1',
      retired_reason: 'out of date',
    })
    // A retired entry cannot be approved.
    const again = await app.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: { items: [{ id: e.id, content_hash: e.content_hash }] },
    })
    expect(again.json()).toMatchObject({ approved: 0 })
  })

  it('is tenant scoped: another tenant cannot approve, edit or list an entry', async () => {
    const a = await buildApp('t1')
    const e = await add(a)
    const b = await buildApp('t2', 'op-2')
    const approve = await b.inject({
      method: 'POST',
      url: '/marketing/bank/approve',
      payload: { items: [{ id: e.id, content_hash: e.content_hash }] },
    })
    expect(approve.json()).toMatchObject({ approved: 0 })
    const list = await b.inject({ method: 'GET', url: '/marketing/bank' })
    expect((list.json() as { entries: unknown[] }).entries).toHaveLength(0)
    const edit = await b.inject({
      method: 'PATCH',
      url: `/marketing/bank/${e.id}`,
      payload: { content: 'x' },
    })
    expect(edit.statusCode).toBe(404)
  })

  it('copies a plan draft into the bank as a candidate, never as an approved entry', async () => {
    const app = await buildApp()
    await db.collection('marketing_posts').insertOne({
      id: 'p1',
      tenant_id: 't1',
      channel: 'bluesky',
      integration_id: 'bluesky:h',
      content: GOOD,
      state: 'draft',
      content_item_id: 'ci-1',
      pillar: 'chart',
      features: { format: 'myth_vs_file', hook: 'question' },
      created_by: 'op-1',
      created_at: NOW,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/bank/from-post',
      payload: { post_id: 'p1' },
    })
    expect(res.statusCode).toBe(201)
    const doc = await bankCollection(db).findOne({ tenant_id: 't1' })
    expect(doc).toMatchObject({ status: 'candidate', source: 'plan_draft', format: 'myth_vs_file' })
    const none = await app.inject({
      method: 'POST',
      url: '/marketing/bank/from-post',
      payload: { post_id: 'missing' },
    })
    expect(none.statusCode).toBe(404)
  })

  it("turns the post's own tagged link into a token, keeping the path and campaign", async () => {
    const app = await buildApp()
    await db.collection('marketing_posts').insertOne({
      id: 'p2',
      tenant_id: 't1',
      channel: 'bluesky',
      integration_id: 'bluesky:h',
      content:
        GOOD +
        ' https://lifekeel.co.uk/guides/chart?utm_source=bluesky&utm_medium=social&utm_campaign=pillar_chart&utm_content=pabc12345',
      state: 'draft',
      content_item_id: 'ci-2',
      campaign: 'pillar_chart',
      post_tag: 'pabc12345',
      created_by: 'op-1',
      created_at: NOW,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/bank/from-post',
      payload: { post_id: 'p2' },
    })
    expect(res.statusCode).toBe(201)
    const doc = await bankCollection(db).findOne({ tenant_id: 't1' })
    expect(doc?.content).toBe(GOOD + ' {{link}}')
    expect(doc?.link_path).toBe('/guides/chart')
    expect(doc?.campaign).toBe('pillar_chart')
    expect(doc?.content).not.toContain('pabc12345')
  })

  it('rejects a request that is not an operator tenant', async () => {
    const app = Fastify()
    app.addHook('onRequest', async (req) => {
      req.authContext = { user_id: 'u', tenant_id: 'stranger', roles: [] } as never
    })
    registerMarketingBankRoutes(app, db, { operatorTenants: ['t1'], now: () => NOW })
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/bank',
      payload: { content: GOOD, channels: ['bluesky'] },
    })
    expect(res.statusCode).toBe(403)
  })
})
