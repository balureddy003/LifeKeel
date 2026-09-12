/**
 * Workflow Marketplace — Community workflow sharing and discovery.
 *
 * Phase 7 Feature: Community & Marketplace
 *
 * Routes:
 *   GET  /marketplace/workflows  — Browse marketplace
 *   POST /marketplace/workflows/:id/install  — Install workflow
 *   POST /marketplace/workflows/:id/fork  — Fork workflow
 *   POST /marketplace/workflows/:id/rate  — Rate workflow
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'marketplace-v2', version: '0.0.0' })

/** Escape user-provided search strings to prevent ReDoS and regex injection. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Schema ─────────────────────────────────────────────────────────────────────

const ReviewSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  rating: z.number().min(1).max(5),
  comment: z.string(),
  created_at: z.string(),
})

const MarketplaceWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  author: z.object({
    id: z.string(),
    name: z.string(),
    avatar_color: z.string(),
  }),
  category: z.enum(['marketing', 'sales', 'operations', 'support', 'analytics', 'automation']),
  tags: z.array(z.string()),
  nodes: z.array(z.any()),
  connections: z.array(z.any()),
  rating: z.number().min(0).max(5),
  review_count: z.number(),
  installs: z.number(),
  forks: z.number(),
  reviews: z.array(ReviewSchema),
  created_at: z.string(),
  updated_at: z.string(),
})

const InstallWorkflowRequestSchema = z.object({
  tenant_id: z.string(),
  custom_name: z.string().optional(),
})

const RateWorkflowRequestSchema = z.object({
  rating: z.number().min(1).max(5),
  comment: z.string().optional(),
})

export type MarketplaceWorkflow = z.infer<typeof MarketplaceWorkflowSchema>
export type Review = z.infer<typeof ReviewSchema>

// ── Route Handlers ─────────────────────────────────────────────────────────────

const VerifiedMomentSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['marketing', 'sales', 'operations', 'support', 'analytics', 'automation']),
  tags: z.array(z.string()),
  evidence: z.object({
    before_value: z.number(),
    after_value: z.number(),
    unit: z.string(),
    confidence: z.number(),
  }),
  workflow_id: z.string(),
  detector_id: z.string(),
  created_at: z.string(),
  verified: z.boolean(),
})

export type VerifiedMomentMarketplace = z.infer<typeof VerifiedMomentSchema>

export async function registerWorkflowMarketplaceRoutes(app: FastifyInstance, db: Db) {
  const col = db.collection<MarketplaceWorkflow>('marketplace_workflows')
  col.createIndex({ category: 1 }).catch(() => {})
  col.createIndex({ rating: -1 }).catch(() => {})
  col.createIndex({ installs: -1 }).catch(() => {})
  col.createIndex({ tags: 1 }).catch(() => {})

  // ── GET /marketplace/workflows ─────────────────────────────────────────────────
  app.get('/marketplace/workflows', async (req, reply) => {
    const { category, search, limit = 20, offset = 0 } = req.query as {
      category?: string
      search?: string
      limit?: number
      offset?: number
    }

    try {
      const filter: any = {}
      if (category) {
        filter.category = category
      }
      if (search) {
        const safeSearch = escapeRegex(search)
        filter.$or = [
          { name: { $regex: safeSearch, $options: 'i' } },
          { description: { $regex: safeSearch, $options: 'i' } },
          { tags: { $in: [new RegExp(safeSearch, 'i')] } },
        ]
      }

      const workflows = await col
        .find(filter)
        .sort({ rating: -1, installs: -1 })
        .skip(offset)
        .limit(limit)
        .toArray()

      const total = await col.countDocuments(filter)

      return reply.status(200).send({
        workflows,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + limit < total,
        },
      })
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch marketplace workflows')
      return reply.status(500).send({
        error: 'Failed to fetch marketplace workflows',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── GET /marketplace/workflows/:id ───────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/marketplace/workflows/:id', async (req, reply) => {
    const { id: workflowId } = req.params

    try {
      const workflow = await col.findOne({ id: workflowId })
      
      if (!workflow) {
        return reply.status(404).send({ error: 'Workflow not found' })
      }

      return reply.status(200).send(workflow)
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch marketplace workflow')
      return reply.status(500).send({
        error: 'Failed to fetch marketplace workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /marketplace/workflows/:id/install ───────────────────────────────────────
  app.post<{ Params: { id: string } }>('/marketplace/workflows/:id/install', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { id: workflowId } = req.params

    const parsed = InstallWorkflowRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid install request',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const { custom_name } = parsed.data

    try {
      const workflow = await col.findOne({ id: workflowId })
      
      if (!workflow) {
        return reply.status(404).send({ error: 'Workflow not found' })
      }

      // Increment install count
      await col.updateOne(
        { id: workflowId },
        { $inc: { installs: 1 } }
      )

      // Create workflow in tenant's workspace
      const workflowsCol = db.collection('workflows')
      const newWorkflow = {
        id: `workflow-${Date.now()}`,
        tenant_id,
        name: custom_name || workflow.name,
        description: workflow.description,
        nodes: workflow.nodes,
        connections: workflow.connections,
        source: 'marketplace',
        source_id: workflowId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      await workflowsCol.insertOne(newWorkflow)

      return reply.status(201).send(newWorkflow)
    } catch (error) {
      log.error({ err: error }, 'Failed to install workflow')
      return reply.status(500).send({
        error: 'Failed to install workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /marketplace/workflows/:id/fork ───────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/marketplace/workflows/:id/fork', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { id: workflowId } = req.params

    try {
      const workflow = await col.findOne({ id: workflowId })
      
      if (!workflow) {
        return reply.status(404).send({ error: 'Workflow not found' })
      }

      // Increment fork count
      await col.updateOne(
        { id: workflowId },
        { $inc: { forks: 1 } }
      )

      // Create forked workflow in tenant's workspace
      const workflowsCol = db.collection('workflows')
      const newWorkflow = {
        id: `workflow-${Date.now()}`,
        tenant_id,
        name: `${workflow.name} (Fork)`,
        description: workflow.description,
        nodes: workflow.nodes,
        connections: workflow.connections,
        source: 'marketplace',
        source_id: workflowId,
        forked_from: workflowId,
        forked_by: user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      await workflowsCol.insertOne(newWorkflow)

      return reply.status(201).send(newWorkflow)
    } catch (error) {
      log.error({ err: error }, 'Failed to fork workflow')
      return reply.status(500).send({
        error: 'Failed to fork workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /marketplace/workflows/:id/rate ───────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/marketplace/workflows/:id/rate', async (req, reply) => {
    const { user_id } = req.authContext
    const { id: workflowId } = req.params

    const parsed = RateWorkflowRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid rating request',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const { rating, comment } = parsed.data

    try {
      const workflow = await col.findOne({ id: workflowId })
      
      if (!workflow) {
        return reply.status(404).send({ error: 'Workflow not found' })
      }

      // Check if user already rated
      const existingReview = workflow.reviews.find(r => r.user_id === user_id)
      
      if (existingReview) {
        // Update existing review
        await col.updateOne(
          { id: workflowId, 'reviews.user_id': user_id },
          { $set: { 'reviews.$.rating': rating, 'reviews.$.comment': comment } }
        )
      } else {
        // Add new review
        const newReview: Review = {
          id: `review-${Date.now()}`,
          user_id,
          rating,
          comment: comment || '',
          created_at: new Date().toISOString(),
        }

        await col.updateOne(
          { id: workflowId },
          { $push: { reviews: newReview }, $inc: { review_count: 1 } }
        )
      }

      // Recalculate average rating
      const updated = await col.findOne({ id: workflowId })
      const avgRating = updated!.reviews.reduce((sum, r) => sum + r.rating, 0) / updated!.reviews.length

      await col.updateOne(
        { id: workflowId },
        { $set: { rating: Math.round(avgRating * 10) / 10 } }
      )

      return reply.status(200).send({ rating: avgRating, review_count: updated!.reviews.length })
    } catch (error) {
      log.error({ err: error }, 'Failed to rate workflow')
      return reply.status(500).send({
        error: 'Failed to rate workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── Verified Moment Marketplace ─────────────────────────────────────────────────

  // GET /marketplace/moments — browse verified moments
  app.get('/marketplace/moments', async (req, reply) => {
    const { category, search, limit = 20, offset = 0 } = req.query as {
      category?: string
      search?: string
      limit?: number
      offset?: number
    }

    const filter: Record<string, unknown> = { verified: true }
    if (category) filter.category = category
    if (search) {
      const safeSearch = escapeRegex(search)
      filter.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } },
        { tags: { $in: [new RegExp(safeSearch, 'i')] } },
      ]
    }

    const momentsCol = db.collection<VerifiedMomentMarketplace>('marketplace_moments')
    const [docs, total] = await Promise.all([
      momentsCol.find(filter).sort({ created_at: -1 }).skip(offset).limit(limit).toArray(),
      momentsCol.countDocuments(filter),
    ])

    return reply.send({
      moments: docs.map(d => ({
        id: d.id,
        name: d.name,
        description: d.description,
        category: d.category,
        tags: d.tags,
        evidence: d.evidence,
        verified: d.verified,
        created_at: d.created_at,
      })),
      total,
      limit,
      offset,
    })
  })

  // POST /marketplace/moments — publish a verified moment
  app.post('/marketplace/moments', async (req, reply) => {
    const { tenant_id } = req.authContext
    const body = req.body as Omit<VerifiedMomentMarketplace, 'id' | 'tenant_id' | 'created_at' | 'verified'>

    const moment: VerifiedMomentMarketplace = {
      ...body,
      id: `moment-${Date.now()}`,
      tenant_id,
      created_at: new Date().toISOString(),
      verified: false,
    }

    await db.collection<VerifiedMomentMarketplace>('marketplace_moments').insertOne(moment)
    return reply.status(201).send(moment)
  })
}
