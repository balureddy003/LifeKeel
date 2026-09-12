/**
 * Verified moments — deterministic proof ledger from insight to measured outcome.
 *
 * GET  /verified-moments                 — list tenant moments
 * GET  /verified-moments/:id             — inspect one moment and lineage
 * POST /verified-moments/:id/outcome     — record measured metric delta
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { recordMomentOutcome } from '../verified-moments.js'

const OutcomeSchema = z.object({
  metric: z.string().min(1).max(128),
  baseline: z.number(),
  observed: z.number(),
  value_minor_units: z.number().int().optional(),
  currency: z.string().min(3).max(3).default('GBP'),
  source: z.string().min(1).max(64).default('manual'),
})

export function registerVerifiedMomentRoutes(app: FastifyInstance, db: Db): void {
  const col = db.collection('verified_moments')
  Promise.all([
    col.createIndex({ tenant_id: 1, created_at: -1 }),
    col.createIndex({ tenant_id: 1, goal_id: 1, created_at: -1 }),
    col.createIndex({ tenant_id: 1, status: 1 }),
  ]).catch(() => {})

  app.get<{
    Querystring: {
      goal_id?: string
      status?: string
      limit?: string
    }
  }>('/verified-moments', async (req) => {
    const { tenant_id } = req.authContext
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 100)
    const filter: Record<string, unknown> = { tenant_id }
    if (req.query.goal_id) filter['goal_id'] = req.query.goal_id
    if (req.query.status) filter['status'] = req.query.status

    const moments = await col
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()

    return { moments, total: moments.length }
  })

  app.get<{ Params: { id: string } }>('/verified-moments/:id', async (req, reply) => {
    const { tenant_id } = req.authContext
    const moment = await col.findOne({ tenant_id, id: req.params.id })
    if (!moment) return reply.status(404).send({ error: 'Verified moment not found' })

    const [signals, insight, actionReceipts] = await Promise.all([
      db.collection('signals')
        .find({ tenant_id, id: { $in: (moment['signal_ids'] as string[] | undefined) ?? [] } })
        .limit(50)
        .toArray(),
      db.collection('insights').findOne({ tenant_id, id: moment['insight_id'] }),
      db.collection('action_receipts')
        .find({ tenant_id, id: { $in: (moment['action_receipt_ids'] as string[] | undefined) ?? [] } })
        .toArray(),
    ])

    return { moment, lineage: { signals, insight, action_receipts: actionReceipts } }
  })

  app.post<{
    Params: { id: string }
    Body: z.infer<typeof OutcomeSchema>
  }>('/verified-moments/:id/outcome', async (req, reply) => {
    const parsed = OutcomeSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid outcome',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const { tenant_id } = req.authContext
    const ok = await recordMomentOutcome(db, {
      tenantId: tenant_id,
      momentId: req.params.id,
      metric: parsed.data.metric,
      baseline: parsed.data.baseline,
      observed: parsed.data.observed,
      currency: parsed.data.currency,
      source: parsed.data.source,
      ...(parsed.data.value_minor_units !== undefined ? { valueMinorUnits: parsed.data.value_minor_units } : {}),
    })
    if (!ok) return reply.status(404).send({ error: 'Verified moment not found' })

    const moment = await col.findOne({ tenant_id, id: req.params.id })
    return { ok: true, moment }
  })
}
