import type { FastifyInstance } from 'fastify'
import type { Db, Document } from 'mongodb'
import { z } from 'zod'

const QueryPlanSchema = z.object({
  collection: z.enum(['insights', 'goals', 'workflow_runs', 'action_receipts']),
  operation: z.enum(['count', 'group_count', 'recent']),
  group_by: z.enum(['state', 'status', 'urgency', 'category', 'detector_id']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
})

function planQuestion(question: string): z.infer<typeof QueryPlanSchema> {
  const q = question.toLowerCase()
  const collection = q.includes('workflow') ? 'workflow_runs' : q.includes('receipt') || q.includes('action') ? 'action_receipts' : q.includes('goal') ? 'goals' : 'insights'
  const groupBy = ['urgency', 'category', 'status', 'state', 'detector_id'].find(field => q.includes(field.replace('_', ' '))) as z.infer<typeof QueryPlanSchema>['group_by']
  if (groupBy) return { collection, operation: 'group_count', group_by: groupBy, limit: 20 }
  if (q.includes('recent') || q.includes('latest')) return { collection, operation: 'recent', limit: 20 }
  return { collection, operation: 'count', limit: 20 }
}

export function registerQueryRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Body: { question: string; plan?: unknown } }>('/query', async (req, reply) => {
    const parsed = QueryPlanSchema.safeParse(req.body.plan ?? planQuestion(req.body.question))
    if (!parsed.success) return reply.status(400).send({ error: 'Unsafe or invalid query plan', issues: parsed.error.issues })
    const plan = parsed.data
    const collection = db.collection(plan.collection)
    const filter = { tenant_id: req.authContext.tenant_id }
    let rows: Document[]
    if (plan.operation === 'count') rows = [{ count: await collection.countDocuments(filter) }]
    else if (plan.operation === 'recent') rows = await collection.find(filter, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(plan.limit).toArray()
    else rows = await collection.aggregate([{ $match: filter }, { $group: { _id: `$${plan.group_by}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: plan.limit }]).toArray()
    return { question: req.body.question, plan, rows, suggested_follow_ups: [`Show recent ${plan.collection}`, `Count ${plan.collection} by status`, `Count ${plan.collection} by urgency`] }
  })
}
