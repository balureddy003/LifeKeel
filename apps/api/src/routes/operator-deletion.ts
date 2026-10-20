/**
 * GET /operator/deletion-receipts (PRD-146) — the operator's view of deletion
 * evidence, for answering a deletion request. Counts and categories only.
 * `?tenant_id=` narrows to one tenant; `?status=partial` finds deletions that
 * did not finish.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { requireOperator } from '../operator/operator-auth.js'

export function registerOperatorDeletionRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Querystring: { tenant_id?: string; status?: string } }>(
    '/operator/deletion-receipts',
    { preHandler: requireOperator(db, 'users.read') },
    async (req) => {
      const filter: Record<string, unknown> = {}
      if (req.query.tenant_id) filter['tenant_id'] = String(req.query.tenant_id)
      if (['completed', 'partial', 'in_progress'].includes(req.query.status ?? '')) {
        filter['status'] = req.query.status
      }
      const rows = await db
        .collection('deletion_receipts')
        .find(filter, { projection: { _id: 0 } })
        .sort({ requested_at: -1 })
        .limit(200)
        .toArray()
      return { receipts: rows }
    },
  )
}
