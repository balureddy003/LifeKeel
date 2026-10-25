import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { registerMarketingPlanRoutes } from '../marketing-plan.js'
import {
  BRIEFS,
  PILLARS,
  contentHash,
  isMonday,
  nextMondayKey,
  pickBriefs,
  slotTime,
} from '../../marketing/content-plan.js'
import { checkCopy } from '../../marketing/copy-guard.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

const NOW = new Date('2026-10-20T10:00:00Z') // a Tuesday
const WEEK = '2026-10-26' // the Monday after
let llmText = 'Where does your family stand? A look at what is on file. Free to start.'

async function buildApp() {
  const app = Fastify()
  app.addHook('onRequest', async (req) => {
    req.authContext = { user_id: 'op-1', tenant_id: 't1', roles: ['admin'] } as never
  })
  registerMarketingPlanRoutes(app, db, {
    operatorTenants: ['t1'],
    llm: async () => llmText,
    now: () => NOW,
  })
  await app.ready()
  return app
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('marketing-plan')
})
beforeEach(async () => {
  await db.dropDatabase()
  llmText = 'Where does your family stand? A look at what is on file. Free to start.'
  await db.collection('social_connections').insertOne({
    tenant_id: 't1',
    channel: 'bluesky',
    handle: 'h',
    credentials: {},
    status: 'active',
  })
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

describe('briefs and slots', () => {
  it('every brief passes the copy guard, so a draft can only start from allowed facts', () => {
    for (const b of BRIEFS)
      expect(checkCopy(`${b.title}\n${b.facts}`, 'social'), b.id).toEqual({
        ok: true,
        violations: [],
      })
  })
  it('covers every pillar', () => {
    for (const p of PILLARS)
      expect(
        BRIEFS.some((b) => b.pillar === p),
        p,
      ).toBe(true)
  })
  it('picks the least-used briefs and a different pillar for each slot', () => {
    const picked = pickBriefs(new Map())
    expect(new Set(picked.map((b) => b.pillar)).size).toBe(3)
    const usage = new Map(picked.map((b) => [b.id, 1]))
    expect(pickBriefs(usage).some((b) => picked.includes(b))).toBe(false)
  })
  it('knows Mondays and puts slots on Monday, Wednesday and Friday at 09:00 UTC', () => {
    expect(isMonday(WEEK)).toBe(true)
    expect(isMonday('2026-10-27')).toBe(false)
    expect(nextMondayKey(NOW)).toBe(WEEK)
    expect([0, 1, 2].map((s) => slotTime(WEEK, s).toISOString())).toEqual([
      '2026-10-26T09:00:00.000Z',
      '2026-10-28T09:00:00.000Z',
      '2026-10-30T09:00:00.000Z',
    ])
  })
})

describe('/marketing/plan', () => {
  it('generates three items with a draft per connected network, scheduled and never published', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.created_items).toBeGreaterThanOrEqual(3)
    expect(body.created_posts).toBeGreaterThanOrEqual(body.created_items)
    expect(
      body.items.every(
        (i: { posts: { state: string; channel: string }[] }) =>
          i.posts.length >= 1 && i.posts[0]!.state === 'draft' && i.posts[0]!.channel === 'bluesky',
      ),
    ).toBe(true)
    const posts = await db.collection('marketing_posts').find({}).toArray()
    expect(posts.every((p) => p['state'] === 'draft' && p['scheduled_at'] instanceof Date)).toBe(
      true,
    )
    expect(posts[0]!['campaign']).toMatch(/^pillar_/)
  })

  it('is idempotent for a week and refuses a past week or a non-Monday', async () => {
    const app = await buildApp()
    await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    const again = await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    expect(again.json().created_items).toBe(0)
    expect(await db.collection('marketing_posts').countDocuments()).toBeGreaterThanOrEqual(3)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/marketing/plan/generate',
          payload: { week_start: '2026-10-27' },
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/marketing/plan/generate',
          payload: { week_start: '2026-10-12' },
        })
      ).json().error,
    ).toBe('week_is_in_the_past')
  })

  it('refuses to generate with no network to draft for', async () => {
    await db.collection('social_connections').deleteMany({})
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    expect(res.statusCode).toBe(409)
  })

  it('approves a reviewed week by the hash of the text each approver saw', async () => {
    const app = await buildApp()
    const week = (
      await app.inject({
        method: 'POST',
        url: '/marketing/plan/generate',
        payload: { week_start: WEEK },
      })
    ).json()
    const all = week.items.flatMap(
      (i: { posts: { id: string; content_hash: string }[] }) => i.posts,
    )
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/approve',
      payload: {
        items: all.map((p: { id: string; content_hash: string }) => ({
          post_id: p.id,
          content_hash: p.content_hash,
        })),
      },
    })
    expect(res.json().approved).toBe(all.length)
    const posts = await db.collection('marketing_posts').find({}).toArray()
    expect(posts.every((p) => p['state'] === 'approved' && p['approved_by'] === 'op-1')).toBe(true)
  })

  it('refuses a post whose text changed after review, one that fails the guard, and one already past its time', async () => {
    const app = await buildApp()
    const week = (
      await app.inject({
        method: 'POST',
        url: '/marketing/plan/generate',
        payload: { week_start: WEEK },
      })
    ).json()
    const [a, b, c] = week.items.flatMap(
      (i: { posts: { id: string; content: string; content_hash: string }[] }) => i.posts,
    )

    await db
      .collection('marketing_posts')
      .updateOne({ id: a.id }, { $set: { content: 'edited after the reviewer looked' } })
    await db
      .collection('marketing_posts')
      .updateOne({ id: b.id }, { $set: { content: 'You should switch to a cheaper insurer.' } })
    await db
      .collection('marketing_posts')
      .updateOne({ id: c.id }, { $set: { scheduled_at: new Date('2026-10-01T09:00:00Z') } })
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/approve',
      payload: {
        items: [
          { post_id: a.id, content_hash: a.content_hash },
          { post_id: b.id, content_hash: contentHash('You should switch to a cheaper insurer.') },
          { post_id: c.id, content_hash: c.content_hash },
        ],
      },
    })
    const errs = res.json().results.map((r: { error?: string }) => r.error ?? '')
    expect(errs[0]).toBe('text_changed_since_review')
    expect(errs[1]).toMatch(/^copy_guard_failed/)
    expect(errs[2]).toBe('scheduled_time_has_passed')
    expect(res.json().approved).toBe(0)
  })

  it('skipping an item rejects its drafts', async () => {
    const app = await buildApp()
    const week = (
      await app.inject({
        method: 'POST',
        url: '/marketing/plan/generate',
        payload: { week_start: WEEK },
      })
    ).json()
    const item = week.items[0]
    expect(
      (await app.inject({ method: 'POST', url: `/marketing/plan/items/${item.id}/skip` }))
        .statusCode,
    ).toBe(200)
    const post = await db.collection('marketing_posts').findOne({ content_item_id: item.id })
    expect(post!['state']).toBe('rejected')
    const view = (await app.inject({ method: 'GET', url: `/marketing/plan?week=${WEEK}` })).json()
    expect(view.items[0].status).toBe('skipped')
  })

  it('shows a draft that fails the guard with its violations and will not let it be approved', async () => {
    llmText = 'We recommend you buy a better policy from Aviva.'
    const app = await buildApp()
    const week = (
      await app.inject({
        method: 'POST',
        url: '/marketing/plan/generate',
        payload: { week_start: WEEK },
      })
    ).json()
    const p = week.items[0].posts[0]
    expect(p.copy_check.ok).toBe(false)
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/approve',
      payload: { items: [{ post_id: p.id, content_hash: p.content_hash }] },
    })
    expect(res.json().approved).toBe(0)
  })
})

