/**
 * Staging-only test controls. Two things an automated tester cannot reach by
 * waiting: the 14-day join expiry, and the monthly digest.
 *
 *  - age-join-request: moves a pending request back N days, so the normal
 *    expiry code (which compares against the real clock) can be exercised.
 *  - run-digest: runs the digest job once with a chosen "now".
 *
 * They add no new behaviour to the product. They only set up time. Like the
 * mail sink they cannot start outside staging, need the test token, refuse a
 * production host, and need the mail sink on, so a digest run can never send
 * real mail. The age control touches only obviously fictional addresses.
 */

import { timingSafeEqual, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@lifekeel/platform'
import { resolveStagingSink } from './mail-sink.js'
import { runFamilyHeartbeat } from '../jobs/family-heartbeat.js'
import { recordJobRun } from '../jobs/job-runs.js'
import { SWEEP_JOB } from '../jobs/stale-profile-evaluation.js'

const log = createLogger({ service: 'staging-controls', version: '0.0.0' })
const DAY = 86_400_000
const FICTIONAL = /@example\.(test|com)$/i

/** Null when off. Throws when asked for somewhere it must not run. */
export function resolveStagingControls(
  env: NodeJS.ProcessEnv = process.env,
): { token: string } | null {
  if (env['STAGING_TEST_CONTROLS']?.trim() !== 'on') return null
  if (env['STAGING_MAIL_SINK']?.trim() !== 'on') {
    throw new Error('STAGING_TEST_CONTROLS needs the staging mail sink on, so no real mail is sent')
  }
  const sink = resolveStagingSink(env)
  if (!sink) throw new Error('STAGING_TEST_CONTROLS needs the staging mail sink on')
  return sink
}

const digest = (s: string) => createHash('sha256').update(s).digest()

export function registerStagingControlRoutes(
  app: FastifyInstance,
  getDatabase: () => Promise<Db>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = resolveStagingControls(env)
  if (!cfg) return false
  const allowed = (headers: Record<string, unknown>) =>
    timingSafeEqual(digest(String(headers['x-staging-token'] ?? '')), digest(cfg.token))

  app.post<{ Body: { email?: unknown; days?: unknown } }>(
    '/staging/control/age-join-request',
    async (req, reply) => {
      if (!allowed(req.headers)) return reply.code(401).send({ error: 'Invalid token' })
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const days = req.body?.days
      if (!FICTIONAL.test(email))
        return reply.code(400).send({ error: 'Only example.test or example.com addresses' })
      if (typeof days !== 'number' || !Number.isFinite(days) || days < 1 || days > 60)
        return reply.code(400).send({ error: 'days must be a number from 1 to 60' })
      const res = await (
        await getDatabase()
      )
        .collection('family_join_requests')
        .updateMany(
          { email, status: 'pending' },
          { $set: { requested_at: new Date(Date.now() - days * DAY) } },
        )
      log.warn({ matched: res.matchedCount, days }, 'STAGING control: aged a join request')
      return { matched: res.matchedCount }
    },
  )

  app.post<{ Body: { cadence?: unknown; now?: unknown; fresh_sweep?: unknown } }>(
    '/staging/control/run-digest',
    async (req, reply) => {
      if (!allowed(req.headers)) return reply.code(401).send({ error: 'Invalid token' })
      const cadence = req.body?.cadence
      if (cadence !== 'weekly' && cadence !== 'monthly')
        return reply.code(400).send({ error: 'cadence must be weekly or monthly' })
      const now = req.body?.now === undefined ? new Date() : new Date(String(req.body.now))
      if (Number.isNaN(now.getTime()) || now.getUTCFullYear() < 2020 || now.getUTCFullYear() > 2100)
        return reply.code(400).send({ error: 'now must be an ISO date between 2020 and 2100' })
      const db = await getDatabase()
      // The monthly digest refuses to claim "we checked" without a recent sweep.
      // Recording one at the chosen date lets a tester reach the send path;
      // pass fresh_sweep:false to prove it holds back without one.
      if (req.body?.fresh_sweep !== false) await recordJobRun(db, SWEEP_JOB, {}, now)
      const result = await runFamilyHeartbeat(db, { cadence, now })
      log.warn({ cadence, now: now.toISOString(), ...result }, 'STAGING control: ran digest')
      return { cadence, now: now.toISOString(), result }
    },
  )
  return true
}
