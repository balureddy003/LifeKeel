import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MongoClient, type Db } from 'mongodb'
import { MongoMemoryServer } from 'mongodb-memory-server'
import {
  buildRows,
  buildView,
  confidenceFor,
  describeRow,
  foldRollups,
  rate,
  readEconomics,
  wilson,
} from '../economics.js'
import { journeyDim } from '../journeys.js'
import { funnelDim } from '../funnel.js'
import { addSpend, spendInWindow, validateSpend } from '../spend.js'

describe('wilson interval', () => {
  it('matches hand-computed values', () => {
    const a = wilson(3, 120)!
    expect(a.low).toBeCloseTo(0.0085, 3)
    expect(a.high).toBeCloseTo(0.0709, 3)
    const b = wilson(5, 10)!
    expect(b.low).toBeCloseTo(0.2366, 3)
    expect(b.high).toBeCloseTo(0.7634, 3)
  })

  it('stays inside 0..1 at the extremes and is wide for tiny samples', () => {
    const none = wilson(0, 10)!
    expect(none.low).toBe(0)
    expect(none.high).toBeCloseTo(0.2775, 3)
    const all = wilson(10, 10)!
    expect(all.low).toBeCloseTo(0.7225, 3)
    expect(all.high).toBe(1)
    expect(wilson(1, 2)!.high - wilson(1, 2)!.low).toBeGreaterThan(0.6)
  })

  it('refuses an empty or impossible sample', () => {
    expect(wilson(0, 0)).toBeNull()
    expect(wilson(5, 3)).toBeNull()
    expect(wilson(-1, 3)).toBeNull()
    expect(rate(0, 0)).toMatchObject({ rate: null, low: null, high: null })
  })
})

describe('confidence', () => {
  it('needs enough visits and signups before a row is comparable', () => {
    expect(confidenceFor({ visits: 49, signups: 40, paid: 9 })).toBe('insufficient')
    expect(confidenceFor({ visits: 500, signups: 9, paid: 3 })).toBe('insufficient')
    expect(confidenceFor({ visits: 50, signups: 10, paid: 0 })).toBe('directional')
  })

  it('is solid only with both enough signups and enough paid', () => {
    expect(confidenceFor({ visits: 900, signups: 30, paid: 4 })).toBe('directional')
    expect(confidenceFor({ visits: 900, signups: 29, paid: 9 })).toBe('directional')
    expect(confidenceFor({ visits: 900, signups: 30, paid: 5 })).toBe('solid')
  })

  it('judges a dimension with no visit data (content items) on signups alone', () => {
    expect(confidenceFor({ visits: null, signups: 9, paid: 0 })).toBe('insufficient')
    expect(confidenceFor({ visits: null, signups: 10, paid: 0 })).toBe('directional')
  })
})

const m = (o: Record<string, number>) => new Map(Object.entries(o))

