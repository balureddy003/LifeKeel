/**
 * Per-post attribution (PRD-218): the tag, the features recorded at draft
 * time, and the visits/signups-per-tag reads that power the weekly posts
 * table and the learning block.
 *
 * Joins:
 *   visits   — growth_events.meta.utm_content == the post's tag (anonymous,
 *              first-party events; old posts join by source_blog_slug since
 *              pre-tag links carried the slug in utm_content)
 *   signups  — metrics_daily journey rows, model 'last', step 'signup',
 *              whose content dim equals the tag/slug (built by
 *              jobs/metrics-rollup.ts from journeys.ts — no user/lead scan)
 *
 * Aggregate-only: everything out of here is a count keyed on a post tag,
 * never a person.
 */
import type { Db } from 'mongodb'
import { attributionContent, newPostTag } from './utm.js'
import { parseJourneyDim } from './journeys.js'
import { wilson } from './economics.js'

/** Events the funnel counts as a visit (same mapping as funnel.ts). */
export const VISIT_EVENTS = ['landing_view', 'blog_view', 'guide_view', 'signup_view'] as const

/* ------------------------------------------------------------------ */
/* Features recorded at draft time                                     */
/* ------------------------------------------------------------------ */

export type HourBucket = 'morning' | 'midday' | 'afternoon' | 'evening'
export type LengthBucket = 'short' | 'medium' | 'long'

export interface PostFeatures {
  /** Filled by PRD-219 formats; null until then. */
  format: string | null
  hook: string | null
  pillar: string | null
  channel: string
  length_bucket: LengthBucket
  /** Scheduled hour in Europe/London, bucketed; null when unscheduled. */
  hour_bucket: HourBucket | null
  has_media: boolean
}

export function lengthBucket(content: string): LengthBucket {
  const n = content.length
  return n <= 140 ? 'short' : n <= 400 ? 'medium' : 'long'
}

const londonHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  hour12: false,
})

export function hourBucket(at: Date | undefined | null): HourBucket | null {
  if (!at) return null
  const h = Number(londonHour.format(at))
  if (h >= 5 && h < 11) return 'morning'
  if (h >= 11 && h < 15) return 'midday'
  if (h >= 15 && h < 19) return 'afternoon'
  return 'evening'
}

export function postFeatures(p: {
  channel: string
  content: string
  pillar?: string | null
  media_url?: string | null
  scheduled_at?: Date | null
  format?: string | null
  hook?: string | null
}): PostFeatures {
  return {
    format: p.format ?? null,
    hook: p.hook ?? null,
    pillar: p.pillar ?? null,
    channel: p.channel,
    length_bucket: lengthBucket(p.content),
    hour_bucket: hourBucket(p.scheduled_at),
    has_media: Boolean(p.media_url),
  }
}

/* ------------------------------------------------------------------ */
/* Tag allocation                                                      */
/* ------------------------------------------------------------------ */

/** Draw a post tag unused in the collection. Tags are globally unique —
 *  growth_events are anonymous (no tenant_id), so a cross-tenant collision
 *  would silently cross-attribute visits. The unique sparse index on
 *  { post_tag: 1 } is the backstop for a raced draw. */
export async function uniquePostTag(
  col: { findOne(filter: { post_tag: string }): Promise<unknown> },
  rand: () => number = Math.random,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const tag = newPostTag(rand)
    if (!(await col.findOne({ post_tag: tag }))) return tag
  }
  throw new Error('could not allocate a unique post tag')
}

/* ------------------------------------------------------------------ */
/* Per-tag reads                                                       */
/* ------------------------------------------------------------------ */

interface GrowthEventDoc {
  event: string
  meta?: Record<string, unknown> | null
}

/** Visits per utm_content token over `since`, bucketed the rollup way
 *  (non-token values count as "other", missing as "none"). */
export async function visitsByContent(db: Db, since?: Date): Promise<Map<string, number>> {
  const match: Record<string, unknown> = { event: { $in: [...VISIT_EVENTS] } }
  if (since) match['created_at'] = { $gte: since }
  const rows = await db
    .collection<GrowthEventDoc>('growth_events')
    .aggregate<{ _id: unknown; count: number }>([
      { $match: match },
      { $group: { _id: '$meta.utm_content', count: { $sum: 1 } } },
    ])
    .toArray()
  const out = new Map<string, number>()
  for (const r of rows) {
    const key = attributionContent({ utm_content: r._id })
    out.set(key, (out.get(key) ?? 0) + r.count)
  }
  return out
}

/** Signups per content token (post tag or legacy slug), last-touch model,
 *  read from the journey rollup in metrics_daily — never by scanning users. */
