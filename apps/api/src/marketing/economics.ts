/**
 * Channel economics — which sources, campaigns and content bring paying
 * families, at what cost, and how far to trust the numbers.
 *
 * Pure maths first (rates with intervals, CAC, payback, confidence), then a
 * reader that folds the daily rollups, revenue and spend into rows. Output is
 * aggregate-only: counts by source / campaign / content item, never a person.
 *
 * Honesty rules, because the traffic is small today:
 *   - counts are always shown; rates need a minimum sample;
 *   - every rate carries a 95% Wilson interval;
 *   - a row is `insufficient` until it has enough visits and signups to compare.
 */
import type { Db } from 'mongodb'
import { parseFunnelDim } from './funnel.js'
import { parseJourneyDim, type AttributionModel } from './journeys.js'
import { listSpend, spendInWindow } from './spend.js'

export const CONFIDENCE = {
  /** Below this a row is too thin to compare at all. */
  min_visits: 50,
  min_signups: 10,
  /** At or above both of these a row is solid. */
  solid_signups: 30,
  solid_paid: 5,
} as const

export type Confidence = 'insufficient' | 'directional' | 'solid'

/** 95% Wilson score interval for a proportion; null when there is no sample. */
export function wilson(
  successes: number,
  n: number,
  z = 1.96,
): { low: number; high: number } | null {
  if (n <= 0 || successes < 0 || successes > n) return null
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

export interface Rate {
  numerator: number
  denominator: number
  rate: number | null
  low: number | null
  high: number | null
}

export function rate(numerator: number, denominator: number): Rate {
  const w = wilson(numerator, denominator)
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
    low: w?.low ?? null,
    high: w?.high ?? null,
  }
}

/** `visits` is null where the dimension has no visit data (content items). */
export function confidenceFor(c: {
  visits: number | null
  signups: number
  paid: number
}): Confidence {
  if ((c.visits !== null && c.visits < CONFIDENCE.min_visits) || c.signups < CONFIDENCE.min_signups)
    return 'insufficient'
  if (c.signups >= CONFIDENCE.solid_signups && c.paid >= CONFIDENCE.solid_paid) return 'solid'
  return 'directional'
}

export interface EconomicsRow {
  key: string
  visits: number | null
  cta_clicks: number | null
  signups: number
  profiles: number
  activated: number
  paid: number
  revenue_pence: number
  spend_pence: number | null
  cost_per_signup_pence: number | null
  cac_pence: number | null
  payback_months: number | null
  visit_to_signup: Rate | null
  signup_to_activated: Rate
  signup_to_paid: Rate
  confidence: Confidence
  finding: string
}

export interface EconomicsInput {
  /** Visits / CTA clicks by key (source or campaign), from the funnel rollup. */
  visits?: Map<string, number>
  cta?: Map<string, number>
  /** Journey counts by key. */
  signups: Map<string, number>
  profiles: Map<string, number>
  activated: Map<string, number>
  paid: Map<string, number>
  revenue: Map<string, number>
  /** Spend by key; only meaningful for sources. */
  spend?: Map<string, number>
  /** Average monthly revenue per paying family, from Stripe; null when unknown. */
  arpu_pence: number | null
}

const gbp = (pence: number) =>
  `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
const pct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`

export function describeRow(row: Omit<EconomicsRow, 'finding'>): string {
  const label = row.key
  const traffic =
    row.visits === null ? `${row.signups} signups` : `${row.visits} visits → ${row.signups} signups`
  if (row.confidence === 'insufficient')
    return `${label}: ${traffic} so far — too early to compare with other channels.`
  const v = row.visit_to_signup
  const conv =
    v && v.rate !== null && v.low !== null && v.high !== null
      ? ` (${pct(v.rate)}, plausible ${pct(v.low)}–${pct(v.high)})`
      : ''
  const money =
    row.paid > 0
      ? `; ${row.paid} paid, ${gbp(row.revenue_pence)} revenue${row.cac_pence !== null ? `, CAC ${gbp(row.cac_pence)}` : ''}${row.payback_months !== null ? `, payback ≈ ${row.payback_months.toFixed(1)} months` : ''}`
      : '; no paid conversions yet'
  const caveat =
    row.confidence === 'directional' ? ' Directional only — not enough to act on alone.' : ''
  return `${label}: ${traffic}${conv}${money}.${caveat}`
}

