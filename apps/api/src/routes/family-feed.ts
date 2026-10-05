/**
 * Readiness feed read API (PRD-136 §3).
 *
 *   GET /family/feed?since=&member_id=&domain=&limit=  — adult-only,
 *     newest first, consecutive sweep_quiet runs collapsed server-side
 *     ("Quiet for 4 days"), feedback stripped.
 *   GET /family/feed?mode=youth                        — the redacted slice
 *     a child sees: only milestone/score_moved events for their own
 *     member id, value_minor removed from evidence (same rule as the
 *     PRD-124 youth twin).
 *   GET /family/feed/summary?window=7d|30d             — counts for the
 *     home header ("3 things moved this week") + composite score delta.
 *
 * Tier 0 — pure read over readiness_events written by feed/emit.ts.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { getTenantCollection } from '@lifekeel/platform'
import { isFamilyAdult, memberMatchesUser } from '../lib/family-permissions.js'
import type { ReadinessEventDoc } from '../feed/emit.js'
import { upsertEventMute, deleteEventMutes } from '../feed/mutes.js'
import type { FamilyGroupDoc } from './family-group.js'

const HISTORY_COLLECTION = 'family_readiness_history'
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const YOUTH_TYPES = new Set(['milestone', 'score_moved'])

interface FeedQuery {
  since?: string
  member_id?: string
  domain?: string
  limit?: string
  mode?: string
  include_muted?: string
}

const FeedbackBody = z.object({
  value: z.enum(['useful', 'not_relevant', 'handled', 'remind_later', 'data_wrong']),
})

const REMIND_LATER_MS = 7 * 86_400_000
const MUTE_MS = 90 * 86_400_000

function toView(doc: ReadinessEventDoc): Record<string, unknown> {
  // feedback entries are write-side bookkeeping — never read back out of
  // the feed payload. muted/muted_reason stay: the client's "Muted ·
  // undo?" affordance needs them.
  const { feedback: _feedback, ...view } = doc
  return view
}

/** Default read-side filter: muted events and not-yet-due snoozes hide. */
function isVisible(evt: ReadinessEventDoc, now: number): boolean {
  if (evt.muted === true) return false
  if (evt.snoozed_until && new Date(evt.snoozed_until).getTime() > now) return false
  return true
}

/**
 * Collapse consecutive sweep_quiet events into one synthetic "Quiet for
 * N days" item. Runs are per-day, so a run of N collapsed events means N
 * quiet days. (No emitter writes sweep_quiet yet — this exists so the
 * first quiet emitter needs no read-path change.)
 */
