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
        // OAK-003: the "not already escalated" check must live in the
        // filter of the atomic write that claims it, not in the find()
        // above — that find() and this write used to be a separate
        // insertOne+updateOne pair, so two API replicas running this same
        // */15-minute cron could both pass the find() before either
        // claimed the insight, and both enqueue a duplicate crisis-
        // escalation delivery. findOneAndUpdate with escalated_at in the
        // filter means only one replica's write can ever match.
        const claimed = await this.db.collection('insights').findOneAndUpdate(
          { _id: insight['_id'], escalated_at: { $exists: false } },
          { $set: { escalated_at: now } },
        )
        if (!claimed) continue
        await this.db.collection('delivery_queue').insertOne({ tenant_id: preference['tenant_id'], insight_id: insight['id'], channel: escalation.escalation_channel, target: escalation.escalation_target, escalation: true, status: 'queued', created_at: now })
        queued++
      }
    }
    return queued
  }
}
