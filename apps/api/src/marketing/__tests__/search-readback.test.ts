import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  NEAR_MISS_MIN_IMPRESSIONS,
  ga4Daily,
  runSearchReadback,
  searchPages,
  searchQueries,
  searchView,
  toPath,
} from '../search-readback.js'
import { GoogleReadError, type ReadbackConfig } from '../google-read.js'
import type { SearchRow } from '../search-console.js'
import { registerMarketingSearchRoutes } from '../../routes/marketing-search.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const NOW = new Date('2026-10-24T08:00:00Z')
const cfg: ReadbackConfig = {
  credentialsJson: '{"client_email":"a@b","private_key":"-----SECRET-----"}',
  siteUrl: 'sc-domain:lifekeel.co.uk',
  propertyId: '123456',
}
const row = (keys: string[], clicks: number, impressions: number, position = 5): SearchRow => ({
  keys,
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
})

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('search-readback')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('toPath', () => {
  it('reduces a URL to its path, dropping query, fragment and trailing slash', () => {
    expect(toPath('https://lifekeel.co.uk/guides/wills/?utm_source=x#top')).toBe('/guides/wills')
    expect(toPath('https://lifekeel.co.uk/')).toBe('/')
    expect(toPath('/blog/post')).toBe('/blog/post')
  })
})

describe('runSearchReadback', () => {
  const searchRows = async (dims: string[]) =>
    dims.includes('query')
      ? [
          row(['2026-10-20', 'what to do when someone dies'], 3, 120, 6),
          row(['2026-10-20', 'jane@example.com will'], 1, 5), // identifies a person: dropped
          row(['2026-10-20', 'policy 1234567890'], 1, 5), // long digit run: dropped
        ]
      : [row(['2026-10-20', 'https://lifekeel.co.uk/guides/death/?x=1'], 3, 120, 6)]

  it('stores sanitised aggregates only, and marks both integrations connected', async () => {
    const res = await runSearchReadback(db, NOW, {
      config: cfg,
      searchRows: searchRows as never,
      ga4Rows: async () => [
        {
          dims: ['20261020', 'google', 'organic', 'https://lifekeel.co.uk/guides/death/'],
          metrics: [10, 8, 2],
        },
      ],
    })
    expect(res).toMatchObject({
      search_console: 'connected',
      ga4: 'connected',
      query_rows: 1,
      page_rows: 1,
      ga4_rows: 1,
    })
    expect(
      await searchQueries(db)
        .find({}, { projection: { _id: 0 } })
        .toArray(),
    ).toEqual([
      {
        day: '2026-10-20',
        query: 'what to do when someone dies',
        clicks: 3,
        impressions: 120,
        position: 6,
      },
    ])
    expect((await searchPages(db).findOne({}))?.path).toBe('/guides/death')
    expect(await ga4Daily(db).findOne({}, { projection: { _id: 0 } })).toEqual({
      day: '2026-10-20',
      source: 'google',
      medium: 'organic',
      landing: '/guides/death',
      sessions: 10,
      engaged: 8,
      key_events: 2,
    })
    // Aggregates only: nothing resembling a person or a credential is stored anywhere.
    const dump = JSON.stringify([
      await searchQueries(db).find().toArray(),
      await searchPages(db).find().toArray(),
      await ga4Daily(db).find().toArray(),
      await db.collection('search_readback_state').find().toArray(),
    ])
    expect(dump).not.toMatch(/jane@|1234567890|SECRET|private_key|client_id|user_id/)
  })

  it('is idempotent: re-reading the same days updates rows instead of duplicating them', async () => {
    const deps = { config: cfg, searchRows: searchRows as never, ga4Rows: async () => [] }
    await runSearchReadback(db, NOW, deps)
    await runSearchReadback(db, NOW, deps)
    expect(await searchQueries(db).countDocuments()).toBe(1)
    expect(await searchPages(db).countDocuments()).toBe(1)
  })

  it('reads the window that ends before the data lag, and picks up revised numbers', async () => {
    const seen: [string, string][] = []
    await runSearchReadback(db, NOW, {
      config: cfg,
      searchRows: (async (_d: string[], s: string, e: string) => {
        seen.push([s, e])
        return [row(['2026-10-20', 'wills'], 1, 10)]
      }) as never,
      ga4Rows: async () => [],
    })
    expect(seen[0]).toEqual(['2026-10-15', '2026-10-21'])
    await runSearchReadback(db, NOW, {
      config: cfg,
      searchRows: (async () => [row(['2026-10-20', 'wills'], 4, 12)]) as never,
      ga4Rows: async () => [],
    })
    expect((await searchQueries(db).findOne({ query: 'wills' }))?.clicks).toBe(4)
  })

  it('reports not_configured with no key or property, and does nothing', async () => {
    const res = await runSearchReadback(db, NOW, {
      config: { credentialsJson: undefined, siteUrl: undefined, propertyId: undefined },
    })
    expect(res).toMatchObject({ search_console: 'not_configured', ga4: 'not_configured' })
    expect(await searchQueries(db).countDocuments()).toBe(0)
  })

  it('turns a refused read into needs_attention with the reason, and keeps going for the other integration', async () => {
    const res = await runSearchReadback(db, NOW, {
      config: cfg,
      searchRows: (async () => {
        throw new GoogleReadError('forbidden', 'Search Console query failed: HTTP 403')
      }) as never,
      ga4Rows: async () => [{ dims: ['20261020', 'google', 'organic', '/'], metrics: [1, 1, 0] }],
    })
    expect(res).toMatchObject({ search_console: 'needs_attention', ga4: 'connected' })
    const view = await searchView(db, 28, NOW)
    expect(view.integrations.search_console.status).toBe('needs_attention')
    expect(view.integrations.search_console.last_error).toMatch(/^forbidden:/)
  })

  it('drops history older than the retention window', async () => {
    await searchQueries(db).insertOne({
      day: '2025-01-01',
      query: 'old',
      clicks: 1,
      impressions: 1,
      position: 1,
    })
    await runSearchReadback(db, NOW, {
      config: cfg,
      searchRows: (async () => []) as never,
      ga4Rows: async () => [],
    })
    expect(await searchQueries(db).countDocuments({ query: 'old' })).toBe(0)
  })
})

