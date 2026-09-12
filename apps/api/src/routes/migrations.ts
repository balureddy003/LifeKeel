import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Db } from 'mongodb'
import { GoalMigrationWorker } from '../jobs/goal-migration-worker.js'

export function registerMigrationRoutes(app: FastifyInstance, db: Db): void {
  const worker = new GoalMigrationWorker(db)
  app.get('/admin/migrations/goals', async req => {
    const tenantId = req.authContext.tenant_id
    const [total, migrated, latest] = await Promise.all([
      db.collection('goals').countDocuments({ tenant_id: tenantId }),
      db.collection('goals').countDocuments({ tenant_id: tenantId, migrated: true }),
      db.collection('goals').find({ tenant_id: tenantId }).sort({ updated_at: -1 }).limit(1).toArray(),
    ])
    return {
      total,
      migrated,
      remaining: total - migrated,
      last_goal_activity_at: latest[0]?.['updated_at'] ?? null,
      status: migrated === total ? 'complete' : migrated > 0 ? 'in_progress' : 'pending',
    }
  })
  app.post('/admin/migrations/goals/run', async (req, reply: FastifyReply) => {
    if (!worker.isEnabled()) {
      return reply.status(503).send({
        error: 'Legacy goal migration is disabled. Set GOAL_MIGRATION_ENABLED=true to enable it.',
      })
    }

    return worker.migrateNextBatch(req.authContext.tenant_id)
  })
}
