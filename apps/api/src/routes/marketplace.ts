import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { FreeTierPolicy } from '@kairos/platform'

const MarketplaceEntrySchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9-]*$/),
  author: z.string().min(1).max(128),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  license: z.literal('MIT'),
  connector_requirements: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  detector: z.record(z.unknown()),
})

export function registerMarketplaceRoutes(app: FastifyInstance, db: Db): void {
  const registry = db.collection('detector_registry')
  const installs = db.collection('detector_installs')
  const policy = new FreeTierPolicy()
  Promise.all([
    registry.createIndex({ id: 1, version: 1 }, { unique: true }),
    installs.createIndex({ tenant_id: 1, detector_id: 1 }, { unique: true }),
  ]).catch(() => {})

  app.get<{ Querystring: { verified?: string; industry?: string } }>('/registry/detectors', async req => {
    const filter: Record<string, unknown> = {}
    if (req.query.verified !== undefined) filter['verified'] = req.query.verified === 'true'
    if (req.query.industry) filter['industries'] = req.query.industry
    return { detectors: await registry.find(filter, { projection: { _id: 0, detector: 0 } }).sort({ verified: -1, downloads_30d: -1 }).limit(100).toArray() }
  })

  app.post('/registry/detectors', async (req, reply) => {
    const parsed = MarketplaceEntrySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid detector submission', issues: parsed.error.issues })
    const now = new Date()
    const entry = { ...parsed.data, verified: false, downloads_30d: 0, install_command: `kairos detector install ${parsed.data.id}`, submitted_by: req.authContext.user_id, submitted_at: now, updated_at: now }
    await registry.replaceOne({ id: entry.id, version: entry.version }, entry, { upsert: true })
    return reply.status(202).send({ detector: entry, review_status: 'pending' })
  })

  app.post<{ Params: { id: string } }>('/registry/detectors/:id/install', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    const detector = await registry.findOne({ id: req.params.id }, { sort: { submitted_at: -1 } })
    if (!detector) return reply.status(404).send({ error: 'Detector not found' })
    const existing = await installs.findOne({ tenant_id: tenantId, detector_id: req.params.id })
    if (!existing && !detector['verified']) {
      const tenant = await db.collection('tenants').findOne({ $or: [{ tenant_id: tenantId }, { id: tenantId }] })
      const used = await installs.countDocuments({ tenant_id: tenantId, verified: false, status: 'installed' })
      const decision = policy.check('community_detectors', used, String(tenant?.['tier'] ?? 'free'))
      if (!decision.allowed) return reply.status(402).send({ error: 'Community detector quota exceeded', quota: decision })
    }
    await installs.updateOne(
      { tenant_id: tenantId, detector_id: req.params.id },
      { $set: { tenant_id: tenantId, detector_id: req.params.id, version: detector['version'], verified: detector['verified'], status: 'installed', installed_at: new Date() } },
      { upsert: true },
    )
    await registry.updateOne({ _id: detector['_id'] }, { $inc: { downloads_30d: 1 } })
    return { detector: detector['detector'], metadata: { id: detector['id'], version: detector['version'], verified: detector['verified'] } }
  })

  app.get('/registry/installed', async req => ({
    detectors: await installs.find({ tenant_id: req.authContext.tenant_id, status: 'installed' }, { projection: { _id: 0 } }).toArray(),
  }))

  app.post<{ Body: { detector_id: string; action_receipt_id: string } }>('/registry/revenue-share', async (req, reply) => {
    if (!req.authContext.roles.includes('admin')) return reply.status(403).send({ error: 'Admin role required' })
    const detector = await registry.findOne({ id: req.body.detector_id, verified: true })
    if (!detector) return reply.status(404).send({ error: 'Verified detector not found' })
    const month = new Date().toISOString().slice(0, 7)
    const ledger = db.collection('detector_revenue_share')
    const current = await ledger.aggregate<{ total: number }>([
      { $match: { detector_id: req.body.detector_id, author: detector['author'], month } },
      { $group: { _id: null, total: { $sum: '$amount_usd' } } },
    ]).next()
    const amount = Math.max(0, Math.min(0.10, 500 - (current?.total ?? 0)))
    const entry = { id: randomUUID(), detector_id: req.body.detector_id, author: detector['author'], action_receipt_id: req.body.action_receipt_id, month, amount_usd: amount, created_at: new Date() }
    await ledger.updateOne({ action_receipt_id: req.body.action_receipt_id }, { $setOnInsert: entry }, { upsert: true })
    return { revenue_share: entry }
  })
}