export async function signupsByContent(db: Db, since?: Date): Promise<Map<string, number>> {
  const match: Record<string, unknown> = { metric: 'journey' }
  if (since) match['day'] = { $gte: since.toISOString().slice(0, 10) }
  const rows = await db
    .collection('metrics_daily')
    .find(match)
    .project({ dim: 1, count: 1 })
    .toArray()
  const out = new Map<string, number>()
  for (const r of rows) {
    const d = parseJourneyDim(String(r['dim'] ?? ''))
    if (!d || d.model !== 'last' || d.step !== 'signup') continue
    out.set(d.content, (out.get(d.content) ?? 0) + (r['count'] as number))
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The weekly table                                                    */
/* ------------------------------------------------------------------ */

/** The join key for a post: its tag, or the blog slug its pre-tag links
 *  still carry on the platforms. */
export function postJoinKey(p: { post_tag?: string; source_blog_slug?: string }): string | null {
  return p.post_tag ?? p.source_blog_slug ?? null
}

export interface PostStatRow {
  id: string
  post_tag: string | null
  channel: string
  format: string | null
  hook: string | null
  pillar: string | null
  length_bucket: LengthBucket | null
  hour_bucket: HourBucket | null
  has_media: boolean
  posted_at: string | null
  visits: number
  signups: number
  engagement: { likes: number; reposts: number; replies: number }
  /** Pre-tag posts sit in the table but not in grouped stats. */
  tagged: boolean
}

export interface PostStatGroup {
  key: string | null
  posts: number
  visits: number
  signups: number
  visits_per_post: number
  /** Approximate 95% interval on visits-per-post (Poisson rate, normal
   *  approximation) — the traffic is too thin for anything fancier. */
  visits_per_post_interval: { low: number; high: number } | null
  /** Wilson 95% interval on signups per visit, when there are visits. */
  signup_rate_interval: { low: number; high: number } | null
  insufficient: boolean
}

export interface PostStatsView {
  rows: PostStatRow[]
  groups: Record<string, PostStatGroup[]>
}

export const GROUP_MIN_POSTS = 5
export const GROUP_DIMENSIONS = ['format', 'hook', 'pillar', 'channel', 'hour_bucket'] as const
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]

export interface StatPost {
  id: string
  post_tag?: string
  source_blog_slug?: string
  channel?: string
  pillar?: string
  features?: Partial<PostFeatures>
  published_at?: Date
  scheduled_at?: Date
  created_at?: Date
  metrics?: { likes?: number; reposts?: number; replies?: number }
}

export function postStats(
  posts: StatPost[],
  visits: Map<string, number>,
  signups: Map<string, number>,
): PostStatsView {
  const rows: PostStatRow[] = posts.map((p) => {
    const key = postJoinKey(p)
    const m = p.metrics ?? {}
    return {
      id: p.id,
      post_tag: p.post_tag ?? null,
      channel: p.channel ?? 'unknown',
      format: p.features?.format ?? null,
      hook: p.features?.hook ?? null,
      pillar: p.features?.pillar ?? p.pillar ?? null,
      length_bucket: p.features?.length_bucket ?? null,
      hour_bucket: p.features?.hour_bucket ?? null,
      has_media: p.features?.has_media ?? false,
      posted_at: (p.published_at ?? p.scheduled_at ?? p.created_at ?? null)?.toISOString() ?? null,
      visits: key ? (visits.get(key) ?? 0) : 0,
      signups: key ? (signups.get(key) ?? 0) : 0,
      engagement: { likes: m.likes ?? 0, reposts: m.reposts ?? 0, replies: m.replies ?? 0 },
      tagged: Boolean(p.post_tag),
    }
  })
  rows.sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''))

  const groups: Record<string, PostStatGroup[]> = {}
  for (const dim of GROUP_DIMENSIONS) {
    const byKey = new Map<string | null, PostStatRow[]>()
    for (const r of rows) {
      if (!r.tagged) continue // untagged posts stay out of grouped stats
      const k = r[dim as keyof PostStatRow] as string | null
      const list = byKey.get(k) ?? []
      list.push(r)
      byKey.set(k, list)
    }
    groups[dim] = [...byKey.entries()]
      .map(([key, members]) => {
        const n = members.length
        const v = members.reduce((s, r) => s + r.visits, 0)
        const s = members.reduce((t, r) => t + r.signups, 0)
        const insufficient = n < GROUP_MIN_POSTS
        return {
          key,
          posts: n,
          visits: v,
          signups: s,
          visits_per_post: n > 0 ? v / n : 0,
          // Poisson rate interval (Wilson is for proportions — rates get the
          // normal approximation instead).
          visits_per_post_interval: insufficient
            ? null
            : {
                low: Math.max(0, (v + 2 - 1.96 * Math.sqrt(v + 1)) / n),
                high: (v + 2 + 1.96 * Math.sqrt(v + 1)) / n,
              },
          signup_rate_interval: insufficient ? null : wilson(s, v),
          insufficient,
        }
      })
      .sort((a, b) => b.visits_per_post - a.visits_per_post)
  }
  return { rows, groups }
}
