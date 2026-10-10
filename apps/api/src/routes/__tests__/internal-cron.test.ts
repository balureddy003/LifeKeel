/**
 * POST /internal/cron/tick — auth, mode gating, duplicate delivery, catch-up and its cap.
 * Real Mongo (memory server) for the cron_state claim; the scheduler is real, with fake jobs.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import Fastify from 'fastify'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient, type Db } from 'mongodb'
import { createCronScheduler } from '../../jobs/cron-schedule.js'
import { registerInternalCronRoutes, secretsMatch, claimTickWindow, MAX_CATCHUP_MINUTES } from '../internal-cron.js'
import { renderMetrics } from '../metrics.js'

const SECRET = 'tick-secret-for-tests-0123456789'
let mongod: MongoMemoryServer
let client: MongoClient
let db: Db
let savedSecret: string | undefined

beforeEach(async () => {
  mongod = await MongoMemoryServer.create()
  client = await MongoClient.connect(mongod.getUri())
  db = client.db('cron_tick_test')
  savedSecret = process.env['CRON_TICK_SECRET']
  process.env['CRON_TICK_SECRET'] = SECRET
})

afterEach(async () => {
  if (savedSecret === undefined) delete process.env['CRON_TICK_SECRET']
  else process.env['CRON_TICK_SECRET'] = savedSecret
  await client.close()
  await mongod.stop()
})

function build(mode: 'internal' | 'external', nowIso: string) {
  const scheduler = createCronScheduler(mode, vi.fn())
  const app = Fastify()
  registerInternalCronRoutes(app, db, scheduler, () => new Date(nowIso))
  return { app, scheduler }
}

// `null` = send no secret header at all (undefined would trigger the default and send the valid one).
const tick = (app: ReturnType<typeof Fastify>, secret: string | null = SECRET) =>
  app.inject({ method: 'POST', url: '/internal/cron/tick', headers: secret === null ? {} : { 'x-cron-secret': secret } })

describe('secretsMatch', () => {
  it('accepts only an identical secret', () => {
    expect(secretsMatch(SECRET, SECRET)).toBe(true)
    expect(secretsMatch('wrong', SECRET)).toBe(false)
    expect(secretsMatch(SECRET + 'x', SECRET)).toBe(false) // longer
    expect(secretsMatch(SECRET.slice(0, -1), SECRET)).toBe(false) // shorter
    expect(secretsMatch(undefined, SECRET)).toBe(false)
    expect(secretsMatch('', SECRET)).toBe(false)
    expect(secretsMatch(SECRET, '')).toBe(false)
  })
  it('does not treat a zero-padded shorter secret as equal', () => {
    expect(secretsMatch('abc', 'abc\u0000')).toBe(false)
  })
})

describe('POST /internal/cron/tick', () => {
  it('fails closed (503) when no secret is configured', async () => {
    delete process.env['CRON_TICK_SECRET']
    const { app } = build('external', '2026-10-10T08:30:00Z')
    expect((await tick(app)).statusCode).toBe(503)
  })

  it('answers 409 in internal mode so node-cron and the tick can never double-run jobs', async () => {
    const { app, scheduler } = build('internal', '2026-10-10T08:30:00Z')
    const job = vi.fn()
    scheduler.schedule('* * * * *', job)
    expect((await tick(app)).statusCode).toBe(409)
    expect(job).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong secret (401) without running anything', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:30:00Z')
    const job = vi.fn()
    scheduler.schedule('* * * * *', job)
    expect((await tick(app, null)).statusCode).toBe(401)
    expect((await tick(app, 'nope')).statusCode).toBe(401)
    expect(job).not.toHaveBeenCalled()
  })

  it('runs the due jobs and reports the outcome', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:30:12Z')
    const due = vi.fn(); const notDue = vi.fn()
    scheduler.schedule('30 8 * * *', due)
    scheduler.schedule('0 3 * * *', notDue)
    const res = await tick(app)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ at: '2026-10-10T08:30:00.000Z', due: 1, ok: 1, failed: 0 })
    expect(due).toHaveBeenCalledTimes(1)
    expect(notDue).not.toHaveBeenCalled()
    const state = await db.collection('cron_state').findOne({ name: 'tick' })
    expect(state?.['last_tick_at']).toEqual(new Date('2026-10-10T08:30:00.000Z'))
  })

  it('a duplicate delivery for the same minute runs nothing', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:30:05Z')
    const job = vi.fn()
    scheduler.schedule('* * * * *', job)
    await tick(app)
    const second = await tick(app)
    expect(second.json()).toMatchObject({ due: 0 })
    expect(job).toHaveBeenCalledTimes(1)
  })

  it('concurrent deliveries for the same minute run each job once', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:30:05Z')
    const job = vi.fn()
    scheduler.schedule('* * * * *', job)
    await Promise.all([tick(app), tick(app), tick(app)])
    expect(job).toHaveBeenCalledTimes(1)
  })

  it('catches up a missed window once, including a job due inside it', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:08:20Z')
    await db.collection('cron_state').insertOne({ name: 'tick', last_tick_at: new Date('2026-10-10T08:03:00Z') })
    const inside = vi.fn(); const outside = vi.fn()
    scheduler.schedule('5 8 * * *', inside) // 08:05, inside the missed window
    scheduler.schedule('30 9 * * *', outside)
    const res = await tick(app)
    expect(res.json()).toMatchObject({ windowMinutes: 5, due: 1, ok: 1 })
    expect(inside).toHaveBeenCalledTimes(1)
    expect(outside).not.toHaveBeenCalled()
  })

  it('caps catch-up after a long outage instead of replaying hours of jobs', async () => {
    const now = new Date('2026-10-10T12:00:00Z')
    await db.collection('cron_state').insertOne({ name: 'tick', last_tick_at: new Date('2026-10-10T06:00:00Z') })
    const since = await claimTickWindow(db, now)
    expect(since).toEqual(new Date(now.getTime() - MAX_CATCHUP_MINUTES * 60_000))
  })

  it('the first ever tick runs only the current minute', async () => {
    expect(await claimTickWindow(db, new Date('2026-10-10T08:30:00Z'))).toBeUndefined()
  })

  it('a job that throws does not fail the tick, and is counted as failed', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:30:00Z')
    scheduler.schedule('* * * * *', () => { throw new Error('boom') })
    const ok = vi.fn()
    scheduler.schedule('* * * * *', ok)
    const res = await tick(app)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ due: 2, ok: 1, failed: 1 })
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('publishes the heartbeat metric so a stalled scheduler can be alerted on', async () => {
    const { app, scheduler } = build('external', '2026-10-10T08:30:00Z')
    scheduler.schedule('* * * * *', vi.fn())
    await tick(app)
    const text = await renderMetrics()
    expect(text).toContain('lifekeel_cron_last_tick_timestamp_seconds')
    expect(text).toContain('lifekeel_cron_job_runs_total{status="ok"}')
  })
})
