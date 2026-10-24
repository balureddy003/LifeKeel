/**
 * Search Console and GA4 read-back (intent 47, step 2): pull, roll up, and report.
 *
 * Everything stored here is an aggregate: a day, a sanitised query or a path, and counts. No user ids,
 * client ids or IPs ever reach this module, and queries that could identify a person are dropped before
 * they are stored. Nothing is written to Google. The pull is idempotent: the last week is re-read every
 * day (Search Console revises recent days) and rows are upserted by day and key.
 */
import type { Db } from 'mongodb'
import { googleAccessTokenProvider } from '@lifekeel/platform'
import {
  GA4_SCOPE,
  GoogleReadError,
  SEARCH_CONSOLE_SCOPE,
  isoDay,
  readbackConfig,
  readbackPresence,
  sanitizeQuery,
  type ReadbackConfig,
} from './google-read.js'
import { querySearchAnalytics, type SearchRow } from './search-console.js'
import { runGa4Report, type Ga4Row } from './ga4.js'

/** Search data is final about this many days back; stop the window there. */
export const SEARCH_LAG_DAYS = 3
/** Days re-read on every run, because the most recent days get revised. */
export const REFRESH_WINDOW_DAYS = 7
export const RETENTION_DAYS = 400

export type IntegrationId = 'search_console' | 'ga4'
export type IntegrationStatus = 'connected' | 'not_configured' | 'needs_attention'

export interface IntegrationState {
  _id: IntegrationId
  status: IntegrationStatus
  last_attempt_at: Date
  last_ok_at?: Date
  last_error?: string
  rows?: number
}

export interface QueryDayDoc {
  day: string
  query: string
  clicks: number
  impressions: number
  position: number
}
export interface PageDayDoc {
  day: string
  path: string
  clicks: number
  impressions: number
  position: number
}
export interface Ga4DayDoc {
  day: string
  source: string
  medium: string
  landing: string
  sessions: number
  engaged: number
  key_events: number
}

export const searchQueries = (db: Db) => db.collection<QueryDayDoc>('search_queries_daily')
export const searchPages = (db: Db) => db.collection<PageDayDoc>('search_pages_daily')
export const ga4Daily = (db: Db) => db.collection<Ga4DayDoc>('ga4_daily')
const stateCol = (db: Db) => db.collection<IntegrationState>('search_readback_state')

export function ensureSearchIndexes(db: Db): void {
  searchQueries(db)
    .createIndex({ day: 1, query: 1 }, { unique: true })
    .catch(() => {})
  searchPages(db)
    .createIndex({ day: 1, path: 1 }, { unique: true })
    .catch(() => {})
  ga4Daily(db)
    .createIndex({ day: 1, source: 1, medium: 1, landing: 1 }, { unique: true })
    .catch(() => {})
}

/** A page URL or path reduced to its path, with no query string, fragment or trailing slash. */
export function toPath(raw: string): string {
  let p = raw
  try {
    p = new URL(raw, 'https://x.invalid').pathname
  } catch {
    // keep as given
  }
  p = p.split('?')[0]!.split('#')[0]!
  return p.length > 1 ? p.replace(/\/+$/, '') : p || '/'
}

export interface ReadbackDeps {
  config?: ReadbackConfig
  fetchImpl?: typeof fetch
  /** Test seams: replace the network clients. */
  searchRows?: (
    dimensions: ('date' | 'query' | 'page')[],
    start: string,
    end: string,
  ) => Promise<SearchRow[]>
  ga4Rows?: (start: string, end: string) => Promise<Ga4Row[]>
}

async function setState(db: Db, s: Omit<IntegrationState, 'last_attempt_at'>, now: Date) {
  const { _id, ...rest } = s
  await stateCol(db).updateOne(
    { _id },
    { $set: { ...rest, last_attempt_at: now } },
    { upsert: true },
  )
}

function errorText(err: unknown): string {
  return err instanceof GoogleReadError
    ? `${err.kind}: ${err.message}`
    : `failed: ${(err as Error).message}`
}

export interface ReadbackRun {
  search_console: IntegrationStatus
  ga4: IntegrationStatus
  query_rows: number
  page_rows: number
  ga4_rows: number
}

