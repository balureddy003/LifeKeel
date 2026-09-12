import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { canPerform } from '@kairos/platform'

export function registerTeamRoutes(app: FastifyInstance, db: Db): void {
  app.get('/team/members', async req => ({
    members: await db.collection('users').find({ tenant_id: req.authContext.tenant_id }, { projection: { _id: 0, password_hash: 0 } }).toArray(),
  }))
  app.post<{ Body: { email: string; role: string } }>('/team/members', async (req, reply) => {
    if (!canPerform(req.authContext.roles, 'users', 'create')) return reply.status(403).send({ error: 'Insufficient permission' })

    // M1: Enforce users_max quota
    const tenantId = req.authContext.tenant_id
    const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId })
    const limit = tenant?.['quotas']?.['users_max'] as number | undefined
    if (limit !== undefined && limit !== -1) {
      const count = await db.collection('users').countDocuments({ tenant_id: tenantId })
      if (count >= limit) {
        return reply.status(429).send({
          error: 'Team member quota exceeded',
          resource: 'users_max',
          limit,
          used: count,
          upgrade_url: '/billing/checkout',
        })
      }
    }

    const member = { id: randomUUID(), tenant_id: tenantId, email: req.body.email, roles: [req.body.role], status: 'invited', created_at: new Date() }
    await db.collection('users').insertOne(member)
    return reply.status(201).send({ member })
  })
  app.patch<{ Params: { id: string }; Body: { role: string } }>('/team/members/:id', async (req, reply) => {
    if (!canPerform(req.authContext.roles, 'users', 'update')) return reply.status(403).send({ error: 'Insufficient permission' })
    await db.collection('users').updateOne({ tenant_id: req.authContext.tenant_id, id: req.params.id }, { $set: { roles: [req.body.role], updated_at: new Date() } })
    return { updated: true }
  })
}