describe('buildRows', () => {
  const base = {
    visits: m({ bluesky: 400, x: 120 }),
    cta: m({ bluesky: 80, x: 10 }),
    signups: m({ bluesky: 40, x: 12 }),
    profiles: m({ bluesky: 30, x: 6 }),
    activated: m({ bluesky: 20, x: 3 }),
    paid: m({ bluesky: 4, x: 0 }),
    revenue: m({ bluesky: 3196 }),
    spend: m({ bluesky: 10000, x: 2000 }),
    arpu_pence: 799,
  }

  it('computes cost per signup, CAC and payback from spend and paid', () => {
    const rows = Object.fromEntries(buildRows(base).map((r) => [r.key, r]))
    expect(rows['bluesky']).toMatchObject({
      spend_pence: 10000,
      cost_per_signup_pence: 250,
      cac_pence: 2500,
      revenue_pence: 3196,
    })
    expect(rows['bluesky']!.payback_months).toBeCloseTo(2500 / 799, 5)
  })

  it('leaves CAC blank when nothing has been paid or nothing was spent — never divides by zero', () => {
    const rows = Object.fromEntries(buildRows(base).map((r) => [r.key, r]))
    expect(rows['x']).toMatchObject({
      cac_pence: null,
      payback_months: null,
      cost_per_signup_pence: 167,
    })
    const free = buildRows({ ...base, spend: m({}) }).find((r) => r.key === 'bluesky')!
    expect(free).toMatchObject({ spend_pence: null, cac_pence: null, cost_per_signup_pence: null })
    expect(
      buildRows({ ...base, arpu_pence: null }).find((r) => r.key === 'bluesky')!.payback_months,
    ).toBeNull()
  })

  it('attaches intervals to the conversion rates', () => {
    const b = buildRows(base).find((r) => r.key === 'bluesky')!
    expect(b.visit_to_signup).toMatchObject({ numerator: 40, denominator: 400, rate: 0.1 })
    expect(b.visit_to_signup!.low!).toBeLessThan(0.1)
    expect(b.visit_to_signup!.high!).toBeGreaterThan(0.1)
    expect(b.signup_to_paid).toMatchObject({ numerator: 4, denominator: 40 })
  })

  it('includes a source that only has spend, so wasted budget is visible', () => {
    const rows = buildRows({ ...base, spend: m({ bluesky: 100, google: 5000 }) })
    expect(rows.find((r) => r.key === 'google')).toMatchObject({
      signups: 0,
      paid: 0,
      spend_pence: 5000,
    })
  })

  it('orders by revenue, then signups', () => {
    expect(buildRows(base).map((r) => r.key)).toEqual(['bluesky', 'x'])
  })
})

describe('findings read honestly', () => {
  const row = (over: Record<string, unknown>) =>
    buildRows({
      visits: m({ bluesky: 120 }),
      signups: m({ bluesky: 12 }),
      profiles: m({}),
      activated: m({}),
      paid: m({}),
      revenue: m({}),
      arpu_pence: null,
      ...over,
    } as never)[0]!

  it('says too early when the sample is thin, without quoting a rate', () => {
    const r = row({ visits: m({ bluesky: 20 }), signups: m({ bluesky: 2 }) })
    expect(r.confidence).toBe('insufficient')
    expect(r.finding).toMatch(/too early to compare/)
    expect(r.finding).not.toMatch(/%/)
  })

  it('states the plausible range and that nothing has been paid yet', () => {
    const r = row({})
    expect(r.finding).toMatch(/120 visits → 12 signups \(10%, plausible 5\.8%–17%\)/)
    expect(r.finding).toMatch(/no paid conversions yet/)
    expect(r.finding).toMatch(/Directional only/)
  })

  it('reports revenue, CAC and payback once there are paid families', () => {
    const r = row({
      paid: m({ bluesky: 2 }),
      revenue: m({ bluesky: 1598 }),
      spend: m({ bluesky: 5000 }),
      arpu_pence: 799,
    })
    expect(r.finding).toMatch(/2 paid, £15\.98 revenue, CAC £25, payback ≈ 3\.1 months/)
  })

  it('reads naturally at a count of one', () => {
    const r = row({ visits: m({ bluesky: 1 }), signups: m({ bluesky: 1 }) })
    expect(r.finding).toMatch(/1 visit → 1 signup so far/)
    expect(r.finding).not.toMatch(/1 signups|1 visits/)
  })

  it('names the untagged bucket in words', () => {
    const r = buildRows({
      visits: m({ none: 10 }),
      signups: m({ none: 1 }),
      profiles: m({}),
      activated: m({}),
      paid: m({}),
      revenue: m({}),
      arpu_pence: null,
    })[0]!
    expect(r.finding.startsWith('(no campaign):')).toBe(true)
    expect(r.key).toBe('none')
  })

  it('never uses recommendation language', () => {
    for (const r of [row({}), row({ paid: m({ bluesky: 9 }), revenue: m({ bluesky: 9999 }) })])
      expect(r.finding).not.toMatch(/\b(should|must|invest|stop|scale|increase|cut)\b/i)
  })
})

