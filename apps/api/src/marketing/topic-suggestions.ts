/**
 * Topic suggestions from real search queries (intent 47, step 3).
 *
 * Reads the stored query aggregates and proposes queries that people already use but that no existing brief
 * or guide covers. A suggestion is only a line in a list for a person: this module never creates a draft, a
 * bank entry, a guide or a post, and no query text is turned into public copy without the usual drafting,
 * copy guard and approval steps.
 *
 * Queries that read like a request for a personal recommendation ("which provider", "should I switch") are
 * left out, matching the rule that LifeKeel gives information, not advice.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { BRIEFS } from './content-plan.js'
import { isoDay } from './google-read.js'
import { searchQueries } from './search-readback.js'

export const SUGGEST_MIN_IMPRESSIONS = 20
export const SUGGEST_WINDOW_DAYS = 28
/** At or above this word overlap with an existing brief or guide, a query counts as already covered. */
export const COVERED_OVERLAP = 0.5
/** Below this overlap, no "nearest" is shown. */
export const NEAREST_MIN_OVERLAP = 0.2
export const MAX_SUGGESTIONS_PER_RUN = 20

export type SuggestionStatus = 'suggested' | 'dismissed' | 'used'

export interface TopicSuggestionDoc {
  id: string
  query: string
  impressions: number
  clicks: number
  position: number
  nearest: { kind: 'brief' | 'guide'; id: string; title: string; overlap: number } | null
  status: SuggestionStatus
  created_at: Date
  updated_at: Date
}

export const topicSuggestions = (db: Db) => db.collection<TopicSuggestionDoc>('topic_suggestions')

export function ensureSuggestionIndexes(db: Db): void {
  topicSuggestions(db)
    .createIndex({ query: 1 }, { unique: true })
    .catch(() => {})
}

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'my',
  'me',
  'we',
  'our',
  'it',
  'what',
  'how',
  'do',
  'does',
  'i',
  'you',
  'your',
  'can',
  'when',
  'where',
  'who',
  'with',
  'about',
  'uk',
])

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => w.replace(/s$/, '')),
  )
}

/** Share of the query's words found in the candidate title (0 to 1). */
export function overlap(query: Set<string>, title: Set<string>): number {
  if (query.size === 0) return 0
  let hit = 0
  for (const w of query) if (title.has(w)) hit++
  return hit / query.size
}

const ADVICE_LIKE =
  /\b(should i|which (is|are)? ?(the )?(best|better|cheapest)|best|cheapest|recommend(ed|ation)?s?|switch(ing)? to|compare (quotes|prices)|worth it|buy|where to buy)\b/i

export function looksLikeAdviceRequest(query: string): boolean {
  return ADVICE_LIKE.test(query)
}

export interface SuggestRun {
  considered: number
  suggested: number
  covered: number
  skipped_advice_like: number
}

export async function generateSuggestions(db: Db, now = new Date()): Promise<SuggestRun> {
  const run: SuggestRun = { considered: 0, suggested: 0, covered: 0, skipped_advice_like: 0 }
  const from = isoDay(now, SUGGEST_WINDOW_DAYS)
  const agg = new Map<string, { clicks: number; impressions: number; posImpr: number }>()
  for (const d of await searchQueries(db)
    .find({ day: { $gte: from } })
    .toArray()) {
    const a = agg.get(d.query) ?? { clicks: 0, impressions: 0, posImpr: 0 }
    a.clicks += d.clicks
    a.impressions += d.impressions
    a.posImpr += d.position * d.impressions
    agg.set(d.query, a)
  }

  const covers: { kind: 'brief' | 'guide'; id: string; title: string; words: Set<string> }[] = [
    ...BRIEFS.map((b) => ({
      kind: 'brief' as const,
      id: b.id,
      title: b.title,
      words: tokens(`${b.title} ${b.facts}`),
    })),
    ...(
      await db
        .collection('blog_posts')
        .find({ published: true }, { projection: { _id: 0, slug: 1, title: 1 } })
        .toArray()
    ).map((p) => ({
      kind: 'guide' as const,
      id: String(p['slug']),
      title: String(p['title'] ?? p['slug']),
      words: tokens(`${p['title'] ?? ''} ${String(p['slug']).replace(/-/g, ' ')}`),
    })),
  ]

  const existing = new Map(
    (
      await topicSuggestions(db)
        .find({}, { projection: { query: 1, status: 1 } })
        .toArray()
    ).map((s) => [s.query, s.status]),
  )
  const candidates = [...agg]
    .filter(([, a]) => a.impressions >= SUGGEST_MIN_IMPRESSIONS)
    .sort((x, y) => y[1].impressions - x[1].impressions)
  let made = 0
  for (const [query, a] of candidates) {
    run.considered++
    if (made >= MAX_SUGGESTIONS_PER_RUN) break
    if (looksLikeAdviceRequest(query)) {
      run.skipped_advice_like++
      continue
    }
    if (existing.has(query)) continue // already suggested, dismissed or used: do not nag
    const q = tokens(query)
    let best: { kind: 'brief' | 'guide'; id: string; title: string; overlap: number } | null = null
    for (const c of covers) {
      const o = overlap(q, c.words)
      if (!best || o > best.overlap) best = { kind: c.kind, id: c.id, title: c.title, overlap: o }
    }
    if (best && best.overlap >= COVERED_OVERLAP) {
      run.covered++
      continue
    }
    await topicSuggestions(db).insertOne({
      id: randomUUID(),
      query,
      impressions: a.impressions,
      clicks: a.clicks,
      position: a.impressions > 0 ? Math.round((a.posImpr / a.impressions) * 10) / 10 : 0,
      nearest: best && best.overlap >= NEAREST_MIN_OVERLAP ? best : null,
      status: 'suggested',
      created_at: now,
      updated_at: now,
    })
    made++
    run.suggested++
  }
  return run
}

export async function listSuggestions(db: Db, status: SuggestionStatus = 'suggested') {
  return topicSuggestions(db)
    .find({ status }, { projection: { _id: 0 } })
    .sort({ impressions: -1 })
    .limit(50)
    .toArray()
}

export async function setSuggestionStatus(
  db: Db,
  id: string,
  status: Exclude<SuggestionStatus, 'suggested'>,
  now = new Date(),
): Promise<boolean> {
  const res = await topicSuggestions(db).updateOne({ id }, { $set: { status, updated_at: now } })
  return res.matchedCount === 1
}
