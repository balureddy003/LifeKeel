/**
 * Scheduler that can run jobs either in-process (node-cron, the original behaviour) or from an
 * external tick (Cloud Scheduler calling POST /internal/cron/tick once a minute).
 *
 * Why: the API deploys to Cloud Run with min-instances=0 and request-billed CPU. node-cron only fires
 * while the process is running with CPU, so on a scaled-to-zero or throttled instance the email scan,
 * sweeps and reminders silently do not run. An external tick wakes the instance and keeps the CPU
 * allocated for the length of the request, so jobs run reliably at near-zero idle cost.
 *
 * All cron expressions are evaluated in UTC (Cloud Run containers run in UTC; node-cron used the
 * process timezone, which is UTC there as well).
 */

export type CronMode = 'internal' | 'external'

interface CronFields {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  domStar: boolean
  dowStar: boolean
}

function parseField(field: string, min: number, max: number, name: string): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    if (part === '') throw new Error(`empty ${name} list item in "${field}"`)
    const [rangePart = '', stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad ${name} step in "${part}"`)
    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-')
      lo = Number(a)
      hi = Number(b)
    } else {
      lo = Number(rangePart)
      hi = stepPart === undefined ? lo : max // "5/10" means 5 through max, every 10
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
      throw new Error(`bad ${name} value "${part}" (allowed ${min}-${max})`)
    }
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/** Parse a standard 5-field cron expression (numbers, *, ranges, lists, steps). Throws if invalid. */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron expression needs 5 fields, got ${parts.length}: "${expr}"`)
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string]
  const dowSet = parseField(dow, 0, 7, 'day-of-week')
  if (dowSet.has(7)) { dowSet.delete(7); dowSet.add(0) } // 7 is Sunday too
  return {
    minute: parseField(m, 0, 59, 'minute'),
    hour: parseField(h, 0, 23, 'hour'),
    dom: parseField(dom, 1, 31, 'day-of-month'),
    month: parseField(mon, 1, 12, 'month'),
    dow: dowSet,
    domStar: dom.startsWith('*'),
    dowStar: dow.startsWith('*'),
  }
}

/** True if the expression fires at this exact minute (UTC). Standard cron day semantics: if both
 * day-of-month and day-of-week are restricted, either matching is enough. */
export function cronMatches(expr: string | CronFields, at: Date): boolean {
  const f = typeof expr === 'string' ? parseCron(expr) : expr
  if (!f.minute.has(at.getUTCMinutes()) || !f.hour.has(at.getUTCHours()) || !f.month.has(at.getUTCMonth() + 1)) return false
  const domOk = f.dom.has(at.getUTCDate())
  const dowOk = f.dow.has(at.getUTCDay())
  if (f.domStar && f.dowStar) return true
  if (f.domStar) return dowOk
  if (f.dowStar) return domOk
  return domOk || dowOk
}

export interface JobOutcome {
  id: string
  expr: string
  status: 'ok' | 'failed' | 'skipped_running'
  durationMs: number
  error?: string
}

export interface TickResult {
  at: string
  windowMinutes: number
  due: number
  ok: number
  failed: number
  skipped: number
  jobs: JobOutcome[]
}

type ScheduleImpl = (expr: string, fn: () => void | Promise<void>, opts?: unknown) => unknown

interface RegisteredJob {
  id: string
  expr: string
  fields: CronFields
  run: () => void | Promise<void>
}

const MINUTE_MS = 60_000

export function floorToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS)
}

export function createCronScheduler(mode: CronMode, impl: ScheduleImpl) {
  const jobs: RegisteredJob[] = []
  const running = new Set<string>()

  return {
    mode,

    /** Same signature as cron.schedule(expr, fn, opts). In 'internal' mode it also schedules with
     * node-cron; in 'external' mode it only registers, and a tick runs it. */
    schedule(expr: string, fn: () => void | Promise<void>, opts?: unknown): void {
      const fields = parseCron(expr) // fail at startup on a bad expression, in either mode
      jobs.push({ id: `job-${jobs.length + 1}`, expr, fields, run: fn })
      if (mode === 'internal') impl(expr, fn, opts)
    },

    count(): number {
      return jobs.length
    },

    /** Jobs whose expression matches at least one minute in (since, at], each listed once. With no
     * `since`, just the minute `at`. */
    due(at: Date, since?: Date): RegisteredJob[] {
      const end = floorToMinute(at).getTime()
      const start = since ? floorToMinute(since).getTime() + MINUTE_MS : end
      const hit = new Set<RegisteredJob>()
      for (let t = start; t <= end; t += MINUTE_MS) {
        const m = new Date(t)
        for (const j of jobs) if (cronMatches(j.fields, m)) hit.add(j)
      }
      return jobs.filter((j) => hit.has(j))
    },

    /** Run every due job once. A job still running from an earlier tick on this instance is skipped
     * (the equivalent of node-cron's noOverlap); one job failing never stops the others. */
    async runDue(at: Date, since?: Date): Promise<TickResult> {
      const end = floorToMinute(at)
      const windowMinutes = since ? Math.max(1, Math.round((end.getTime() - floorToMinute(since).getTime()) / MINUTE_MS)) : 1
      const due = this.due(at, since)
      const outcomes = await Promise.all(
        due.map(async (j): Promise<JobOutcome> => {
          if (running.has(j.id)) return { id: j.id, expr: j.expr, status: 'skipped_running', durationMs: 0 }
          running.add(j.id)
          const t0 = Date.now()
          try {
            await j.run()
            return { id: j.id, expr: j.expr, status: 'ok', durationMs: Date.now() - t0 }
          } catch (err) {
            return { id: j.id, expr: j.expr, status: 'failed', durationMs: Date.now() - t0, error: err instanceof Error ? err.message : String(err) }
          } finally {
            running.delete(j.id)
          }
        }),
      )
      return {
        at: end.toISOString(),
        windowMinutes,
        due: due.length,
        ok: outcomes.filter((o) => o.status === 'ok').length,
        failed: outcomes.filter((o) => o.status === 'failed').length,
        skipped: outcomes.filter((o) => o.status === 'skipped_running').length,
        jobs: outcomes,
      }
    },
  }
}

export type CronScheduler = ReturnType<typeof createCronScheduler>
