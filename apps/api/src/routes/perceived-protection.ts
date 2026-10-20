/**
 * Perceived protection (PRD-141): one optional question per adult per quarter,
 * "How confident are you that your family's key items are covered?", answered
 * 1 to 5. The question never asks about products and recommends none. A skip is
 * remembered so the card does not return this quarter, but is not an answer.
 * Operators only ever see the aggregate above a minimum cohort
 * (metrics/retention.ts).
 */
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { isFamilyAdult } from '../family/family-permissions.js'
import { quarterOf } from '../metrics/retention.js'

const Body = z.union([
  z.object({ score: z.number().int().min(1).max(5) }),
  z.object({ skipped: z.literal(true) }),
])

export function registerPerceivedProtectionRoutes(app: FastifyInstance, db: Db): void {
  const col = db.collection('perceived_protection')

  app.get('/family/perceived-protection', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only adults are asked' })
    }
    const quarter = quarterOf(new Date())
    const existing = await col.findOne({ tenant_id, user_id, quarter })
    return { quarter, due: existing === null }
  })

  app.post('/family/perceived-protection', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    if (!(await isFamilyAdult(db, tenant_id, user_id))) {
      return reply.status(403).send({ error: 'Only adults are asked' })
    }
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Answer 1 to 5, or skip' })
    const quarter = quarterOf(new Date())
    // First answer wins for the quarter: a repeat tap cannot skew the aggregate.
    await col.updateOne(
      { tenant_id, user_id, quarter },
      {
        $setOnInsert: {
          tenant_id,
          user_id,
          quarter,
          at: new Date(),
          ...('score' in parsed.data ? { score: parsed.data.score } : { skipped: true }),
        },
      },
      { upsert: true },
    )
    return reply.status(204).send()
  })
}
