/**
 * The marketing funnel, rolled up daily (PRD-210, phase 4).
 *
 *   visit          a landing, blog or guide page view
 *   cta_click      a click on a signup call to action
 *   signup         an account created
 *   profile        the signup's family has a financial profile
 *   first_insight  the signup's family has received a first insight
 *
 * Visits and clicks are counted on the day they happen. The last three are a signup cohort: the
 * accounts created on a day, measured as they mature, so the numbers for the last 30 days are
 * recomputed every night. Every row is keyed by the UTM source and campaign (marketing/utm.ts) so
 * the console can read the funnel by network and by pillar without scanning any collection.
 * Rows live in `metrics_daily` as metric "funnel", dim "step|source|campaign".
 */
import type { Db } from 'mongodb'
import { attributionKey } from './utm.js'

export const FUNNEL_STEPS = ['visit', 'cta_click', 'signup', 'profile', 'first_insight'] as const
export type FunnelStep = (typeof FUNNEL_STEPS)[number]

/** Growth events that count as each step. */
export const EVENT_STEP: Record<string, FunnelStep> = {
  landing_view: 'visit',
  blog_view: 'visit',
  guide_view: 'visit',
  landing_cta_click: 'cta_click',
  landing_get_started_click: 'cta_click',
  blog_cta_click: 'cta_click',
}

export const COHORT_DAYS = 30

export const funnelDim = (step: FunnelStep, source: string, campaign: string) => `${step}|${source}|${campaign}`

export function parseFunnelDim(dim: string): { step: FunnelStep; source: string; campaign: string } | null {
  const [step, source, campaign] = dim.split('|')
  if (!step || !source || !campaign || !(FUNNEL_STEPS as readonly string[]).includes(step)) return null
  return { step: step as FunnelStep, source, campaign }
}

export interface FunnelRow {
  day: string
  metric: 'funnel'
  dim: string
  count: number
}

/** Visits and CTA clicks for one day, by source and campaign. */
export async function eventFunnelRows(db: Db, day: string, range: { $gte: Date; $lte: Date }): Promise<FunnelRow[]> {
  const events = Object.keys(EVENT_STEP)
  const groups = await db
    .collection('growth_events')
    .aggregate([
      { $match: { created_at: range, event: { $in: events } } },
      {
        $group: {
          _id: { event: '$event', source: '$meta.utm_source', campaign: '$meta.utm_campaign' },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray()
  const sums = new Map<string, number>()
  for (const g of groups) {
    const id = g['_id'] as { event: string; source?: unknown; campaign?: unknown }
    const step = EVENT_STEP[id.event]
    if (!step) continue
    const { source, campaign } = attributionKey({ utm_source: id.source, utm_campaign: id.campaign })
    const dim = funnelDim(step, source, campaign)
    sums.set(dim, (sums.get(dim) ?? 0) + (g['count'] as number))
  }
  return [...sums].map(([dim, count]) => ({ day, metric: 'funnel' as const, dim, count }))
}

/** The signup cohort created on `day`, and how far along it is now. */
export async function cohortFunnelRows(db: Db, day: string, range: { $gte: Date; $lte: Date }): Promise<FunnelRow[]> {
  const users = await db
    .collection('users')
    .find({ created_at: range }, { projection: { _id: 0, tenant_id: 1, attribution: 1 } })
    .toArray()
  if (users.length === 0) return []
  const tenantIds = [...new Set(users.map((u) => u['tenant_id'] as string).filter(Boolean))]
  const [profileTenants, insightTenants] = await Promise.all([
    db.collection('family_financial_profile').distinct('tenant_id', { tenant_id: { $in: tenantIds } }),
    db.collection('insights').distinct('tenant_id', { tenant_id: { $in: tenantIds } }),
  ])
  const hasProfile = new Set(profileTenants.map(String))
  const hasInsight = new Set(insightTenants.map(String))

  const sums = new Map<string, number>()
  const add = (step: FunnelStep, source: string, campaign: string) => {
    const dim = funnelDim(step, source, campaign)
    sums.set(dim, (sums.get(dim) ?? 0) + 1)
  }
  const seenTenant = new Set<string>()
  for (const u of users) {
    const { source, campaign } = attributionKey(u['attribution'] as Record<string, unknown> | undefined)
    add('signup', source, campaign)
    const t = u['tenant_id'] as string
    if (!t || seenTenant.has(t)) continue // a family counts once, under its first signup
    seenTenant.add(t)
    if (hasProfile.has(t)) add('profile', source, campaign)
    if (hasInsight.has(t)) add('first_insight', source, campaign)
  }
  return [...sums].map(([dim, count]) => ({ day, metric: 'funnel' as const, dim, count }))
}

export interface FunnelView {
  window_days: number
  /** Totals per step across all sources. */
  steps: { step: FunnelStep; count: number }[]
  by_source: FunnelBreakdown[]
  by_campaign: FunnelBreakdown[]
}
export interface FunnelBreakdown {
  key: string
  visit: number
  cta_click: number
  signup: number
  profile: number
  first_insight: number
}

/** Fold rollup rows into the funnel the console shows. Pure, so it is tested on its own. */
export function buildFunnelView(rows: { dim: string; count: number }[], windowDays: number): FunnelView {
  const totals = new Map<FunnelStep, number>(FUNNEL_STEPS.map((s) => [s, 0]))
  const bySource = new Map<string, FunnelBreakdown>()
  const byCampaign = new Map<string, FunnelBreakdown>()
  const get = (m: Map<string, FunnelBreakdown>, key: string) => {
    let b = m.get(key)
    if (!b) m.set(key, (b = { key, visit: 0, cta_click: 0, signup: 0, profile: 0, first_insight: 0 }))
    return b
  }
  for (const r of rows) {
    const p = parseFunnelDim(r.dim)
    if (!p) continue
    totals.set(p.step, (totals.get(p.step) ?? 0) + r.count)
    get(bySource, p.source)[p.step] += r.count
    get(byCampaign, p.campaign)[p.step] += r.count
  }
  const order = (a: FunnelBreakdown, b: FunnelBreakdown) => b.signup - a.signup || b.visit - a.visit || a.key.localeCompare(b.key)
  return {
    window_days: windowDays,
    steps: FUNNEL_STEPS.map((step) => ({ step, count: totals.get(step) ?? 0 })),
    by_source: [...bySource.values()].sort(order),
    by_campaign: [...byCampaign.values()].sort(order),
  }
}

/** Read the funnel for the last `days` days from the rollups. */
export async function readFunnel(db: Db, days: number, now = new Date()): Promise<FunnelView> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10)
  const rows = await db
    .collection('metrics_daily')
    .find({ metric: 'funnel', day: { $gte: since } }, { projection: { _id: 0, dim: 1, count: 1 } })
    .toArray()
  return buildFunnelView(
    rows.map((r) => ({ dim: r['dim'] as string, count: r['count'] as number })),
    days,
  )
}
