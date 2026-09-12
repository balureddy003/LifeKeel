import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

const ERASABLE = [
  'signals', 'insights', 'workflow_runs', 'agent_memory', 'memory_records',
  'goals', 'goal_detector_activations', 'delivery_receipts', 'verified_moments',
]
const RETAINED = ['llm_usage', 'cost_ledger', 'audit_log', 'audit_logs']

export function registerPrivacyRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Params: { tenantId: string } }>('/admin/tenants/:tenantId/erasure', async (req, reply) => {
    const { tenantId } = req.params
    if (!req.authContext.roles.includes('admin') || req.authContext.tenant_id !== tenantId) {
      return reply.status(403).send({ error: 'Tenant admin role required' })
    }
    const tenant = await db.collection('tenants').findOneAndUpdate(
      { $or: [{ tenant_id: tenantId }, { id: tenantId }] },
      { $set: { status: 'erasure_pending', erasure_requested_at: new Date() } },
      { returnDocument: 'after', upsert: true },
    )
    const pseudonym = createHash('sha256')
      .update(`${tenantId}:${process.env['ERASURE_SALT'] ?? 'configure-erasure-salt'}`)
      .digest('hex')

    const deletions = await Promise.all(ERASABLE.map(async collection => ({
      collection,
      deleted: (await db.collection(collection).deleteMany({ tenant_id: tenantId })).deletedCount,
    })))
    await Promise.all(RETAINED.map(collection => db.collection(collection).updateMany(
      { tenant_id: tenantId },
      { $set: { tenant_id: pseudonym, tenant_erased: true } },
    )))
    await db.collection('tenants').updateOne(
      tenant?._id ? { _id: tenant._id } : { $or: [{ tenant_id: tenantId }, { id: tenantId }] },
      { $set: { status: 'erased', erased_at: new Date(), tenant_id: pseudonym } },
    )
    return { status: 'erased', pseudonymous_tenant_id: pseudonym, deletions }
  })
}
