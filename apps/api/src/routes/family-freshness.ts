/**
 * GET /family/freshness (PRD-145) — which checks can run on current inputs and
 * which are paused, read from the daily `freshness_state` record. Adults only,
 * like the readiness score. Names and states only; never field values.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { isFamilyAdult } from '../family/family-permissions.js'
import { freshnessShare, type FreshnessState } from '../freshness/inputs.js'

export function registerFamilyFreshnessRoutes(app: FastifyInstance, db: Db): void {
  app.get('/family/freshness', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only adults can see this' })
    }
    const rows = (await db
      .collection('freshness_state')
      .find({ tenant_id }, { projection: { _id: 0, tenant_id: 0 } })
      .toArray()) as unknown as {
      detector_id: string
      label: string
      state: FreshnessState
      input: string[]
      since: Date
      checked_at: Date
    }[]
    return {
      checked_at: rows.reduce<Date | null>(
        (m, r) => (m === null || r.checked_at > m ? r.checked_at : m),
        null,
      ),
      share_running: freshnessShare(rows),
      detectors: rows
        .filter((r) => r.state !== 'not_applicable')
        .map((r) => ({
          detector_id: r.detector_id,
          label: r.label,
          state: r.state,
          input: r.input,
          since: r.since,
        })),
    }
  })
}
