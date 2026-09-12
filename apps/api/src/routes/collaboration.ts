import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

export function registerCollaborationRoutes(app: FastifyInstance, db: Db): void {
  const insights = db.collection('insights')
  insights.createIndex({ tenant_id: 1, 'collaboration.assignee_id': 1, state: 1 }).catch(() => {})
  insights.createIndex({ tenant_id: 1, 'collaboration.sla_breached_at': 1 }).catch(() => {})

  app.post<{ Params: { id: string }; Body: { body: string; author_name?: string } }>('/insights/:id/comments', async (req, reply) => {
    const body = req.body.body?.trim()
    if (!body) return reply.status(400).send({ error: 'Comment body required' })
    const comment = { id: randomUUID(), author_id: req.authContext.user_id, author_name: req.body.author_name ?? req.authContext.user_id, body, created_at: new Date() }
    const result = await insights.updateOne({ id: req.params.id, tenant_id: req.authContext.tenant_id }, { $push: { 'collaboration.comments': comment } } as never)
    if (!result.matchedCount) return reply.status(404).send({ error: 'Insight not found' })
    return reply.status(201).send({ comment })
  })

  app.patch<{ Params: { id: string; cid: string }; Body: { body: string } }>('/insights/:id/comments/:cid', async (req, reply) => {
    const result = await insights.updateOne(
      { id: req.params.id, tenant_id: req.authContext.tenant_id, 'collaboration.comments': { $elemMatch: { id: req.params.cid, author_id: req.authContext.user_id } } },
      { $set: { 'collaboration.comments.$.body': req.body.body, 'collaboration.comments.$.edited_at': new Date() } },
    )
    if (!result.matchedCount) return reply.status(403).send({ error: 'Comment not found or not owned by user' })
    return { updated: true }
  })

  app.delete<{ Params: { id: string; cid: string } }>('/insights/:id/comments/:cid', async (req, reply) => {
    const insight = await insights.findOne({ id: req.params.id, tenant_id: req.authContext.tenant_id })
    const comment = ((insight?.['collaboration'] as { comments?: Array<{ id: string; author_id: string }> } | undefined)?.comments ?? []).find(item => item.id === req.params.cid)
    if (!comment) return reply.status(404).send({ error: 'Comment not found' })
    if (comment.author_id !== req.authContext.user_id && !req.authContext.roles.includes('admin')) return reply.status(403).send({ error: 'Only author or admin may delete comment' })
    await insights.updateOne({ id: req.params.id, tenant_id: req.authContext.tenant_id }, { $pull: { 'collaboration.comments': { id: req.params.cid } } } as never)
    return { deleted: true }
  })

  app.post<{ Params: { id: string }; Body: { assignee_id: string; sla_minutes?: number } }>('/insights/:id/assign', async (req, reply) => {
    const assignedAt = new Date()
    const collaboration = { assignee_id: req.body.assignee_id, assigned_at: assignedAt, ...(req.body.sla_minutes ? { sla_minutes: req.body.sla_minutes } : {}) }
    const result = await insights.updateOne({ id: req.params.id, tenant_id: req.authContext.tenant_id }, { $set: Object.fromEntries(Object.entries(collaboration).map(([key, value]) => [`collaboration.${key}`, value])) })
    if (!result.matchedCount) return reply.status(404).send({ error: 'Insight not found' })
    return { collaboration }
  })
}
