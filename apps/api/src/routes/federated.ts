/**
 * Federated Learning API Routes
 *
 * POST /federated/rounds/start           — Start a new federated round
 * POST /federated/rounds/:id/submit    — Submit a gradient update
 * POST /federated/rounds/:id/aggregate — Aggregate and complete round
 * GET  /federated/privacy-report       — Get tenant privacy budget status
 * GET  /federated/convergence          — Get convergence history
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import {
  FederatedLearning,
  PrivacyBudgetExceededError,
} from '@kairos/engine'

export function registerFederatedRoutes(
  app: FastifyInstance,
  _db: Db,
  fl: FederatedLearning,
): void {

  // POST /federated/rounds/start
  app.post('/federated/rounds/start', async (req, reply) => {
    const { global_model_version } = req.body as { global_model_version?: string }
    const round = await fl.startRound(global_model_version ?? 'v1.0.0')
    return reply.status(201).send({ round })
  })

  // POST /federated/rounds/:id/submit
  app.post<{ Params: { id: string } }>('/federated/rounds/:id/submit', async (req, reply) => {
    const { tenant_id } = req.authContext
    const roundId = req.params.id
    const body = req.body as {
      gradient: number[]
      sample_count: number
      loss: number
      peer_tenants: string[]
    }

    try {
      await fl.submitGradient(
        tenant_id,
        roundId,
        body.gradient,
        body.sample_count,
        body.loss,
        body.peer_tenants,
      )
      return reply.send({ success: true, round_id: roundId })
    } catch (err) {
      if (err instanceof PrivacyBudgetExceededError) {
        return reply.status(429).send({
          error: 'Privacy budget exceeded',
          message: err.message,
        })
      }
      return reply.status(500).send({
        error: 'Failed to submit gradient',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  })

  // POST /federated/rounds/:id/aggregate
  app.post<{ Params: { id: string } }>('/federated/rounds/:id/aggregate', async (req, reply) => {
    const round = await fl.aggregateRound(req.params.id)
    if (!round) {
      return reply.status(400).send({
        error: 'Round aggregation failed',
        reason: 'insufficient_participants_or_not_found',
      })
    }
    return reply.send({ round })
  })

  // GET /federated/privacy-report
  app.get('/federated/privacy-report', async (req) => {
    const { tenant_id } = req.authContext
    const report = fl.getPrivacyReport(tenant_id)
    const canParticipate = fl.canParticipate(tenant_id)
    return { tenant_id, ...report, can_participate: canParticipate }
  })

  // GET /federated/convergence
  app.get('/federated/convergence', async () => {
    const history = fl.getConvergenceHistory()
    return { rounds: history }
  })
}
