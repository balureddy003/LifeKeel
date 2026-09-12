import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

const ExportSchema = z.object({
  export: z.object({
    outcomes: z.array(z.record(z.unknown())).default([]),
    detectors: z.array(z.record(z.unknown())).default([]),
    insights: z.array(z.record(z.unknown())).default([]),
    action_receipts: z.array(z.record(z.unknown())).default([]),
    agent_memory: z.array(z.record(z.unknown())).default([]),
  }),
})

export function registerDesktopSyncRoutes(app: FastifyInstance, db: Db): void {
  app.post('/sync/desktop-to-cloud', async (req, reply) => {
    const parsed = ExportSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid desktop export', issues: parsed.error.issues })
    const tenantId = req.authContext.tenant_id
    const conflicts: Array<{ type: string; id: string; resolution: string }> = []
    let inserted = 0

    for (const outcome of parsed.data.export.outcomes) {
      const id = String(outcome['id'])
      const existing = await db.collection('outcome_contracts').findOne({ tenant_id: tenantId, id })
      if (existing) conflicts.push({ type: 'outcome', id, resolution: 'cloud_wins' })
      else {
        await db.collection('outcome_contracts').insertOne({ ...outcome, tenant_id: tenantId, sync_pending: false })
        inserted++
      }
    }
    for (const detector of parsed.data.export.detectors) {
      const id = String(detector['id'])
      const existing = await db.collection('detector_definitions').findOne({ tenant_id: tenantId, id })
      const localUpdated = new Date(String(detector['updated_at'] ?? 0)).getTime()
      const cloudUpdated = new Date(String(existing?.['updated_at'] ?? 0)).getTime()
      if (!existing || localUpdated > cloudUpdated) {
        await db.collection('detector_definitions').replaceOne({ tenant_id: tenantId, id }, { ...detector, tenant_id: tenantId, sync_pending: false }, { upsert: true })
        inserted++
      } else conflicts.push({ type: 'detector', id, resolution: 'newer_cloud_wins' })
    }
    for (const [collection, records] of [
      ['insights', parsed.data.export.insights],
      ['action_receipts', parsed.data.export.action_receipts],
      ['agent_memory', parsed.data.export.agent_memory],
    ] as const) {
      for (const record of records) {
        const id = String(record['id'])
        const result = await db.collection(collection).updateOne(
          { tenant_id: tenantId, id },
          { $setOnInsert: { ...record, tenant_id: tenantId, sync_pending: false } },
          { upsert: true },
        )
        if (result.upsertedCount > 0) inserted++
        else conflicts.push({ type: collection, id, resolution: 'deduplicated' })
      }
    }
    return { inserted, conflicts, status: conflicts.length > 0 ? 'review_required' : 'complete' }
  })
}
