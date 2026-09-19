/**
 * POST /detectors/:id/eval — the promotion gate for detector changes.
 *
 * Runs the detector's golden dataset (detector-evals/<id>.yaml) through
 * DetectorEvalRunner against the real Engine, compares to the stored
 * 'promotion' baseline, and reports whether the detector is promotable.
 *
 * Gate contract (detector-evals/README.md):
 *   - F1 < 0.80           → blocked
 *   - f1_delta < -0.05    → blocked (regression vs. baseline)
 * The first run for a detector has no baseline; compareToBaseline saves
 * that run as the baseline, so regression can only ever be measured
 * against a previously-accepted state.
 *
 * This route is read-only with respect to production config — it never
 * edits detector YAML or flips a promotion flag. The answer is a verdict
 * a human acts on; promotion itself stays a deliberate code change +
 * human merge (CLAUDE.md's ship flow), not an API side effect.
 *
 * Authorization: '/detectors/*' maps to the 'detectors' resource; POST is
 * 'create' (admin+ per packages/platform abilities.ts).
 */
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { DetectorEvalRunner, type Engine } from '@agentoak/engine'
import { getAuditLogger } from '../audit/audit-log.js'

const MIN_F1 = 0.8
const BASELINE_ID = 'promotion'

export function registerDetectorEvalRoutes(
  app: FastifyInstance,
  db: Db,
  engine: Engine,
  evalCasesDir: string,
): void {
  const runner = new DetectorEvalRunner(engine, evalCasesDir)

  app.post<{ Params: { id: string } }>('/detectors/:id/eval', async (request, reply) => {
    const { id } = request.params
    const { tenant_id, user_id } = request.authContext

    // inventory() doesn't lazy-load — production loads at boot, but a
    // zero-count inventory here means "not loaded yet", not "unknown id".
    if (engine.detectorCount === 0) await engine.load()

    // Only detectors the engine actually loaded are evaluable — a typo'd
    // id must 404, not silently produce an empty (perfect-score) report.
    const known = engine.inventory().some((d) => d.id === id)
    if (!known) {
      return reply.status(404).send({ error: `Unknown detector: ${id}` })
    }

    const report = await runner.run(id)
    if (report.total_cases === 0) {
      return reply.status(422).send({
        error: `No golden dataset for ${id} — add detector-evals/${id}.yaml before this detector can be promoted`,
        detector_id: id,
      })
    }

    const drift = await runner.compareToBaseline(db, id, BASELINE_ID)
    const reasons: string[] = []
    if (report.f1 < MIN_F1) reasons.push(`f1 ${report.f1} below ${MIN_F1} floor`)
    if (drift.has_regression) reasons.push(`f1 regressed ${drift.f1_delta} vs baseline (>5% drop)`)
    const promotable = reasons.length === 0

    getAuditLogger()?.log({
      tenant_id,
      user_id,
      action: 'detector.eval',
      resource_type: 'detector',
      resource_id: id,
      metadata: { f1: report.f1, precision: report.precision, recall: report.recall, f1_delta: drift.f1_delta, promotable },
      ip: request.ip,
      user_agent: request.headers['user-agent'] ?? '',
      timestamp: new Date(),
    })

    return {
      detector_id: id,
      promotable,
      blocked_reasons: reasons,
      eval: {
        total_cases: report.total_cases,
        passed: report.passed,
        failed: report.failed,
        precision: report.precision,
        recall: report.recall,
        f1: report.f1,
      },
      regression: {
        baseline_id: drift.baseline_id,
        f1_delta: drift.f1_delta,
        precision_delta: drift.precision_delta,
        recall_delta: drift.recall_delta,
        has_regression: drift.has_regression,
      },
      failures: report.case_results
        .filter((r) => !r.passed)
        .map((r) => ({ case_id: r.case_id, reason: r.failure_reason, missing_rules: r.missing_rules, unexpected_insights: r.unexpected_insights })),
    }
  })
}

/** detector-evals/ lives at the repo root next to detectors/ — server.ts passes the resolved path in. */
export const detectorEvalDir = (root: string) => path.join(root, 'detector-evals')