describe('rollup folding', () => {
  const t = (source: string, campaign = 'pillar_chart', content = 'p1') => ({
    source,
    campaign,
    content,
  })
  const funnel = [
    { dim: funnelDim('visit', 'bluesky', 'pillar_chart'), count: 100 },
    { dim: funnelDim('cta_click', 'bluesky', 'pillar_chart'), count: 20 },
    { dim: funnelDim('signup', 'bluesky', 'pillar_chart'), count: 99 }, // cohort row, ignored here
  ]
  const journey = [
    { dim: journeyDim('first', 'signup', t('bluesky')), count: 10 },
    { dim: journeyDim('first', 'paid', t('bluesky')), count: 2 },
    { dim: journeyDim('last', 'signup', t('x', 'pillar_guides', 'p9')), count: 10 },
    { dim: journeyDim('last', 'last_known', t('x', 'pillar_guides', 'p9')), count: 7 },
    { dim: 'garbage', count: 5 },
  ]

  it('reads visits and clicks from the funnel and everything else from the chosen model', () => {
    const f = foldRollups(funnel, journey, 'first')
    expect(f.visitsBySource.get('bluesky')).toBe(100)
    expect(f.ctaBySource.get('bluesky')).toBe(20)
    expect(f.step.signup.source.get('bluesky')).toBe(10)
    expect(f.step.paid.source.get('bluesky')).toBe(2)
    expect(f.step.signup.source.has('x')).toBe(false)
    expect(f.step.signup.content.get('p1')).toBe(10)
  })

  it('credits the same signups to different sources under last touch, and totals reconcile', () => {
    const first = buildView(funnel, journey, new Map(), {
      days: 30,
      model: 'first',
      arpu_pence: null,
    })
    const last = buildView(funnel, journey, new Map(), {
      days: 30,
      model: 'last',
      arpu_pence: null,
    })
    expect(first.by_source.map((r) => r.key)).toContain('bluesky')
    expect(last.by_source.find((r) => r.key === 'x')!.signups).toBe(10)
    expect(first.totals.signups).toBe(10)
    expect(last.totals.signups).toBe(10)
  })

  it('reports how much of last touch was actually captured, only for the last-touch model', () => {
    expect(
      buildView(funnel, journey, new Map(), { days: 30, model: 'last', arpu_pence: null })
        .last_touch_coverage,
    ).toBeCloseTo(0.7)
    expect(
      buildView(funnel, journey, new Map(), { days: 30, model: 'first', arpu_pence: null })
        .last_touch_coverage,
    ).toBeNull()
  })

  it('explains blanks instead of leaving them unexplained', () => {
    const notes = buildView(funnel, journey, new Map(), {
      days: 30,
      model: 'last',
      arpu_pence: null,
    }).notes.join(' ')
    expect(notes).toMatch(/Payback is blank until Stripe revenue has synced/)
    expect(notes).toMatch(/No spend recorded/)
    expect(notes).toMatch(/70% of signups/)
  })
})

