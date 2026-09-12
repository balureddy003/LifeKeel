import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { DetectorEvalRunner, type Engine } from '@kairos/engine'

type Environment = 'draft' | 'staging' | 'production'

export function registerDetectorPromotionRoutes(app: FastifyInstance, db: Db, engine: Engine, evalCasesDir: string): void {
  const versions = db.collection('detector_versions')
  const evalRunner = new DetectorEvalRunner(engine, evalCasesDir)
  versions.createIndex({ tenant_id: 1, id: 1, version: 1 }, { unique: true }).catch(() => {})

  app.post<{ Params: { id: string }; Body: { spec: Record<string, unknown> } }>('/detectors/:id/versions', async (req, reply) => {
    const latest = await versions.findOne({ tenant_id: req.authContext.tenant_id, id: req.params.id }, { sort: { version: -1 } })
    const version = Number(latest?.['version'] ?? 0) + 1
    const doc = { version_id: randomUUID(), tenant_id: req.authContext.tenant_id, id: req.params.id, version, environment: 'draft' as Environment, spec: req.body.spec, created_by: req.authContext.user_id, created_at: new Date() }
    await versions.insertOne(doc)
    return reply.status(201).send({ version: doc })
  })

  app.post<{ Params: { id: string; version: string }; Body: { environment: Environment; promotion_note?: string; override?: boolean } }>('/detectors/:id/versions/:version/promote', async (req, reply) => {
    const environment = req.body.environment
    if (!['staging', 'production'].includes(environment)) return reply.status(400).send({ error: 'Promotion target must be staging or production' })
    const report = await evalRunner.run(req.params.id)
    const drift = await evalRunner.compareToBaseline(db, req.params.id, 'production')
    if ((report.f1 < 0.8 || drift.has_regression) && !(req.body.override && req.authContext.roles.includes('admin') && req.body.promotion_note)) return reply.status(409).send({ error: 'Promotion blocked by detector eval gate', report, drift })
    const source = await versions.findOne({ tenant_id: req.authContext.tenant_id, id: req.params.id, version: Number(req.params.version) })
    if (!source) return reply.status(404).send({ error: 'Detector version not found' })
    const latest = await versions.findOne({ tenant_id: req.authContext.tenant_id, id: req.params.id }, { sort: { version: -1 } })
    const { _id: _sourceId, ...sourceDocument } = source
    const promoted = { ...sourceDocument, version_id: randomUUID(), version: Number(latest?.['version'] ?? 0) + 1, environment, promoted_by: req.authContext.user_id, promoted_at: new Date(), promotion_note: req.body.promotion_note ?? '', test_results: report, created_at: new Date() }
    await versions.insertOne(promoted)
    if (environment === 'production') await evalRunner.saveBaseline(db, req.params.id, 'production', report)
    return { version: promoted }
  })
}
