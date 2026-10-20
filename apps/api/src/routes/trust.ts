/**
 * PRD-208 trust surfaces.
 *
 *   GET /trust                    public: only claims that are evidenced and current,
 *                                 the live processor table, and the backup window
 *   GET /operator/evidence        every claim with its state (stale, needs owner, …)
 *   PUT /operator/evidence/:id    record owner, verification and renewal date
 *
 * The public response never includes owners or internal reasons. A claim whose
 * renewal date has passed drops out of /trust by itself.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { buildAiDisclosure } from '../ai/disclosure.js'
import { getProcessorRegistry, getTaskRegistry } from '../ai/task-gateway.js'
import { backupStatement } from '../deletion/receipt.js'
import { requireOperator } from '../operator/operator-auth.js'
import { OperatorAuditLogger } from '../operator/operator-audit.js'
import { claimStatuses, loadClaims, type EvidenceRecord } from '../trust/claims.js'

const UpdateSchema = z.object({
  owner: z.string().trim().min(2).max(100),
  verified_at: z.coerce.date(),
  renew_by: z.coerce.date(),
  reason: z.string().trim().min(5).max(500),
})

export function registerTrustRoutes(app: FastifyInstance, db: Db): void {
  const audit = new OperatorAuditLogger(db)

  app.get('/trust', async (_req, reply) => {
    const processors = getProcessorRegistry()
    const tasks = getTaskRegistry()
    if (processors.size === 0 || tasks.size === 0) {
      return reply.status(503).send({ error: 'AI registries are not loaded' })
    }
    const statuses = await claimStatuses(db)
    return {
      claims: statuses
        .filter((c) => c.state === 'published')
        .map((c) => ({
          id: c.id,
          statement: c.statement,
          evidence: c.evidence,
          verified_at: c.verified_at,
        })),
      ai: buildAiDisclosure(tasks, processors),
      backups: backupStatement(),
    }
  })

  app.get('/operator/evidence', { preHandler: requireOperator(db, 'overview.read') }, async () => {
    const statuses = await claimStatuses(db)
    return {
      claims: statuses,
      attention: statuses.filter((c) => c.state === 'stale' || c.state === 'needs_owner').length,
    }
  })

  app.put<{ Params: { id: string } }>(
    '/operator/evidence/:id',
    { preHandler: requireOperator(db, 'configuration.manage') },
    async (req, reply) => {
      const claim = loadClaims().find((c) => c.id === req.params.id)
      if (!claim) return reply.status(404).send({ error: 'Unknown claim' })
      if (!claim.publishable) {
        return reply
          .status(409)
          .send({ error: 'This claim has no evidence yet and cannot be published' })
      }
      const parsed = UpdateSchema.safeParse(req.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid evidence record' })
      const { reason, ...rec } = parsed.data
      if (rec.renew_by.getTime() <= rec.verified_at.getTime()) {
        return reply
          .status(400)
          .send({ error: 'The renewal date must be after the verification date' })
      }
      const col = db.collection<EvidenceRecord>('trust_evidence')
      const before = await col.findOne({ claim_id: claim.id }, { projection: { _id: 0 } })
      const next: EvidenceRecord = { claim_id: claim.id, ...rec }
      await col.updateOne({ claim_id: claim.id }, { $set: next }, { upsert: true })
      await audit.log(
        req,
        'operator.trust_evidence.update',
        'trust_claim',
        claim.id,
        reason,
        undefined,
        { before, after: next },
      )
      return { ok: true }
    },
  )
}
