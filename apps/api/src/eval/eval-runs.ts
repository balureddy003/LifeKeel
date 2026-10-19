/**
 * Unified eval-run registry (Stage B13).
 *
 * One collection — `eval_runs` — records every evaluation the platform
 * runs, whatever the subject: detector goldens, task-gateway checks,
 * red-team suites, model comparisons. ARCHITECTURE.md's lineage record:
 *
 *   task version + prompt hash + context-builder version + model artifact
 *   + dataset hash + guard version + code/image SHA + metrics + approver
 *
 * `verdict` is the machine-readable outcome; `approver` stays human — a
 * run record never promotes anything by itself.
 */
import { randomUUID, createHash } from 'node:crypto'
import type { Db } from 'mongodb'

export type EvalRunKind = 'detector' | 'task' | 'red-team' | 'model' | 'encoder' | 'judge'

export interface EvalRun {
  id: string
  kind: EvalRunKind
  /** detector id, task id, or suite name */
  subject: string
  dataset: { id: string; hash: string; cases: number }
  /** sha256 of the prompt/system template, when the subject has one */
  prompt_hash?: string
  /** model artifact identifier (provider model id, local model tag) */
  model?: string
  /** version stamp for the guard/policy layer under test */
  guard_version?: string
  /** code SHA the run executed against — GITHUB_SHA in CI */
  code_sha?: string
  metrics: Record<string, number>
  verdict: 'pass' | 'fail'
  failures?: string[]
  /** human who triggered/approved the run, when applicable */
  approver?: string
  /** known-gap case ids documented by the fixture (red-team runs) */
  known_gaps?: string[]
  created_at: Date
}

export function evalRunsCol(db: Db) {
  return db.collection<EvalRun>('eval_runs')
}

export function ensureEvalRunIndexes(db: Db): void {
  evalRunsCol(db)
    .createIndex({ kind: 1, subject: 1, created_at: -1 })
    .catch(() => {})
  evalRunsCol(db)
    .createIndex({ 'dataset.hash': 1 })
    .catch(() => {})
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function codeSha(): string | undefined {
  return process.env['GITHUB_SHA'] ?? process.env['GIT_SHA'] ?? undefined
}

export async function recordEvalRun(
  db: Db,
  run: Omit<EvalRun, 'id' | 'created_at'> & { id?: string },
): Promise<EvalRun> {
  ensureEvalRunIndexes(db)
  const doc: EvalRun = { id: run.id ?? randomUUID(), created_at: new Date(), ...run }
  await evalRunsCol(db).insertOne(doc)
  return doc
}
