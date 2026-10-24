import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  buildJourneys,
  journeyDim,
  journeyRows,
  parseJourneyDim,
  type Journey,
} from '../journeys.js'
import { runMetricsRollup } from '../../jobs/metrics-rollup.js'

let mongod: MongoMemoryServer
let client: MongoClient
let db: Db

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  client = new MongoClient(mongod.getUri())
  await client.connect()
  db = client.db('journeys')
})
beforeEach(async () => {
  await db.dropDatabase()
})
afterAll(async () => {
  await client.close()
  await mongod.stop()
})

const DAY = new Date('2026-10-20T00:00:00Z')
const RANGE = { $gte: DAY, $lte: new Date('2026-10-20T23:59:59.999Z') }
const at = new Date('2026-10-20T09:00:00Z')
const utm = (source: string, campaign = 'pillar_chart', content = 'post_1') => ({
  utm_source: source,
  utm_medium: 'social',
  utm_campaign: campaign,
  utm_content: content,
})
const user = (id: string, tenant: string, extra: Record<string, unknown> = {}) => ({
  id,
  tenant_id: tenant,
  email: `${id}@example.com`,
  status: 'active',
  created_at: at,
  ...extra,
})

describe('buildJourneys', () => {
  it('reads first and last touch from the signup', async () => {
    await db.collection('users').insertOne(
      user('u1', 't1', {
        attribution: utm('bluesky'),
        last_touch: utm('x', 'pillar_guides', 'post_9'),
      }),
    )
    const [j] = await buildJourneys(db, RANGE)
    expect(j).toMatchObject({
      tenant_id: 't1',
      first: { source: 'bluesky', campaign: 'pillar_chart', content: 'post_1' },
      last: { source: 'x', campaign: 'pillar_guides', content: 'post_9' },
      last_touch_known: true,
      first_from_lead: false,
    })
  })

  it('falls back to first touch when no last touch was captured, and says so', async () => {
    await db.collection('users').insertOne(user('u1', 't1', { attribution: utm('bluesky') }))
    const [j] = await buildJourneys(db, RANGE)
    expect(j!.last).toEqual(j!.first)
    expect(j!.last_touch_known).toBe(false)
  })

  it('joins a consented lead by email to fill in a missing first touch', async () => {
    await db.collection('users').insertOne(user('u1', 't1')) // signed up with nothing stored
    await db.collection('leads').insertOne({
      email: 'u1@example.com',
      consent: { marketing: true },
      attribution: utm('linkedin'),
    })
    const [j] = await buildJourneys(db, RANGE)
    expect(j!.first.source).toBe('linkedin')
    expect(j!.first_from_lead).toBe(true)
  })

  it('never uses an unconsented or suppressed lead', async () => {
    await db.collection('users').insertMany([user('u1', 't1'), user('u2', 't2')])
    await db.collection('leads').insertMany([
      { email: 'u1@example.com', consent: { marketing: false }, attribution: utm('linkedin') },
      {
        email: 'u2@example.com',
        consent: { marketing: true },
        suppressed: true,
        attribution: utm('linkedin'),
      },
    ])
    const js = await buildJourneys(db, RANGE)
    expect(js.map((j) => j.first.source)).toEqual(['direct', 'direct'])
  })

  it('does not join on an anonymous visitor id', async () => {
    await db.collection('users').insertOne(user('u1', 't1', { anon_id: 'anon-1' }))
    await db.collection('growth_events').insertOne({
      event: 'landing_view',
      anon_id: 'anon-1',
      created_at: at,
      meta: utm('bluesky'),
    })
    const [j] = await buildJourneys(db, RANGE)
    expect(j!.first.source).toBe('direct')
  })

  it('excludes pending, suspended and deleted signups', async () => {
    await db
      .collection('users')
      .insertMany([
        user('ok', 't1'),
        user('pending', 't2', { registration_status: 'pending' }),
        user('susp', 't3', { status: 'suspended' }),
        user('gone', 't4', { status: 'deleted' }),
      ])
    expect((await buildJourneys(db, RANGE)).map((j) => j.tenant_id)).toEqual(['t1'])
  })

  it('excludes a signup whose roster member is a child or under 18, like campaign mail does', async () => {
    await db
      .collection('users')
      .insertMany([user('adult', 't1'), user('kid', 't2'), user('teen', 't3')])
    await db.collection('family_groups').insertMany([
      {
        tenant_id: 't1',
        members: [{ id: 'm1', user_id: 'adult', role: 'adult', status: 'active' }],
      },
      { tenant_id: 't2', members: [{ id: 'm2', user_id: 'kid', role: 'child', status: 'active' }] },
      {
        tenant_id: 't3',
        members: [
          {
            id: 'm3',
            user_id: 'teen',
            role: 'adult',
            status: 'active',
            date_of_birth: '2015-01-01',
          },
        ],
      },
    ])
    expect((await buildJourneys(db, RANGE)).map((j) => j.tenant_id)).toEqual(['t1'])
  })

  it('counts a family once, under its first signup', async () => {
    await db.collection('users').insertMany([
      user('a', 't1', {
        attribution: utm('bluesky'),
        created_at: new Date('2026-10-20T08:00:00Z'),
      }),
      user('b', 't1', { attribution: utm('x'), created_at: new Date('2026-10-20T09:00:00Z') }),
    ])
    const js = await buildJourneys(db, RANGE)
    expect(js).toHaveLength(1)
    expect(js[0]!.first.source).toBe('bluesky')
  })

  it('records activation, referral and revenue per family', async () => {
    await db
      .collection('users')
      .insertMany([user('u1', 't1', { attribution: utm('bluesky') }), user('u2', 't2')])
    await db.collection('family_financial_profile').insertOne({ tenant_id: 't1' })
    await db.collection('insights').insertOne({ tenant_id: 't1' })
    await db
      .collection('referrals')
      .insertOne({ referred_tenant_id: 't2', referrer_tenant_id: 'x' })
    await db.collection('revenue_events').insertMany([
      {
        invoice_id: 'i1',
        tenant_id: 't1',
        currency: 'gbp',
        net_pence: 799,
        paid_at: new Date('2026-10-22T00:00:00Z'),
      },
      {
        invoice_id: 'i2',
        tenant_id: 't1',
        currency: 'gbp',
        net_pence: 799,
        paid_at: new Date('2026-11-22T00:00:00Z'),
      },
      {
        invoice_id: 'i3',
        tenant_id: 't1',
        currency: 'eur',
        net_pence: 5000,
        paid_at: new Date('2026-10-22T00:00:00Z'),
      },
      {
        invoice_id: 'i4',
        tenant_id: 't2',
        currency: 'gbp',
        net_pence: 0,
        paid_at: new Date('2026-10-22T00:00:00Z'),
      },
    ])
    const byTenant = Object.fromEntries(
      (await buildJourneys(db, RANGE)).map((j) => [j.tenant_id, j]),
    )
    expect(byTenant['t1']).toMatchObject({
      profile: true,
      first_insight: true,
      revenue_pence: 1598,
      referred: false,
    })
    expect(byTenant['t1']!.paid_at).toEqual(new Date('2026-10-22T00:00:00Z'))
    // A fully refunded invoice is not a paying customer; non-GBP is left out.
    expect(byTenant['t2']).toMatchObject({ referred: true, paid_at: null, revenue_pence: 0 })
  })
})