export function buildRows(input: EconomicsInput): EconomicsRow[] {
  const keys = new Set<string>([
    ...input.signups.keys(),
    ...(input.visits?.keys() ?? []),
    ...(input.spend?.keys() ?? []),
  ])
  const rows: EconomicsRow[] = []
  for (const key of keys) {
    const visits = input.visits ? (input.visits.get(key) ?? 0) : null
    const signups = input.signups.get(key) ?? 0
    const paid = input.paid.get(key) ?? 0
    const spend = input.spend ? (input.spend.get(key) ?? 0) : null
    const cac = spend !== null && spend > 0 && paid > 0 ? Math.round(spend / paid) : null
    const base: Omit<EconomicsRow, 'finding'> = {
      key,
      visits,
      cta_clicks: input.cta ? (input.cta.get(key) ?? 0) : null,
      signups,
      profiles: input.profiles.get(key) ?? 0,
      activated: input.activated.get(key) ?? 0,
      paid,
      revenue_pence: input.revenue.get(key) ?? 0,
      spend_pence: spend !== null && spend > 0 ? spend : null,
      cost_per_signup_pence:
        spend !== null && spend > 0 && signups > 0 ? Math.round(spend / signups) : null,
      cac_pence: cac,
      payback_months: cac !== null && input.arpu_pence ? cac / input.arpu_pence : null,
      visit_to_signup: visits === null ? null : rate(signups, visits),
      signup_to_activated: rate(input.activated.get(key) ?? 0, signups),
      signup_to_paid: rate(paid, signups),
      confidence: confidenceFor({ visits, signups, paid }),
    }
    rows.push({ ...base, finding: describeRow(base) })
  }
  return rows.sort(
    (a, b) =>
      b.revenue_pence - a.revenue_pence || b.signups - a.signups || a.key.localeCompare(b.key),
  )
}

export interface EconomicsView {
  window_days: number
  model: AttributionModel
  /** All sources together. */
  totals: EconomicsRow
  by_source: EconomicsRow[]
  by_campaign: EconomicsRow[]
  by_content: EconomicsRow[]
  /** Share of signups in the window with a captured last touch (last-touch model only). */
  last_touch_coverage: number | null
  arpu_pence: number | null
  notes: string[]
}

const sumMap = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)
const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n)

interface Folded {
  visitsBySource: Map<string, number>
  visitsByCampaign: Map<string, number>
  ctaBySource: Map<string, number>
  ctaByCampaign: Map<string, number>
  step: Record<
    'signup' | 'profile' | 'first_insight' | 'paid' | 'revenue',
    {
      source: Map<string, number>
      campaign: Map<string, number>
      content: Map<string, number>
    }
  >
  lastKnown: number
  signupsTotal: number
}

/** Fold rollup rows. Pure so it is tested without a database. */
export function foldRollups(
  funnelRows: { dim: string; count: number }[],
  journeyRows: { dim: string; count: number }[],
  model: AttributionModel,
): Folded {
  const mk = () => ({
    source: new Map<string, number>(),
    campaign: new Map<string, number>(),
    content: new Map<string, number>(),
  })
  const f: Folded = {
    visitsBySource: new Map(),
    visitsByCampaign: new Map(),
    ctaBySource: new Map(),
    ctaByCampaign: new Map(),
    step: { signup: mk(), profile: mk(), first_insight: mk(), paid: mk(), revenue: mk() },
    lastKnown: 0,
    signupsTotal: 0,
  }
  for (const r of funnelRows) {
    const p = parseFunnelDim(r.dim)
    if (!p) continue
    if (p.step === 'visit') {
      bump(f.visitsBySource, p.source, r.count)
      bump(f.visitsByCampaign, p.campaign, r.count)
    } else if (p.step === 'cta_click') {
      bump(f.ctaBySource, p.source, r.count)
      bump(f.ctaByCampaign, p.campaign, r.count)
    }
  }
  for (const r of journeyRows) {
    const p = parseJourneyDim(r.dim)
    if (!p || p.model !== model) continue
    if (p.step === 'last_known') {
      f.lastKnown += r.count
      continue
    }
    const bucket = f.step[p.step]
    bump(bucket.source, p.source, r.count)
    bump(bucket.campaign, p.campaign, r.count)
    if (p.content !== 'none') bump(bucket.content, `${p.content}`, r.count)
    if (p.step === 'signup') f.signupsTotal += r.count
  }
  return f
}

