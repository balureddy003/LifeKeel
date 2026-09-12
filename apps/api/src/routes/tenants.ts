import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { PLAN_QUOTAS, type Plan } from '../billing/billing-constants.js'

const ProvisionSchema = z.object({ tenant_id: z.string().min(1), name: z.string().min(1), plan: z.enum(['free', 'starter', 'growth', 'enterprise']).default('free'), edition: z.string().default('cloud') })

function adminAuthorized(headers: Record<string, unknown>): boolean {
  const expected = process.env['KAIROS_ADMIN_KEY']
  return Boolean(expected && headers['x-kairos-admin-key'] === expected)
}

export function registerTenantRoutes(app: FastifyInstance, db: Db): void {
  app.post('/admin/tenants', async (req, reply) => {
    if (!adminAuthorized(req.headers)) return reply.status(403).send({ error: 'Admin key required' })
    const parsed = ProvisionSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid tenant', issues: parsed.error.issues })
    const tenant = { ...parsed.data, quotas: PLAN_QUOTAS[parsed.data.plan], status: 'active', created_at: new Date(), updated_at: new Date() }
    await db.collection('tenants').replaceOne({ tenant_id: tenant.tenant_id }, tenant, { upsert: true })
    return reply.status(201).send({ tenant })
  })

  app.put<{ Params: { id: string }; Body: { plan: Plan } }>('/admin/tenants/:id/plan', async (req, reply) => {
    if (!adminAuthorized(req.headers) || !PLAN_QUOTAS[req.body.plan]) return reply.status(403).send({ error: 'Admin key and valid plan required' })
    await db.collection('tenants').updateOne({ tenant_id: req.params.id }, { $set: { plan: req.body.plan, quotas: PLAN_QUOTAS[req.body.plan], updated_at: new Date() } })
    return { updated: true }
  })

  app.post<{ Params: { id: string } }>('/admin/tenants/:id/suspend', async (req, reply) => {
    if (!adminAuthorized(req.headers)) return reply.status(403).send({ error: 'Admin key required' })
    await db.collection('tenants').updateOne({ tenant_id: req.params.id }, { $set: { status: 'suspended', updated_at: new Date() } })
    return { suspended: true }
  })
}