describe('journeyRows', () => {
  const j = (over: Partial<Journey>): Journey => ({
    tenant_id: 't',
    signed_up_at: at,
    first: { source: 'bluesky', campaign: 'pillar_chart', content: 'p1' },
    last: { source: 'x', campaign: 'pillar_guides', content: 'p2' },
    last_touch_known: true,
    first_from_lead: false,
    referred: false,
    profile: false,
    first_insight: false,
    paid_at: null,
    revenue_pence: 0,
    ...over,
  })

  it('credits a paying signup to different sources under first and last touch', () => {
    const rows = journeyRows(
      [j({ profile: true, first_insight: true, paid_at: at, revenue_pence: 799 })],
      '2026-10-20',
    )
    const get = (dim: string) => rows.find((r) => r.dim === dim)?.count
    const first = { source: 'bluesky', campaign: 'pillar_chart', content: 'p1' }
    const last = { source: 'x', campaign: 'pillar_guides', content: 'p2' }
    expect(get(journeyDim('first', 'paid', first))).toBe(1)
    expect(get(journeyDim('first', 'revenue', first))).toBe(799)
    expect(get(journeyDim('last', 'paid', last))).toBe(1)
    expect(get(journeyDim('last', 'paid', first))).toBeUndefined()
  })

  it('totals reconcile across models — every signup is credited once per model', () => {
    const rows = journeyRows(
      [
        j({}),
        j({ tenant_id: 't2' }),
        j({ tenant_id: 't3', first: { source: 'direct', campaign: 'none', content: 'none' } }),
      ],
      '2026-10-20',
    )
    const total = (model: 'first' | 'last') =>
      rows
        .filter(
          (r) =>
            parseJourneyDim(r.dim)?.model === model && parseJourneyDim(r.dim)?.step === 'signup',
        )
        .reduce((n, r) => n + r.count, 0)
    expect(total('first')).toBe(3)
    expect(total('last')).toBe(3)
  })

  it('round-trips dimensions and rejects malformed ones', () => {
    const t = { source: 'bluesky', campaign: 'pillar_chart', content: 'p1' }
    expect(parseJourneyDim(journeyDim('last', 'signup', t))).toEqual({
      model: 'last',
      step: 'signup',
      ...t,
    })
    expect(parseJourneyDim('first|nonsense|a|b|c')).toBeNull()
    expect(parseJourneyDim('middle|signup|a|b|c')).toBeNull()
    expect(parseJourneyDim('first|signup|a|b')).toBeNull()
  })
})

describe('rollup', () => {
  it('writes journey rows into metrics_daily, and revenue arriving later updates them', async () => {
    const now = new Date('2026-10-20T12:00:00Z')
    await db.collection('users').insertOne(user('u1', 't1', { attribution: utm('bluesky') }))
    await runMetricsRollup(db, now)
    const first = { source: 'bluesky', campaign: 'pillar_chart', content: 'post_1' }
    const signup = await db
      .collection('metrics_daily')
      .findOne({ metric: 'journey', dim: journeyDim('first', 'signup', first) })
    expect(signup?.['count']).toBe(1)
    expect(
      await db
        .collection('metrics_daily')
        .findOne({ metric: 'journey', dim: journeyDim('first', 'paid', first) }),
    ).toBeNull()

    await db.collection('revenue_events').insertOne({
      invoice_id: 'i1',
      tenant_id: 't1',
      currency: 'gbp',
      net_pence: 799,
      paid_at: new Date('2026-10-21T00:00:00Z'),
    })
    // Hour 0 UTC triggers the full recompute of the whole journey window.
    await runMetricsRollup(db, new Date('2026-10-21T00:10:00Z'))
    expect(
      (
        await db
          .collection('metrics_daily')
          .findOne({ metric: 'journey', dim: journeyDim('first', 'revenue', first) })
      )?.['count'],
    ).toBe(799)
  })
})