function collapseSweepQuiet(events: Record<string, unknown>[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let quietRun = 0
  let quietNewest: Record<string, unknown> | null = null
  const flush = () => {
    if (quietRun === 0) return
    if (quietRun === 1 && quietNewest) {
      out.push(quietNewest)
    } else if (quietNewest) {
      out.push({
        ...quietNewest,
        title: `Quiet for ${quietRun} days`,
        summary: `The daily sweep ran ${quietRun} times with nothing new to report.`,
        quiet_days: quietRun,
      })
    }
    quietRun = 0
    quietNewest = null
  }
  for (const evt of events) {
    if (evt['type'] === 'sweep_quiet') {
      quietRun++
      quietNewest ??= evt
      continue
    }
    flush()
    out.push(evt)
  }
  flush()
  return out
}

export function registerFamilyFeedRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: FeedQuery }>('/family/feed', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const mode = req.query.mode === 'youth' ? 'youth' : undefined

    if (mode === 'youth') {
      // Child-mode slice: resolve the caller's roster member the same way
      // member-twin does (member.id or member.user_id vs auth user_id),
      // then only their own milestone/score_moved events, money stripped.
      const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id })
      const member = family?.members.find((m) => memberMatchesUser(m, user_id))
      if (!member) return { events: [] }
      const docs = (await getTenantCollection<ReadinessEventDoc>(db, 'readiness_events', tenant_id)
        .find({ member_id: member.id })
        .toArray()) as ReadinessEventDoc[]
      const events = docs
        .filter((d) => YOUTH_TYPES.has(d.type))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((d) => ({
          ...toView(d),
          evidence: (d.evidence ?? []).map(({ value_minor: _v, ...e }) => e),
        }))
      return { events }
    }

    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'The readiness feed is visible to adult family members only.' })
    }

    const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit ?? '', 10) || DEFAULT_LIMIT, MAX_LIMIT))
    const filter: Record<string, unknown> = {}
    if (req.query.member_id) filter['member_id'] = req.query.member_id
    if (req.query.domain) filter['domain'] = req.query.domain
    const sinceMs = req.query.since ? Date.parse(req.query.since) : Number.NaN
    if (!Number.isNaN(sinceMs)) filter['created_at'] = { $gte: new Date(sinceMs) }

    const includeMuted = req.query.include_muted === '1' || req.query.include_muted === 'true'
    const now = Date.now()
    const docs = (await getTenantCollection<ReadinessEventDoc>(db, 'readiness_events', tenant_id)
      .find(filter)
      .toArray()) as ReadinessEventDoc[]
    const events = collapseSweepQuiet(
      docs
        .filter((d) => includeMuted || isVisible(d, now))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, limit)
        .map(toView),
    )
    return { events }
  })

  // PRD-136 §3: per-user feedback. 'not_relevant' writes a 90-day
  // feed_mutes row the emitter honours; 'useful' is also the undo — it
  // clears any mute this event created. 'remind_later' snoozes the event
  // for 7 days; 'handled' stamps it; 'data_wrong' records the signal and
  // lets the client deep-link to the profile field.
  app.post<{ Params: { id: string } }>('/family/feed/:id/feedback', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'The readiness feed is visible to adult family members only.' })
    }
    const parsed = FeedbackBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid feedback value' })

    const events = getTenantCollection<ReadinessEventDoc>(db, 'readiness_events', tenant_id)
    const event = await events.findOne({ id: req.params.id })
    if (!event) return reply.status(404).send({ error: 'Feed event not found' })

    const value = parsed.data.value
    const now = new Date()
    const feedback = (event.feedback ?? []).filter((f) => f.user_id !== user_id)
    feedback.push({ user_id, value, at: now })

    const set: Record<string, unknown> = { feedback }
    const unset: Record<string, unknown> = {}
    let muted_until: string | undefined
    if (value === 'not_relevant') {
      const until = new Date(now.getTime() + MUTE_MS)
      await upsertEventMute(db, tenant_id, user_id, event, until)
      set['muted'] = true
      set['muted_reason'] = `You marked this not relevant on ${now.toISOString().slice(0, 10)}.`
      muted_until = until.toISOString()
    }
    if (value === 'useful') {
      await deleteEventMutes(db, tenant_id, event)
      unset['muted'] = ''
      unset['muted_reason'] = ''
    }
    if (value === 'remind_later') set['snoozed_until'] = new Date(now.getTime() + REMIND_LATER_MS)
    if (value === 'handled') set['handled_at'] = now

    const update: Record<string, unknown> = { $set: set }
    if (Object.keys(unset).length > 0) update['$unset'] = unset
    await events.updateOne({ id: event.id }, update)

    return { ok: true, ...(muted_until ? { muted_until } : {}) }
  })

  app.get<{ Querystring: { window?: string } }>('/family/feed/summary', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'The readiness feed is visible to adult family members only.' })
    }
    const days = req.query.window === '30d' ? 30 : 7
    const since = new Date(Date.now() - days * 86_400_000)

    const docs = (await getTenantCollection<ReadinessEventDoc>(db, 'readiness_events', tenant_id)
      .find({ created_at: { $gte: since } })
      .toArray()) as ReadinessEventDoc[]
    // Muted/snoozed events are the family's explicit "don't show me
    // this" — the summary counts what they actually see.
    const visible = docs.filter((d) => isVisible(d, Date.now()))

    const byType: Record<string, number> = {}
    let up = 0
    let down = 0
    for (const d of visible) {
      byType[d.type] = (byType[d.type] ?? 0) + 1
      if (d.direction === 'up') up++
      else if (d.direction === 'down') down++
    }

    // Composite delta: last minus first score snapshot inside the window.
    const history = (await db
      .collection(HISTORY_COLLECTION)
      .find({ tenant_id, date: { $gte: since.toISOString().slice(0, 10) } }, { projection: { _id: 0, date: 1, score: 1 } })
      .toArray()) as unknown as { date: string; score: number }[]
    const ordered = history
      .filter((h) => typeof h.score === 'number')
      .sort((a, b) => a.date.localeCompare(b.date))
    const compositeDelta =
      ordered.length >= 2 ? ordered[ordered.length - 1]!.score - ordered[0]!.score : null

    return { window: `${days}d`, total: visible.length, by_type: byType, up, down, composite_delta: compositeDelta }
  })
}