describe('spend', () => {
  it('validates month, channel and amount', () => {
    expect(validateSpend({ month: '2026-10', channel: 'bluesky', amount_pence: 5000 })).toBeNull()
    expect(validateSpend({ month: '2026-13', channel: 'bluesky', amount_pence: 5000 })).toMatch(
      /month/,
    )
    expect(validateSpend({ month: '2026-10', channel: 'Blue Sky!', amount_pence: 5000 })).toMatch(
      /channel/,
    )
    expect(validateSpend({ month: '2026-10', channel: 'x', amount_pence: 0 })).toMatch(/amount/)
    expect(validateSpend({ month: '2026-10', channel: 'x', amount_pence: 12.5 })).toMatch(/amount/)
    expect(
      validateSpend({ month: '2026-10', channel: 'x', amount_pence: 999_999_999_999 }),
    ).toMatch(/amount/)
  })

  it('spreads a month evenly across days and takes the right share of a clipped window', () => {
    const oct = [{ month: '2026-10', channel: 'bluesky', amount_pence: 3100 }]
    const d = (s: string) => new Date(`${s}T00:00:00Z`)
    expect(spendInWindow(oct, d('2026-10-01'), d('2026-10-31')).get('bluesky')).toBe(3100)
    expect(spendInWindow(oct, d('2026-10-22'), d('2026-10-31')).get('bluesky')).toBe(1000)
    expect(spendInWindow(oct, d('2026-11-01'), d('2026-11-30')).get('bluesky')).toBeUndefined()
    const two = [
      { month: '2026-09', channel: 'x', amount_pence: 3000 },
      { month: '2026-10', channel: 'x', amount_pence: 3100 },
    ]
    // Sep 21-30 = 10 days at £1/day, Oct 1-20 = 20 days at £1/day.
    expect(spendInWindow(two, d('2026-09-21'), d('2026-10-20')).get('x')).toBe(3000)
  })
})

describe('readEconomics', () => {
  let mongod: MongoMemoryServer
  let client: MongoClient
  let db: Db
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create()
    client = new MongoClient(mongod.getUri())
    await client.connect()
    db = client.db('economics')
  })
  beforeEach(async () => {
    await db.dropDatabase()
  })
  afterAll(async () => {
    await client.close()
    await mongod.stop()
  })

  it('reads the window from the rollups and joins spend', async () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const t = { source: 'bluesky', campaign: 'pillar_chart', content: 'p1' }
    await db.collection('metrics_daily').insertMany([
      {
        _id: 'a' as never,
        metric: 'funnel',
        day: '2026-10-19',
        dim: funnelDim('visit', 'bluesky', 'pillar_chart'),
        count: 80,
      },
      {
        _id: 'b' as never,
        metric: 'funnel',
        day: '2026-09-01',
        dim: funnelDim('visit', 'bluesky', 'pillar_chart'),
        count: 999,
      }, // outside window
      {
        _id: 'c' as never,
        metric: 'journey',
        day: '2026-10-19',
        dim: journeyDim('first', 'signup', t),
        count: 12,
      },
      {
        _id: 'd' as never,
        metric: 'journey',
        day: '2026-10-19',
        dim: journeyDim('first', 'paid', t),
        count: 3,
      },
      {
        _id: 'e' as never,
        metric: 'journey',
        day: '2026-10-19',
        dim: journeyDim('first', 'revenue', t),
        count: 2397,
      },
    ])
    await addSpend(db, { month: '2026-10', channel: 'bluesky', amount_pence: 3100 }, 'op')
    const view = await readEconomics(db, { days: 30, model: 'first', arpu_pence: 799, now })
    const row = view.by_source.find((r) => r.key === 'bluesky')!
    expect(row).toMatchObject({ visits: 80, signups: 12, paid: 3, revenue_pence: 2397 })
    // Oct 1–20 of a 31-day month at £31 → 20/31 of 3100.
    expect(row.spend_pence).toBe(2000)
    expect(row.cac_pence).toBe(667)
    expect(view.by_content.find((r) => r.key === 'p1')).toMatchObject({ signups: 12, visits: null })
  })
})

it('describeRow is stable for a row with no data at all', () => {
  const [r] = buildRows({
    signups: m({}),
    profiles: m({}),
    activated: m({}),
    paid: m({}),
    revenue: m({ 'All sources': 0 }),
    spend: m({ 'All sources': 0 }),
    arpu_pence: null,
  })
  expect(r).toBeDefined()
  expect(describeRow({ ...r!, finding: undefined } as never)).toMatch(/too early/)
})
