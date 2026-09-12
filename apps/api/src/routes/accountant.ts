import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'

const InviteSchema = z.object({ client_tenant_id: z.string().min(1), client_email: z.string().email() })
const WhiteLabelSchema = z.object({
  subdomain: z.string().min(1).optional(),
  logo_url: z.string().url().optional(),
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  email_sender_name: z.string().min(1).max(128).optional(),
  powered_by_kairos: z.boolean().default(true),
})

export function registerAccountantRoutes(app: FastifyInstance, db: Db): void {
  const relationships = db.collection('tenant_relationships')
  relationships.createIndex({ accountant_tenant_id: 1, client_tenant_id: 1 }, { unique: true }).catch(() => {})

  app.post('/accountant/clients/invite', async (req, reply) => {
    const parsed = InviteSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid invitation', issues: parsed.error.issues })
    const relationship = {
      id: randomUUID(),
      type: 'accountant_client',
      accountant_tenant_id: req.authContext.tenant_id,
      client_tenant_id: parsed.data.client_tenant_id,
      client_email: parsed.data.client_email,
      status: 'invited',
      invited_by: req.authContext.user_id,
      created_at: new Date(),
    }
    await relationships.updateOne(
      { accountant_tenant_id: relationship.accountant_tenant_id, client_tenant_id: relationship.client_tenant_id },
      { $set: relationship },
      { upsert: true },
    )
    return reply.status(202).send({ relationship })
  })

  app.get('/accountant/clients', async req => {
    const rows = await relationships.find({ accountant_tenant_id: req.authContext.tenant_id, type: 'accountant_client' }, { projection: { _id: 0 } }).toArray()
    const clients = await Promise.all(rows.map(async relationship => {
      const goals = await db.collection('goals').find({ tenant_id: relationship['client_tenant_id'], status: { $ne: 'archived' } }).project({ _id: 0, id: 1, name: 1, status: 1, trajectory: 1 }).toArray()
      return { relationship, goals }
    }))
    return { clients }
  })

  app.get('/accountant/white-label', async req => ({
    white_label: await db.collection('white_label_settings').findOne({ tenant_id: req.authContext.tenant_id }, { projection: { _id: 0 } }),
  }))

  app.put('/accountant/white-label', async (req, reply) => {
    const parsed = WhiteLabelSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid white-label configuration', issues: parsed.error.issues })
    const tenant = await db.collection('tenants').findOne({ $or: [{ tenant_id: req.authContext.tenant_id }, { id: req.authContext.tenant_id }] })
    if (!['enterprise', 'practice_pro'].includes(String(tenant?.['tier'] ?? 'free'))) return reply.status(402).send({ error: 'White-label configuration requires Practice Pro or Enterprise' })
    const whiteLabel = { tenant_id: req.authContext.tenant_id, ...parsed.data, updated_at: new Date() }
    await db.collection('white_label_settings').replaceOne({ tenant_id: req.authContext.tenant_id }, whiteLabel, { upsert: true })
    return { white_label: whiteLabel }
  })

  app.post<{ Params: { goalId: string }; Body: { email: string; client_tenant_id: string } }>('/accountant/reports/:goalId/share', async (req, reply) => {
    const relationship = await relationships.findOne({ accountant_tenant_id: req.authContext.tenant_id, client_tenant_id: req.body.client_tenant_id, type: 'accountant_client', status: { $in: ['invited', 'active'] } })
    if (!relationship) return reply.status(403).send({ error: 'No managed client relationship' })
    const goal = await db.collection('goals').findOne({ id: req.params.goalId, tenant_id: relationship['client_tenant_id'] })
    if (!goal) return reply.status(404).send({ error: 'Goal not found for managed client' })
    const share = { id: randomUUID(), accountant_tenant_id: req.authContext.tenant_id, client_tenant_id: relationship['client_tenant_id'], goal_id: goal['id'], email: req.body.email, status: 'queued', created_at: new Date() }
    await db.collection('goal_report_shares').insertOne(share)
    return reply.status(202).send({ share })
  })
}
