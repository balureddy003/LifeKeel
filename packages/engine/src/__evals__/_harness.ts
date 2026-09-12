/**
 * Shared eval harness utilities.
 *
 * These evals benchmark the engine's ACTUAL shipped algorithms (no
 * reimplementation) against public industry datasets:
 *   - Calibration   (calibration.ts ScoreCalibrator)      → ECE / Brier
 *   - Conformal gate (cascade.ts computeConformalThreshold) → wrong-skip bound
 *   - Adaptive thresholds (adaptive-thresholds.ts)         → anomaly P/R/F1
 *
 * Datasets live outside the repo at EVAL_ROOT so we never commit third-party
 * data. Results are written to EVAL_ROOT/out for the report.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

export const EVAL_ROOT = process.env.KAIROS_EVAL_ROOT ?? '/home/ubuntu/kairos-eval'

/** Datasets live outside the repo; evals self-skip in CI where they are absent. */
export function hasData(rel: string): boolean {
  return existsSync(`${EVAL_ROOT}/${rel}`)
}

// ── Minimal in-memory Mongo (exercises the real persistence code paths) ──────
//
// Implements just the surface the engine modules touch: createIndex, replaceOne
// (upsert), findOne, find().sort().toArray(), distinct, aggregate().toArray().

type Doc = Record<string, unknown>

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, v]) => doc[k] === v)
}

class FakeCollection {
  docs: Doc[] = []
  async createIndex(): Promise<string> { return 'idx' }
  async replaceOne(filter: Doc, doc: Doc, opts?: { upsert?: boolean }): Promise<unknown> {
    const i = this.docs.findIndex(d => matches(d, filter))
    if (i >= 0) this.docs[i] = { ...doc }
    else if (opts?.upsert) this.docs.push({ ...doc })
    return { acknowledged: true }
  }
  async findOne(filter: Doc): Promise<Doc | null> {
    return this.docs.find(d => matches(d, filter)) ?? null
  }
  find(filter: Doc = {}) {
    let rows = this.docs.filter(d => matches(d, filter))
    const api = {
      sort: (_s: Doc) => api,
      limit: (_n: number) => api,
      toArray: async () => rows.map(r => ({ ...r })),
    }
    void rows
    return api
  }
  async distinct(field: string): Promise<unknown[]> {
    return [...new Set(this.docs.map(d => d[field]))]
  }

  /**
   * Faithful executor for the single aggregation pipeline used by
   * AdaptiveThresholdStore.recompute: a $match (equality + numeric/date guards)
   * followed by a $group computing $avg, $stdDevPop, $sum:1 and $push of one
   * numeric field. Population std matches Mongo's $stdDevPop.
   */
  aggregate(pipeline: Array<Record<string, unknown>>) {
    const matchStage = (pipeline.find(s => '$match' in s)?.['$match'] ?? {}) as Record<string, unknown>
    const groupStage = (pipeline.find(s => '$group' in s)?.['$group'] ?? {}) as Record<string, unknown>

    const rows = this.docs.filter(doc => {
      for (const [k, cond] of Object.entries(matchStage)) {
        if (cond && typeof cond === 'object') {
          const c = cond as Record<string, unknown>
          const val = doc[k]
          if ('$exists' in c && (val === undefined) === Boolean(c['$exists'])) return false
          if ('$type' in c && c['$type'] === 'number' && typeof val !== 'number') return false
          if ('$gt' in c && !(typeof val === 'number' && val > (c['$gt'] as number))) return false
          if ('$gte' in c) {
            const lo = c['$gte'] as number | Date
            const v = val as number | Date
            if (!(v >= lo)) return false
          }
        } else if (doc[k] !== cond) {
          return false
        }
      }
      return true
    })

    // Resolve the pushed/aggregated field path (e.g. "$value").
    const fieldRef = Object.values(groupStage).find(
      v => v && typeof v === 'object' && '$avg' in (v as object),
    ) as { $avg: string } | undefined
    const field = (fieldRef?.$avg ?? '$value').slice(1)
    const values = rows.map(r => Number(r[field])).filter(v => Number.isFinite(v))
    const count = values.length
    const mean = count ? values.reduce((a, b) => a + b, 0) / count : 0
    const variance = count ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / count : 0
    const std = Math.sqrt(variance)

    const out = count === 0 ? [] : [{ _id: null, mean, std, count, values }]
    return { toArray: async () => out }
  }
}

export class FakeMongo {
  private cols = new Map<string, FakeCollection>()
  collection(name: string): FakeCollection {
    let c = this.cols.get(name)
    if (!c) { c = new FakeCollection(); this.cols.set(name, c) }
    return c
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

export function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const header = lines[0]!.split(',')
  return lines.slice(1).map(line => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}

// ── Calibration metrics (independent of engine internals, matches python) ────

/** Expected Calibration Error, 10 equal-width bins — matches the python ref. */
export function ece(probs: number[], outcomes: number[], nBins = 10): number {
  let e = 0
  for (let b = 0; b < nBins; b++) {
    const lo = b / nBins, hi = (b + 1) / nBins
    const idx = probs
      .map((p, i) => ({ p, y: outcomes[i]! }))
      .filter(({ p }) => (b === nBins - 1 ? p >= lo && p <= hi : p >= lo && p < hi))
    if (idx.length === 0) continue
    const mc = idx.reduce((s, x) => s + x.p, 0) / idx.length
    const ma = idx.reduce((s, x) => s + x.y, 0) / idx.length
    e += (idx.length / probs.length) * Math.abs(mc - ma)
  }
  return e
}

export function brier(probs: number[], outcomes: number[]): number {
  return probs.reduce((s, p, i) => s + (p - outcomes[i]!) ** 2, 0) / probs.length
}

export function writeOut(name: string, data: unknown): void {
  const path = `${EVAL_ROOT}/out/${name}`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2))
}

export function round(x: number, d = 4): number {
  const f = 10 ** d
  return Math.round(x * f) / f
}
