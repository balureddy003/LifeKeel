import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

export function registerIdentityRoutes(app: FastifyInstance, db: Db): void {
  app.delete<{ Params: { id: string } }>('/scim/Users/:id', async (req, reply) => {
    if (!req.authContext.roles.includes('admin')) return reply.status(403).send({ error: 'Admin role required' })
    const result = await db.collection('users').updateOne(
      { tenant_id: req.authContext.tenant_id, id: req.params.id },
      { $set: { status: 'suspended', suspended_at: new Date() } },
    )
    if (result.matchedCount === 0) return reply.status(404).send({ error: 'User not found' })
    return { suspended: true }
  })
}
