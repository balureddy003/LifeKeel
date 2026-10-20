/** GET /operator/retention (PRD-141): aggregated retention and trust metrics. */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { requireOperator } from '../operator/operator-auth.js'
import { computeRetentionMetrics } from '../metrics/retention.js'

export function registerOperatorRetentionRoutes(app: FastifyInstance, db: Db): void {
  app.get('/operator/retention', { preHandler: requireOperator(db, 'overview.read') }, async () =>
    computeRetentionMetrics(db),
  )
}
