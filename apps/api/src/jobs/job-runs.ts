/**
 * Run records for scheduled jobs (PRD-138). The Quiet Care digest only claims
 * "we checked" when a record says the sweep actually ran, and the heartbeat's
 * scheduled-versus-delivered counts live here too. Writes and reads never
 * throw: bookkeeping must not change a job's outcome, and a missing record
 * simply reads as "no evidence the job ran".
 */
import type { Db } from 'mongodb'

export interface JobRun {
  job: string
  ran_at: Date
  [counter: string]: unknown
}

const COLLECTION = 'job_runs'

export async function recordJobRun(
  db: Db,
  job: string,
  counters: Record<string, number> = {},
  now: Date = new Date(),
): Promise<void> {
  try {
    await db.collection(COLLECTION).insertOne({ job, ran_at: now, ...counters })
  } catch {
    // bookkeeping only
  }
}

export async function lastJobRun(db: Db, job: string): Promise<JobRun | null> {
  try {
    const cursor = db.collection(COLLECTION).find({ job })
    const rows = (typeof cursor.sort === 'function'
      ? await cursor.sort({ ran_at: -1 }).limit(1).toArray()
      : await cursor.toArray()) as unknown as JobRun[]
    const latest = [...rows].sort((a, b) => b.ran_at.getTime() - a.ran_at.getTime())[0]
    return latest ?? null
  } catch {
    return null
  }
}
