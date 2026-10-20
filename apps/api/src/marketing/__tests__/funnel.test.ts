import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { buildFunnelView, funnelDim, parseFunnelDim, readFunnel } from '../funnel.js'
import { runMetricsRollup } from '../../jobs/metrics-rollup.js'
import { runWeeklyDigest } from '../../operator/weekly-digest.js'
import { marketingPerformance } from '../../routes/marketing-posts.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('funnel')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const NOW = new Date('2026-10-20T12:00:00Z')
const attr = (source: string, campaign: string) => ({
  utm_source: source,
  utm_medium: 'social',
  utm_campaign: campaign,
})

async function seed() {
  const t = new Date('2026-10-20T08:00:00Z')
  await db.collection('growth_events').insertMany([
    {
      event: 'blog_view',
      created_at: t,
      meta: { utm_source: 'bluesky', utm_campaign: 'pillar_chart' },
    },
    {
      event: 'blog_view',
      created_at: t,
      meta: { utm_source: 'bluesky', utm_campaign: 'pillar_chart' },
    },
    { event: 'landing_view', created_at: t },
    {
      event: 'blog_cta_click',
      created_at: t,
      meta: { utm_source: 'bluesky', utm_campaign: 'pillar_chart' },
    },
    { event: 'landing_cta_click', created_at: t },
    { event: 'upgrade_page_view', created_at: t }, // not a funnel step
  ])
  await db.collection('users').insertMany([
    { id: 'u1', tenant_id: 'a', created_at: t, attribution: attr('bluesky', 'pillar_chart') },
    { id: 'u2', tenant_id: 'b', created_at: t, attribution: attr('bluesky', 'pillar_chart') },
    { id: 'u3', tenant_id: 'c', created_at: t }, // direct
  ])
  await db
    .collection('family_financial_profile')
    .insertMany([{ tenant_id: 'a' }, { tenant_id: 'c' }])
  await db.collection('insights').insertMany([{ tenant_id: 'a' }, { tenant_id: 'a' }])
}

describe('funnel dims', () => {
  it('round-trips and rejects unknown steps', () => {
    expect(parseFunnelDim(funnelDim('signup', 'bluesky', 'pillar_chart'))).toEqual({
      step: 'signup',
      source: 'bluesky',
      campaign: 'pillar_chart',
    })
    expect(parseFunnelDim('nonsense|a|b')).toBeNull()
  })
  it('folds rows into totals and by-source / by-campaign breakdowns, best signups first', () => {
    const v = buildFunnelView(
      [
        { dim: funnelDim('visit', 'bluesky', 'pillar_chart'), count: 10 },
        { dim: funnelDim('signup', 'bluesky', 'pillar_chart'), count: 2 },
        { dim: funnelDim('signup', 'direct', 'none'), count: 5 },
      ],
      28,
    )
    expect(v.steps.find((s) => s.step === 'visit')!.count).toBe(10)
    expect(v.by_source.map((b) => b.key)).toEqual(['direct', 'bluesky'])
    expect(v.by_campaign.find((b) => b.key === 'pillar_chart')).toMatchObject({
      visit: 10,
      signup: 2,
    })
  })
})

describe('funnel rollups', () => {
  it('counts visits and clicks by day, and signups as a cohort that is measured as it matures', async () => {
    await seed()
    await runMetricsRollup(db, NOW)
    const v = await readFunnel(db, 7, NOW)
    const n = (step: string) => v.steps.find((s) => s.step === step)!.count
    expect(n('visit')).toBe(3)
    expect(n('cta_click')).toBe(2)
    expect(n('signup')).toBe(3)
    expect(n('profile')).toBe(2) // tenants a and c
    expect(n('first_insight')).toBe(1) // tenant a once, not per insight
    expect(v.by_source.find((b) => b.key === 'bluesky')).toMatchObject({
      visit: 2,
      cta_click: 1,
      signup: 2,
      profile: 1,
      first_insight: 1,
    })
    expect(v.by_source.find((b) => b.key === 'direct')).toMatchObject({
      visit: 1,
      signup: 1,
      profile: 1,
    })
  })

  it('recomputes a cohort when it matures, instead of adding to it', async () => {
    await seed()
    await runMetricsRollup(db, NOW)
    await db.collection('insights').insertOne({ tenant_id: 'b' })
    await runMetricsRollup(db, NOW)
    const v = await readFunnel(db, 7, NOW)
    expect(v.steps.find((s) => s.step === 'first_insight')!.count).toBe(2)
    expect(v.steps.find((s) => s.step === 'signup')!.count).toBe(3)
  })
})

describe('performance read', () => {
  it('has no funnel before the rollups exist and carries it afterwards', async () => {
    await seed()
    expect((await marketingPerformance(db)).funnel).toBeNull()
    await runMetricsRollup(db, new Date())
    const after = await marketingPerformance(db)
    expect(after.funnel).not.toBeNull()
    expect(after.funnel!.window_days).toBe(28)
  })
})

describe('visits from pages that start a visit', () => {
  it('counts signup_view, guide_view and landing_view under their UTM tags', async () => {
    const t = new Date('2026-10-20T08:00:00Z')
    await db.collection('growth_events').insertMany([
      {
        event: 'signup_view',
        created_at: t,
        meta: { utm_source: 'linkedin', utm_campaign: 'pillar_chart' },
      },
      {
        event: 'guide_view',
        created_at: t,
        meta: { slug: 'g', utm_source: 'linkedin', utm_campaign: 'pillar_chart' },
      },
      {
        event: 'landing_view',
        created_at: t,
        meta: { utm_source: 'free text !!', utm_campaign: 'x y' },
      },
    ])
    await runMetricsRollup(db, NOW)
    const v = await readFunnel(db, 7, NOW)
    expect(v.by_source.find((b) => b.key === 'linkedin')!.visit).toBe(2)
    expect(v.by_source.find((b) => b.key === 'other')!.visit).toBe(1)
  })
})

describe('weekly digest marketing section', () => {
  it('reports what needs a person and the funnel, without needing the new collections to exist', async () => {
    await seed()
    await runMetricsRollup(db, NOW)
    await db
      .collection('marketing_posts')
      .insertMany([
        { state: 'draft', copy_check: { ok: true } },
        { state: 'draft', copy_check: { ok: false } },
        { state: 'published' },
      ])
    const d = await runWeeklyDigest(db)
    expect(d.marketing).toMatchObject({
      drafts_awaiting_review: 2,
      drafts_failing_copy_guard: 1,
      next_week_items_planned: 0,
      profile_drift_open: 0,
    })
    expect(d.marketing!.funnel_7d.signup).toBeGreaterThanOrEqual(0)
  })
})
