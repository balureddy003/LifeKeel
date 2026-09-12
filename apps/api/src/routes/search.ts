import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'

export function registerSearchRoutes(app: FastifyInstance, db: Db): void {
  Promise.all([
    db.collection('insights').createIndex({ hypothesis: 'text', reasoning: 'text' }),
    db.collection('goals').createIndex({ name: 'text', 'kpis.label': 'text' }),
    db.collection('detectors').createIndex({ id: 'text', name: 'text' }),
    db.collection('workflows').createIndex({ id: 'text', name: 'text' }),
  ]).catch(() => {})

  app.get<{ Querystring: { q?: string; types?: string; limit?: string } }>('/search', async req => {
    const q = req.query.q?.trim() ?? ''
    if (!q) return { results: [] }
    const tenantId = req.authContext.tenant_id
    const types = new Set((req.query.types ?? 'insight,goal,detector,workflow').split(','))
    const limit = Math.min(20, Math.max(1, Number(req.query.limit ?? 5)))
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    const results: Array<{ type: string; id: string; title: string; subtitle: string; href: string; score: number }> = []
    if (types.has('insight')) {
      for (const item of await db.collection('insights').find({ tenant_id: tenantId, $or: [{ hypothesis: regex }, { reasoning: regex }] }).limit(limit).toArray()) results.push({ type: 'insight', id: String(item['id']), title: String(item['hypothesis']), subtitle: String(item['urgency'] ?? ''), href: `/insights?insight=${item['id']}`, score: 1 })
    }
    if (types.has('goal')) {
      for (const item of await db.collection('goals').find({ tenant_id: tenantId, $or: [{ name: regex }, { 'kpis.label': regex }] }).limit(limit).toArray()) results.push({ type: 'goal', id: String(item['id']), title: String(item['name']), subtitle: String(item['status'] ?? ''), href: `/goals/${item['id']}`, score: 1 })
    }
    for (const type of ['detector', 'workflow'] as const) {
      if (!types.has(type)) continue
      const collection = type === 'detector' ? 'detectors' : 'workflows'
      for (const item of await db.collection(collection).find({ $and: [{ $or: [{ tenant_id: tenantId }, { tenant_id: { $exists: false } }] }, { $or: [{ id: regex }, { name: regex }] }] }).limit(limit).toArray()) results.push({ type, id: String(item['id']), title: String(item['name'] ?? item['id']), subtitle: '', href: `/${type}s/${item['id']}`, score: 1 })
    }
    return { results: results.slice(0, limit * types.size) }
  })
}