export function buildView(
  funnelRows: { dim: string; count: number }[],
  journeyRows: { dim: string; count: number }[],
  spendBySource: Map<string, number>,
  opts: { days: number; model: AttributionModel; arpu_pence: number | null },
): EconomicsView {
  const f = foldRollups(funnelRows, journeyRows, opts.model)
  const common = (dim: 'source' | 'campaign' | 'content') => ({
    signups: f.step.signup[dim],
    profiles: f.step.profile[dim],
    activated: f.step.first_insight[dim],
    paid: f.step.paid[dim],
    revenue: f.step.revenue[dim],
  })
  const by_source = buildRows({
    ...common('source'),
    visits: f.visitsBySource,
    cta: f.ctaBySource,
    spend: spendBySource,
    arpu_pence: opts.arpu_pence,
  })
  const by_campaign = buildRows({
    ...common('campaign'),
    visits: f.visitsByCampaign,
    cta: f.ctaByCampaign,
    arpu_pence: opts.arpu_pence,
  })
  const by_content = buildRows({ ...common('content'), arpu_pence: opts.arpu_pence })
  const totalSpend = sumMap(spendBySource)
  const [totals] = buildRows({
    visits: new Map([['All sources', sumMap(f.visitsBySource)]]),
    cta: new Map([['All sources', sumMap(f.ctaBySource)]]),
    signups: new Map([['All sources', sumMap(f.step.signup.source)]]),
    profiles: new Map([['All sources', sumMap(f.step.profile.source)]]),
    activated: new Map([['All sources', sumMap(f.step.first_insight.source)]]),
    paid: new Map([['All sources', sumMap(f.step.paid.source)]]),
    revenue: new Map([['All sources', sumMap(f.step.revenue.source)]]),
    spend: new Map([['All sources', totalSpend]]),
    arpu_pence: opts.arpu_pence,
  }) as [EconomicsRow]

  const coverage = opts.model === 'last' && f.signupsTotal > 0 ? f.lastKnown / f.signupsTotal : null
  const notes: string[] = []
  if (opts.arpu_pence === null)
    notes.push('Payback is blank until Stripe revenue has synced — revenue per family is unknown.')
  if (totalSpend === 0)
    notes.push('No spend recorded for this window, so CAC and cost per signup are blank.')
  if (coverage !== null && coverage < 1)
    notes.push(
      `Last touch was captured for ${Math.round(coverage * 100)}% of signups; the rest fall back to first touch.`,
    )
  notes.push(
    'Rates are shown with a 95% plausible range; rows marked insufficient are too thin to compare.',
  )
  return {
    window_days: opts.days,
    model: opts.model,
    totals: totals!,
    by_source,
    by_campaign,
    by_content,
    last_touch_coverage: coverage,
    arpu_pence: opts.arpu_pence,
    notes,
  }
}

/** Read the rollups, revenue and spend for the last `days` days. */
export async function readEconomics(
  db: Db,
  opts: { days: number; model: AttributionModel; arpu_pence: number | null; now?: Date },
): Promise<EconomicsView> {
  const now = opts.now ?? new Date()
  const start = new Date(now.getTime() - (opts.days - 1) * 86_400_000)
  const since = start.toISOString().slice(0, 10)
  const [funnel, journey, spend] = await Promise.all([
    db
      .collection('metrics_daily')
      .find(
        { metric: 'funnel', day: { $gte: since } },
        { projection: { _id: 0, dim: 1, count: 1 } },
      )
      .toArray(),
    db
      .collection('metrics_daily')
      .find(
        { metric: 'journey', day: { $gte: since } },
        { projection: { _id: 0, dim: 1, count: 1 } },
      )
      .toArray(),
    listSpend(db, 1000),
  ])
  return buildView(
    funnel.map((r) => ({ dim: r['dim'] as string, count: r['count'] as number })),
    journey.map((r) => ({ dim: r['dim'] as string, count: r['count'] as number })),
    spendInWindow(spend, start, now),
    { days: opts.days, model: opts.model, arpu_pence: opts.arpu_pence },
  )
}
