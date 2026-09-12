import type { Db } from 'mongodb'

export class InsightSlaWorker {
  constructor(private readonly db: Db) {}

  async run(now = new Date()): Promise<number> {
    const candidates = await this.db.collection('insights').find({
      state: 'identified',
      'collaboration.sla_minutes': { $gt: 0 },
      'collaboration.sla_breached_at': { $exists: false },
    }).toArray()
    let breached = 0
    for (const insight of candidates) {
      const collaboration = insight['collaboration'] as { assigned_at?: Date; sla_minutes?: number }
      const start = collaboration.assigned_at ?? insight['delivered_at'] ?? insight['created_at']
      if (!(start instanceof Date) || now.getTime() - start.getTime() < Number(collaboration.sla_minutes) * 60_000) continue
      await this.db.collection('insights').updateOne({ _id: insight['_id'] }, { $set: { 'collaboration.sla_breached_at': now } })
      await this.db.collection('system_events').insertOne({ tenant_id: insight['tenant_id'], type: 'insight.sla_breached', insight_id: insight['id'], created_at: now })
      breached++
    }
    return breached
  }
}
