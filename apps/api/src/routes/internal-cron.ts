/**
 * POST /internal/cron/tick — the external scheduler's entry point (PRD-139 Phase 0).
 *
 * Cloud Scheduler calls this once a minute. The request wakes a scaled-to-zero Cloud Run instance and
 * keeps CPU allocated until it returns, so scheduled jobs run reliably without paying for an
 * always-on instance. Enabled only when CRON_MODE=external; in the default 'internal' mode the jobs
 * run under node-cron and this route answers 409 so the two can never double-run.
 *
 * Auth: a shared secret in the x-cron-secret header (CRON_TICK_SECRET, from Secret Manager). The
 * route is outside the JWT hook (it has no user); it fails closed if the secret is not configured.
 *
 * Catch-up: the last handled minute is kept in Mongo (cron_state). A tick runs every job that was
 * due in any minute since the last one, once each, up to MAX_CATCHUP_MINUTES back — so a late or
 * missed tick does not skip a job — and a duplicate delivery for the same minute runs nothing.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { timingSafeEqual } from 'node:crypto'
import { createLogger } from '@lifekeel/platform'
import { floorToMinute, type CronScheduler } from '../jobs/cron-schedule.js'
import { recordCronTick } from './metrics.js'

const log = createLogger({ service: 'cron-tick', version: '0.0.0' })

export const MAX_CATCHUP_MINUTES = 15

/** Constant-time comparison that does not leak the secret's length through an early return. */
export function secretsMatch(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  const padded = Buffer.alloc(Math.max(a.length, b.length))
  const paddedB = Buffer.alloc(padded.length)
  a.copy(padded)
  b.copy(paddedB)
  return timingSafeEqual(padded, paddedB) && a.length === b.length
}

/**
 * Atomically advance the stored last-tick time to `at` and return the previous one as the start of
 * this tick's catch-up window (capped). Two ticks racing for the same minute: the second sees
 * previous == at, gets an empty window, and runs nothing.
 */
export async function claimTickWindow(db: Db, at: Date, maxCatchupMinutes = MAX_CATCHUP_MINUTES): Promise<Date | undefined> {
  // A unique index makes the first-ever concurrent upserts safe (one creates the document, the rest
  // see it); createIndex is idempotent, so calling it per tick costs one cheap no-op round trip.
  await db.collection('cron_state').createIndex({ name: 1 }, { unique: true })
  const claim = () => db.collection('cron_state').findOneAndUpdate(
    { name: 'tick' },
    { $max: { last_tick_at: at } },
    { upsert: true, returnDocument: 'before' },
  )
  let prev: { last_tick_at?: Date } | null
  try {
    prev = (await claim()) as { last_tick_at?: Date } | null
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err
    prev = (await claim()) as { last_tick_at?: Date } | null // lost the creation race: the document exists now
  }
  const last = prev?.last_tick_at
  if (!last) return undefined // first ever tick: just this minute
  const earliest = new Date(at.getTime() - maxCatchupMinutes * 60_000)
  return last.getTime() < earliest.getTime() ? earliest : last
}

export function registerInternalCronRoutes(app: FastifyInstance, db: Db, scheduler: CronScheduler, now: () => Date = () => new Date()): void {
  app.post('/internal/cron/tick', { schema: { hide: true } }, async (request, reply) => {
    const secret = process.env['CRON_TICK_SECRET']
    if (!secret) return reply.status(503).send({ error: 'cron tick is not configured' })
    if (scheduler.mode !== 'external') {
      return reply.status(409).send({ error: 'CRON_MODE is internal: jobs run in-process, tick is disabled' })
    }
    const header = request.headers['x-cron-secret']
    if (!secretsMatch(Array.isArray(header) ? header[0] : header, secret)) {
      return reply.status(401).send({ error: 'unauthorized' })
    }

    const at = floorToMinute(now())
    const since = await claimTickWindow(db, at)
    const result = await scheduler.runDue(at, since)
    recordCronTick(at.getTime() / 1000, result)
    if (result.failed > 0) {
      log.error({ failed: result.jobs.filter((j) => j.status === 'failed') }, 'Cron tick: some jobs failed')
    } else {
      log.info({ at: result.at, due: result.due, ok: result.ok, skipped: result.skipped }, 'Cron tick')
    }
    return reply.send(result)
  })
}