export async function runSearchReadback(
  db: Db,
  now = new Date(),
  deps: ReadbackDeps = {},
): Promise<ReadbackRun> {
  const cfg = deps.config ?? readbackConfig()
  const presence = readbackPresence(cfg)
  const out: ReadbackRun = {
    search_console: 'not_configured',
    ga4: 'not_configured',
    query_rows: 0,
    page_rows: 0,
    ga4_rows: 0,
  }
  const end = isoDay(now, SEARCH_LAG_DAYS)
  const start = isoDay(now, SEARCH_LAG_DAYS + REFRESH_WINDOW_DAYS - 1)

  // ── Search Console ─────────────────────────────────────────────────────
  if (!presence.search_console && !deps.searchRows) {
    await setState(db, { _id: 'search_console', status: 'not_configured' }, now)
  } else {
    try {
      const token = googleAccessTokenProvider({
        credentialsJson: cfg.credentialsJson,
        scope: SEARCH_CONSOLE_SCOPE,
        label: 'Search Console',
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      })
      const read =
        deps.searchRows ??
        (async (dimensions, s, e) => {
          if (!token) throw new GoogleReadError('forbidden', 'No usable service-account key')
          return querySearchAnalytics({
            token,
            siteUrl: cfg.siteUrl!,
            startDate: s,
            endDate: e,
            dimensions,
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          })
        })
      const qRows = await read(['date', 'query'], start, end)
      const pRows = await read(['date', 'page'], start, end)
      for (const r of qRows) {
        const query = sanitizeQuery(r.keys[1] ?? '')
        if (!query || !r.keys[0]) continue
        await searchQueries(db).updateOne(
          { day: r.keys[0], query },
          { $set: { clicks: r.clicks, impressions: r.impressions, position: r.position } },
          { upsert: true },
        )
        out.query_rows++
      }
      for (const r of pRows) {
        if (!r.keys[0] || !r.keys[1]) continue
        const path = toPath(r.keys[1])
        await searchPages(db).updateOne(
          { day: r.keys[0], path },
          { $set: { clicks: r.clicks, impressions: r.impressions, position: r.position } },
          { upsert: true },
        )
        out.page_rows++
      }
      out.search_console = 'connected'
      await setState(
        db,
        {
          _id: 'search_console',
          status: 'connected',
          last_ok_at: now,
          rows: out.query_rows + out.page_rows,
        },
        now,
      )
    } catch (err) {
      out.search_console = 'needs_attention'
      await setState(
        db,
        { _id: 'search_console', status: 'needs_attention', last_error: errorText(err) },
        now,
      )
    }
  }

  // ── GA4 ────────────────────────────────────────────────────────────────
  if (!presence.ga4 && !deps.ga4Rows) {
    await setState(db, { _id: 'ga4', status: 'not_configured' }, now)
  } else {
    try {
      const token = googleAccessTokenProvider({
        credentialsJson: cfg.credentialsJson,
        scope: GA4_SCOPE,
        label: 'GA4',
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      })
      const read =
        deps.ga4Rows ??
        (async (s, e) => {
          if (!token) throw new GoogleReadError('forbidden', 'No usable service-account key')
          return runGa4Report({
            token,
            propertyId: cfg.propertyId!,
            startDate: s,
            endDate: e,
            dimensions: ['date', 'sessionSource', 'sessionMedium', 'landingPage'],
            metrics: ['sessions', 'engagedSessions', 'keyEvents'],
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          })
        })
      for (const r of await read(start, end)) {
        const [date, source, medium, landing] = r.dims
        if (!date || date.length !== 8) continue
        const day = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        await ga4Daily(db).updateOne(
          {
            day,
            source: (source ?? '(not set)').slice(0, 80),
            medium: (medium ?? '(not set)').slice(0, 80),
            landing: toPath(landing ?? '/'),
          },
          {
            $set: {
              sessions: r.metrics[0] ?? 0,
              engaged: r.metrics[1] ?? 0,
              key_events: r.metrics[2] ?? 0,
            },
          },
          { upsert: true },
        )
        out.ga4_rows++
      }
      out.ga4 = 'connected'
      await setState(
        db,
        { _id: 'ga4', status: 'connected', last_ok_at: now, rows: out.ga4_rows },
        now,
      )
    } catch (err) {
      out.ga4 = 'needs_attention'
      await setState(db, { _id: 'ga4', status: 'needs_attention', last_error: errorText(err) }, now)
    }
  }

  // Keep a bounded history.
  const cutoff = isoDay(now, RETENTION_DAYS)
  await Promise.all([
    searchQueries(db).deleteMany({ day: { $lt: cutoff } }),
    searchPages(db).deleteMany({ day: { $lt: cutoff } }),
    ga4Daily(db).deleteMany({ day: { $lt: cutoff } }),
  ])
  return out
}

// ── reporting ───────────────────────────────────────────────────────────────

/** Below this many total impressions in the window, rankings are noise and the view says so. */
export const MIN_IMPRESSIONS_FOR_RANKING = 50
/** A near miss: plenty of impressions, a poor click-through rate, ranking on the first two pages. */
export const NEAR_MISS_MIN_IMPRESSIONS = 20
export const NEAR_MISS_MAX_CTR = 0.02
export const NEAR_MISS_MAX_POSITION = 20