const oauth = (connector_id: string, extra: Record<string, unknown> = {}) => ({
  tenant_id: 't1',
  connector_id,
  extra: { username: `${connector_id}-user` },
  needs_reauth: false,
  ...extra,
})

describe('/marketing/plan across every connected platform', () => {
  it('drafts for OAuth-connected channels too, not only Bluesky', async () => {
    await db.collection('social_connections').deleteMany({})
    await db
      .collection('connector_credentials')
      .insertMany([oauth('twitter_x'), oauth('linkedin'), oauth('threads')])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.created_posts).toBeGreaterThanOrEqual(9)
    expect(body.available_channels.sort()).toEqual(['linkedin', 'threads', 'x'])
    const channels = new Set(
      (await db.collection('marketing_posts').find({}).toArray()).map((p) => p['channel']),
    )
    expect(channels).toEqual(new Set(['x', 'linkedin', 'threads']))
  })

  it('skips a channel whose token has died and says so, instead of drafting for it', async () => {
    await db
      .collection('connector_credentials')
      .insertMany([oauth('twitter_x'), oauth('linkedin', { needs_reauth: true })])
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    const body = res.json()
    expect(body.available_channels.sort()).toEqual(['bluesky', 'x'])
    expect(body.skipped_channels).toEqual([
      expect.objectContaining({ channel: 'linkedin', status: 'needs_reauth' }),
    ])
    const channels = new Set(
      (await db.collection('marketing_posts').find({}).toArray()).map((p) => p['channel']),
    )
    expect(channels.has('linkedin')).toBe(false)
  })

  it('ignores another tenant’s connections', async () => {
    await db.collection('social_connections').deleteMany({})
    await db
      .collection('connector_credentials')
      .insertOne({ ...oauth('twitter_x'), tenant_id: 'someone-else' })
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/marketing/plan/generate',
      payload: { week_start: WEEK },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('no_channels')
  })

  it('will not let an Instagram draft be approved until it has an image', async () => {
    await db.collection('connector_credentials').insertOne(oauth('instagram_business'))
    const app = await buildApp()
    const week = (
      await app.inject({
        method: 'POST',
        url: '/marketing/plan/generate',
        payload: { week_start: WEEK },
      })
    ).json()
    type P = { id: string; channel: string; content_hash: string; needs_image: boolean }
    const posts: P[] = week.items.flatMap((i: { posts: P[] }) => i.posts)
    const ig = posts.filter((p) => p.channel === 'instagram')
    expect(ig.length).toBeGreaterThanOrEqual(3)
    expect(ig.every((p) => p.needs_image)).toBe(true)
    expect(posts.filter((p) => p.channel !== 'instagram').every((p) => !p.needs_image)).toBe(true)

    const refused = await app.inject({
      method: 'POST',
      url: '/marketing/plan/approve',
      payload: { items: posts.map((p) => ({ post_id: p.id, content_hash: p.content_hash })) },
    })
    expect(refused.json().approved).toBe(posts.length - ig.length) // the non-Instagram ones
    expect(
      refused.json().results.filter((r: { error?: string }) => r.error === 'image_required'),
    ).toHaveLength(ig.length)
    expect(
      await db
        .collection('marketing_posts')
        .countDocuments({ channel: 'instagram', state: 'approved' }),
    ).toBe(0)

    await db
      .collection('marketing_posts')
      .updateMany(
        { channel: 'instagram' },
        { $set: { media_url: 'https://cdn.example.com/a.png' } },
      )
    const retry = await app.inject({
      method: 'POST',
      url: '/marketing/plan/approve',
      payload: { items: ig.map((p) => ({ post_id: p.id, content_hash: p.content_hash })) },
    })
    expect(retry.json().approved).toBe(ig.length)
  })
})
