import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  SUGGEST_MIN_IMPRESSIONS,
  generateSuggestions,
  listSuggestions,
  looksLikeAdviceRequest,
  overlap,
  tokens,
  topicSuggestions,
} from '../topic-suggestions.js'
import { searchQueries } from '../search-readback.js'
import { BRIEFS } from '../content-plan.js'
import { registerMarketingSearchRoutes } from '../../routes/marketing-search.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const NOW = new Date('2026-10-24T08:00:00Z')

async function q(query: string, impressions: number, clicks = 0, position = 8, day = '2026-10-20') {
  await searchQueries(db).insertOne({ day, query, clicks, impressions, position })
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('topic-suggestions')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('word overlap', () => {
  it('ignores filler words and plurals', () => {
    expect([...tokens('What to do when someone dies?')].sort()).toEqual(['die', 'someone'].sort())
    expect(overlap(tokens('wills uk'), tokens('Will on file'))).toBe(1)
    expect(overlap(tokens(''), tokens('anything'))).toBe(0)
  })
  it('flags queries that ask for a personal recommendation', () => {
    expect(looksLikeAdviceRequest('best life insurance for families')).toBe(true)
    expect(looksLikeAdviceRequest('should i switch pension provider')).toBe(true)
    expect(looksLikeAdviceRequest('where are my family papers kept')).toBe(false)
  })
})

describe('generateSuggestions', () => {
  it('suggests an uncovered query with enough impressions, with its numbers and nearest topic', async () => {
    await q('lasting power of attorney checklist', 150, 4, 9)
    const run = await generateSuggestions(db, NOW)
    expect(run.suggested).toBe(1)
    const [s] = await listSuggestions(db)
    expect(s).toMatchObject({
      query: 'lasting power of attorney checklist',
      impressions: 150,
      clicks: 4,
      position: 9,
      status: 'suggested',
    })
  })

  it('skips queries below the impressions threshold and ones an existing brief already covers', async () => {
    await q('tiny query about probate', SUGGEST_MIN_IMPRESSIONS - 1)
    const brief = BRIEFS[0]!
    await q(brief.title.toLowerCase(), 500)
    const run = await generateSuggestions(db, NOW)
    expect(run.suggested).toBe(0)
    expect(run.covered).toBe(1)
  })

  it('treats a published guide as coverage', async () => {
    await db.collection('blog_posts').insertOne({
      slug: 'what-to-do-when-someone-dies',
      title: 'What to do when someone dies',
      published: true,
    })
    await q('what to do when someone dies', 300)
    expect((await generateSuggestions(db, NOW)).covered).toBe(1)
    expect(await topicSuggestions(db).countDocuments()).toBe(0)
  })

  it('leaves out queries that read like a request for a personal recommendation', async () => {
    await q('best life insurance for a young family', 400)
    await q('should i switch pension provider', 400)
    const run = await generateSuggestions(db, NOW)
    expect(run.skipped_advice_like).toBe(2)
    expect(run.suggested).toBe(0)
  })

  it('does not suggest the same query again after it was dismissed', async () => {
    await q('inheritance tax threshold explained', 200)
    await generateSuggestions(db, NOW)
    const [s] = await listSuggestions(db)
    await topicSuggestions(db).updateOne({ id: s!.id }, { $set: { status: 'dismissed' } })
    expect((await generateSuggestions(db, NOW)).suggested).toBe(0)
    expect(await listSuggestions(db)).toEqual([])
  })

  it('never creates a draft, a bank entry, a post or a guide', async () => {
    await q('lasting power of attorney checklist', 150)
    await generateSuggestions(db, NOW)
    for (const name of [
      'marketing_posts',
      'content_bank',
      'content_items',
      'blog_posts',
      'marketing_standing_policy',
    ])
      expect(await db.collection(name).countDocuments(), name).toBe(0)
  })
})

describe('suggestion routes', () => {
  async function app() {
    const a = Fastify()
    a.addHook('onRequest', async (req) => {
      req.authContext = { user_id: 'op', tenant_id: 't1', roles: ['admin'] } as never
    })
    registerMarketingSearchRoutes(a, db, { operatorTenants: ['t1'], now: () => NOW })
    await a.ready()
    return a
  }

  it('generates, lists, dismisses and marks as used; an unknown id is a 404', async () => {
    await q('lasting power of attorney checklist', 150)
    await q('funeral wishes template', 90)
    const a = await app()
    expect(
      (
        await a.inject({ method: 'POST', url: '/operator/marketing/search/suggestions/generate' })
      ).json(),
    ).toMatchObject({ suggested: 2 })
    const list = (
      await a.inject({ method: 'GET', url: '/operator/marketing/search/suggestions' })
    ).json() as {
      suggestions: { id: string }[]
      note: string
    }
    expect(list.suggestions).toHaveLength(2)
    expect(list.note).toMatch(/Nothing here creates a draft/)
    const [first, second] = list.suggestions
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/operator/marketing/search/suggestions/${first!.id}/dismiss`,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await a.inject({
          method: 'POST',
          url: `/operator/marketing/search/suggestions/${second!.id}/used`,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        (
          await a.inject({ method: 'GET', url: '/operator/marketing/search/suggestions' })
        ).json() as { suggestions: unknown[] }
      ).suggestions,
    ).toHaveLength(0)
    expect(
      (
        await a.inject({
          method: 'POST',
          url: '/operator/marketing/search/suggestions/nope/dismiss',
        })
      ).statusCode,
    ).toBe(404)
  })
})
