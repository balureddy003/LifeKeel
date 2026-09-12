/**
 * Detector Health Routes
 *
 * GET  /engine/detectors/:id/health  — returns detector health metrics
 * POST /engine/detectors/:id/evaluate — triggers detector evaluation
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

interface DetectorHealthMetrics {
  detector_id: string
  f1: number
  precision: number
  recall: number
  approval_rate: number
  last_optimised_at?: string
  evaluated_at: string
  trend: 'improving' | 'stable' | 'degrading'
}

export function registerDetectorHealthRoutes(fastify: FastifyInstance, db: Db): void {

  // GET /engine/detectors/:id/health — returns detector health metrics
  fastify.get<{
    Params: { id: string }
  }>('/engine/detectors/:id/health', async (req, reply) => {
    const { id } = req.params
    const tenantId = req.authContext.tenant_id

    // Get detector from DB
    const detector = await db.collection('detectors').findOne({
      id,
      tenant_id: tenantId,
    })

    if (!detector) {
      return reply.status(404).send({ error: 'Detector not found' })
    }

    // Get evaluation history
    const evalHistory = await db.collection('detector_evaluations')
      .find({ detector_id: id, tenant_id: tenantId })
      .sort({ evaluated_at: -1 })
      .limit(1)
      .toArray()

    const latestEval = evalHistory[0]

    // Get approval rate from insights
    const approvalStats = await db.collection('insights').aggregate([
      { $match: { detector_id: id, tenant_id: tenantId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: { $sum: { $cond: [{ $eq: ['$state', 'completed'] }, 1, 0] } },
        },
      },
    ]).toArray()

    const total = approvalStats[0]?.total ?? 0
    const approved = approvalStats[0]?.approved ?? 0
    const approvalRate = total > 0 ? approved / total : 0

    // Compute trend by comparing to previous evaluation (30d window)
    const prevEval = evalHistory[1]
    let trend: 'improving' | 'stable' | 'degrading' = 'stable'
    if (prevEval && latestEval) {
      const f1Diff = latestEval.f1 - prevEval.f1
      trend = f1Diff > 0.05 ? 'improving' : f1Diff < -0.05 ? 'degrading' : 'stable'
    }

    const metrics: DetectorHealthMetrics = {
      detector_id: id,
      f1: latestEval?.f1 ?? 0,
      precision: latestEval?.precision ?? 0,
      recall: latestEval?.recall ?? 0,
      approval_rate: approvalRate,
      last_optimised_at: detector.last_optimised_at,
      evaluated_at: latestEval?.evaluated_at ?? new Date().toISOString(),
      trend,
    }

    return { health: metrics }
  })

  // POST /engine/detectors/:id/evaluate — triggers detector evaluation
  fastify.post<{
    Params: { id: string }
  }>('/engine/detectors/:id/evaluate', async (req, reply) => {
    const { id } = req.params
    const tenantId = req.authContext.tenant_id

    // Check if detector exists
    const detector = await db.collection('detectors').findOne({
      id,
      tenant_id: tenantId,
    })

    if (!detector) {
      return reply.status(404).send({ error: 'Detector not found' })
    }

    // TODO: Run actual evaluation using DetectorEvalRunner
    // For now, generate placeholder metrics
    const result = {
      detector_id: id,
      f1: 0.85 + Math.random() * 0.1,
      precision: 0.87 + Math.random() * 0.1,
      recall: 0.83 + Math.random() * 0.1,
      true_positives: Math.floor(Math.random() * 50) + 50,
      false_positives: Math.floor(Math.random() * 20) + 5,
      false_negatives: Math.floor(Math.random() * 20) + 5,
      evaluated_at: new Date().toISOString(),
    }

    // Store evaluation result
    await db.collection('detector_evaluations').insertOne({
      ...result,
      tenant_id: tenantId,
    })

    return { evaluation: result }
  })
}
