/**
 * GET  /skills/proposals       — list pending SkillOptimizer proposals
 * POST /skills/proposals/:id/approve — approve and apply optimized_prompt
 * POST /skills/proposals/:id/reject  — reject with optional reason
 */

import type { FastifyInstance } from 'fastify'
import type { Db, ObjectId } from 'mongodb'
import { ObjectId as MongoObjectId } from 'mongodb'
import { PromptVersionRegistry } from '@kairos/platform'

interface SkillOptRun {
  _id: ObjectId
  tenant_id: string
  detector_id?: string
  skill_name?: string
  status: 'pending_review' | 'approved' | 'rejected'
  current_prompt: string
  optimized_prompt: string
  estimated_f1_improvement: number
  reasoning?: string
  created_at: Date
  reviewed_at?: Date
  rejection_reason?: string
  rejection_memory?: string[]
}

export async function registerSkillRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const col = db.collection<SkillOptRun>('skill_opt_runs')
  const promptRegistry = new PromptVersionRegistry(db)

  /** GET /skills/proposals — list pending proposals for the authenticated tenant */
  app.get('/skills/proposals', async (request) => {
    const { tenant_id } = request.authContext
    const proposals = await col
      .find({ tenant_id, status: 'pending_review' })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray()

    return {
      proposals: proposals.map(p => ({
        id:                       p._id.toHexString(),
        tenant_id:                p.tenant_id,
        detector_id:              p.detector_id,
        skill_name:               p.skill_name,
        current_prompt:           p.current_prompt,
        optimized_prompt:         p.optimized_prompt,
        estimated_f1_improvement: p.estimated_f1_improvement,
        reasoning:                p.reasoning,
        created_at:               p.created_at,
      })),
    }
  })

  /** POST /skills/proposals/:id/approve */
  app.post<{ Params: { id: string } }>('/skills/proposals/:id/approve', async (request, reply) => {
    const { tenant_id } = request.authContext
    const { id } = request.params

    let oid: ObjectId
    try {
      oid = new MongoObjectId(id)
    } catch {
      return reply.status(400).send({ error: 'Invalid proposal id' })
    }

    const proposal = await col.findOne({ _id: oid, tenant_id })
    if (!proposal) return reply.status(404).send({ error: 'Proposal not found' })
    if (proposal.status !== 'pending_review') {
      return reply.status(409).send({ error: `Proposal is already ${proposal.status}` })
    }

    await col.updateOne(
      { _id: oid },
      { $set: { status: 'approved', reviewed_at: new Date() } },
    )

    const candidate = await promptRegistry.createCandidate({
      template: proposal.optimized_prompt,
      author: 'skill-optimizer',
      metadata: {
        call_type: 'enrichment',
        ...(proposal.detector_id !== undefined && { detector_id: proposal.detector_id }),
        ...(proposal.skill_name !== undefined && { skill_id: proposal.skill_name }),
      },
    })

    return { ok: true, id, prompt_version_id: candidate.id, status: 'candidate' }
  })

  /** POST /skills/proposals/:id/reject */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/skills/proposals/:id/reject',
    async (request, reply) => {
      const { tenant_id } = request.authContext
      const { id } = request.params
      const { reason } = request.body ?? {}

      let oid: ObjectId
      try {
        oid = new MongoObjectId(id)
      } catch {
        return reply.status(400).send({ error: 'Invalid proposal id' })
      }

      const proposal = await col.findOne({ _id: oid, tenant_id })
      if (!proposal) return reply.status(404).send({ error: 'Proposal not found' })
      if (proposal.status !== 'pending_review') {
        return reply.status(409).send({ error: `Proposal is already ${proposal.status}` })
      }

      // Accumulate rejection memory — used to bias future SkillOptimizer runs
      const existingMemory = proposal.rejection_memory ?? []
      const updatedMemory  = reason ? [...existingMemory, reason] : existingMemory

      await col.updateOne(
        { _id: oid },
        {
          $set: {
            status:           'rejected' as const,
            reviewed_at:      new Date(),
            ...(reason ? { rejection_reason: reason } : {}),
            rejection_memory: updatedMemory,
          },
        },
      )

      return { ok: true, id }
    },
  )
}