interface Agg {
  clicks: number
  impressions: number
  posImpr: number
}
const add = (
  m: Map<string, Agg>,
  k: string,
  d: { clicks: number; impressions: number; position: number },
) => {
  const a = m.get(k) ?? { clicks: 0, impressions: 0, posImpr: 0 }
  a.clicks += d.clicks
  a.impressions += d.impressions
  a.posImpr += d.position * d.impressions // impressions-weighted average position
  m.set(k, a)
}
const finish = (m: Map<string, Agg>, key: 'query' | 'path') =>
  [...m]
    .map(([k, a]) => ({
      [key]: k,
      clicks: a.clicks,
      impressions: a.impressions,
      ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
      position: a.impressions > 0 ? Math.round((a.posImpr / a.impressions) * 10) / 10 : 0,
    }))
    .sort((x, y) => y.clicks - x.clicks || y.impressions - x.impressions)

export async function searchView(db: Db, days = 28, now = new Date()) {
  const from = isoDay(now, days)
  const [qDocs, pDocs, gDocs, states] = await Promise.all([
    searchQueries(db)
      .find({ day: { $gte: from } })
      .toArray(),
    searchPages(db)
      .find({ day: { $gte: from } })
      .toArray(),
    ga4Daily(db)
      .find({ day: { $gte: from } })
      .toArray(),
    stateCol(db).find({}).toArray(),
  ])
  const q = new Map<string, Agg>()
  const p = new Map<string, Agg>()
  for (const d of qDocs) add(q, d.query, d)
  for (const d of pDocs) add(p, d.path, d)
  const queries = finish(q, 'query') as {
    query: string
    clicks: number
    impressions: number
    ctr: number
    position: number
  }[]
  const pages = finish(p, 'path') as {
    path: string
    clicks: number
    impressions: number
    ctr: number
    position: number
  }[]
  const totalImpressions = queries.reduce((n, r) => n + r.impressions, 0)

  const bySource = new Map<string, { sessions: number; engaged: number; key_events: number }>()
  for (const g of gDocs) {
    const k = `${g.source} / ${g.medium}`
    const a = bySource.get(k) ?? { sessions: 0, engaged: 0, key_events: 0 }
    a.sessions += g.sessions
    a.engaged += g.engaged
    a.key_events += g.key_events
    bySource.set(k, a)
  }
  const ga4Sessions = gDocs.reduce((n, g) => n + g.sessions, 0)
  // First-party visits over the same days, so the two can be compared (GA4 is consent-gated and will be lower).
  const firstParty = await db.collection('growth_events').countDocuments({
    event: 'landing_view',
    created_at: { $gte: new Date(`${from}T00:00:00Z`), $lte: now },
  })

  const state = (id: IntegrationId) => {
    const s = states.find((x) => x._id === id)
    return {
      status: (s?.status ?? 'not_configured') as IntegrationStatus,
      last_ok_at: s?.last_ok_at ?? null,
      last_error: s?.last_error ?? null,
    }
  }
  return {
    window_days: days,
    lag_note: `Search data is final about ${SEARCH_LAG_DAYS} days back, so the most recent days are missing or still changing.`,
    integrations: { search_console: state('search_console'), ga4: state('ga4') },
    enough_data: totalImpressions >= MIN_IMPRESSIONS_FOR_RANKING,
    totals: {
      clicks: queries.reduce((n, r) => n + r.clicks, 0),
      impressions: totalImpressions,
    },
    top_queries: queries.slice(0, 25),
    top_pages: pages.slice(0, 25),
    near_misses: queries
      .filter(
        (r) =>
          r.impressions >= NEAR_MISS_MIN_IMPRESSIONS &&
          r.ctr <= NEAR_MISS_MAX_CTR &&
          r.position <= NEAR_MISS_MAX_POSITION,
      )
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15),
    ga4: {
      sessions: ga4Sessions,
      by_source: [...bySource]
        .map(([k, v]) => ({ source_medium: k, ...v }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 15),
      first_party_visits: firstParty,
      note: 'GA4 only counts visitors who accepted analytics cookies, so it reads lower than first-party visits.',
    },
  }
}

/** Integrations that have been set up but failed their last pull (for Mission Control). */
export async function searchIssues(
  db: Db,
): Promise<{ id: IntegrationId; error: string; at: Date }[]> {
  return (await stateCol(db).find({ status: 'needs_attention' }).toArray()).map((s) => ({
    id: s._id,
    error: s.last_error ?? 'The last pull failed',
    at: s.last_attempt_at,
  }))
}
