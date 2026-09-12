import type { Db } from 'mongodb'

export class EscalationWorker {
  constructor(private readonly db: Db) {}
  async run(now = new Date()): Promise<number> {
    const preferences = await this.db.collection('delivery_preferences').find({ 'escalation.timeout_minutes': { $gt: 0 } }).toArray()
    let queued = 0
    for (const preference of preferences) {
      const escalation = preference['escalation'] as { timeout_minutes: number; escalation_channel: string; escalation_target?: string }
      const cutoff = new Date(now.getTime() - escalation.timeout_minutes * 60_000)
      const insights = await this.db.collection('insights').find({ tenant_id: preference['tenant_id'], state: 'sent', delivered_at: { $lte: cutoff }, escalated_at: { $exists: false } }).toArray()
      for (const insight of insights) {
        await this.db.collection('delivery_queue').insertOne({ tenant_id: preference['tenant_id'], insight_id: insight['id'], channel: escalation.escalation_channel, target: escalation.escalation_target, escalation: true, status: 'queued', created_at: now })
        await this.db.collection('insights').updateOne({ _id: insight['_id'] }, { $set: { escalated_at: now } })
        queued++
      }
    }
    return queued
  }
}
