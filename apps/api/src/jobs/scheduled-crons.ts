/**
 * Scheduled-job registry (intent 92).
 *
 * Every cron that used to live only inside a `cron.schedule(...)` timer in
 * server.ts registers here at boot, in every SERVICE_ROLE. Cloud Scheduler
 * fires `POST /internal/cron/<name>` on the API service; the API scales to
 * zero between fires, so no always-on jobs service is needed.
 *
 * Concurrency safety is unchanged: each registered function keeps whatever
 * locking it already had (withCronLock / acquireCronLock) — the lock names
 * are the same ones the timers used, so a Scheduler retry or an overlapping
 * inline timer still can't double-fire a job.
 */

import { timingSafeEqual } from 'node:crypto'

export type ScheduledJob = () => Promise<unknown>

const registry = new Map<string, ScheduledJob>()

export function registerScheduledJob(name: string, fn: ScheduledJob): void {
  if (registry.has(name)) {
    throw new Error(`Duplicate scheduled job registration: ${name}`)
  }
  registry.set(name, fn)
}

export function getScheduledJob(name: string): ScheduledJob | undefined {
  return registry.get(name)
}

export function listScheduledJobs(): string[] {
  return [...registry.keys()].sort()
}

/**
 * Bearer check for POST /internal/cron/<name>. Unlike the metrics scrape
 * token, an unset CRON_TRIGGER_TOKEN means *closed* — the route 404s before
 * this is even consulted, and this returns false as a second layer.
 */
export function cronTriggerAuthorized(
  authorization: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false
  if (!authorization?.startsWith('Bearer ')) return false
  const given = Buffer.from(authorization.slice(7).trim())
  const want = Buffer.from(expected)
  return given.length === want.length && timingSafeEqual(given, want)
}