describe('searchView', () => {
  async function seed() {
    await searchQueries(db).insertMany([
      { day: '2026-10-20', query: 'tell us once', clicks: 10, impressions: 100, position: 4 },
      { day: '2026-10-21', query: 'tell us once', clicks: 10, impressions: 300, position: 8 },
      {
        day: '2026-10-20',
        query: 'where are the papers',
        clicks: 0,
        impressions: NEAR_MISS_MIN_IMPRESSIONS + 30,
        position: 12,
      },
      { day: '2026-10-20', query: 'rare', clicks: 0, impressions: 3, position: 3 },
    ])
  }

  it('averages position weighted by impressions and ranks by clicks', async () => {
    await seed()
    const v = await searchView(db, 28, NOW)
    expect(v.top_queries[0]).toMatchObject({ query: 'tell us once', clicks: 20, impressions: 400 })
    expect(v.top_queries[0]!.position).toBe(7) // (4*100 + 8*300) / 400
  })

  it('lists near misses: many impressions, poor click-through, ranking on the first two pages', async () => {
    await seed()
    const v = await searchView(db, 28, NOW)
    expect(v.near_misses.map((n) => n.query)).toEqual(['where are the papers'])
  })

  it('says there is not enough data below the impressions threshold', async () => {
    await searchQueries(db).insertOne({
      day: '2026-10-20',
      query: 'few',
      clicks: 1,
      impressions: 4,
      position: 2,
    })
    expect((await searchView(db, 28, NOW)).enough_data).toBe(false)
    await seed()
    expect((await searchView(db, 28, NOW)).enough_data).toBe(true)
  })

  it('compares GA4 sessions with first-party visits and states that GA4 undercounts', async () => {
    await ga4Daily(db).insertMany([
      {
        day: '2026-10-20',
        source: 'google',
        medium: 'organic',
        landing: '/',
        sessions: 7,
        engaged: 5,
        key_events: 1,
      },
      {
        day: '2026-10-21',
        source: 'google',
        medium: 'organic',
        landing: '/guides',
        sessions: 3,
        engaged: 2,
        key_events: 0,
      },
    ])
    await db.collection('growth_events').insertMany([
      { event: 'landing_view', created_at: new Date('2026-10-20T10:00:00Z') },
      { event: 'landing_view', created_at: new Date('2026-10-21T10:00:00Z') },
      { event: 'other', created_at: new Date('2026-10-21T10:00:00Z') },
    ])
    const v = await searchView(db, 28, NOW)
    expect(v.ga4.sessions).toBe(10)
    expect(v.ga4.first_party_visits).toBe(2)
    expect(v.ga4.by_source[0]).toMatchObject({
      source_medium: 'google / organic',
      sessions: 10,
      key_events: 1,
    })
    expect(v.ga4.note).toMatch(/cookies/)
    expect(v.lag_note).toMatch(/3 days/)
  })
})

describe('routes', () => {
  async function app(tenant = 't1') {
    const a = Fastify()
    a.addHook('onRequest', async (req) => {
      req.authContext = { user_id: 'op', tenant_id: tenant, roles: ['admin'] } as never
    })
    registerMarketingSearchRoutes(a, db, {
      operatorTenants: ['t1'],
      now: () => NOW,
      deps: {
        config: cfg,
        searchRows: (async () => [row(['2026-10-20', 'wills'], 1, 10)]) as never,
        ga4Rows: async () => [],
      },
    })
    await a.ready()
    return a
  }

  it('returns aggregates and configuration booleans, never a credential or user id', async () => {
    const a = await app()
    await a.inject({ method: 'POST', url: '/operator/marketing/search/run' })
    const res = await a.inject({ method: 'GET', url: '/operator/marketing/search?days=28' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      configured: Record<string, boolean>
      top_queries: { query: string }[]
    }
    expect(body.top_queries[0]?.query).toBe('wills')
    expect(body.configured).toEqual({ credentials: true, search_console: true, ga4: true })
    expect(res.body).not.toMatch(/SECRET|private_key|user_id/)
  })

  it('rejects a bad window and a tenant that is not an operator', async () => {
    const a = await app()
    expect(
      (await a.inject({ method: 'GET', url: '/operator/marketing/search?days=0' })).statusCode,
    ).toBe(400)
    expect(
      (await a.inject({ method: 'GET', url: '/operator/marketing/search?days=abc' })).statusCode,
    ).toBe(400)
    const stranger = await app('stranger')
    expect(
      (await stranger.inject({ method: 'GET', url: '/operator/marketing/search' })).statusCode,
    ).toBe(403)
  })
})
