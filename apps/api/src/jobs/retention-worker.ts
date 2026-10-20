import type { Db } from 'mongodb'

export interface DataRetention {
  events_days: number
  insights_days: number
  workflow_runs_days: number
  agent_memory_days: number
}

const DEFAULT_RETENTION: DataRetention = {
  events_days: 90,
  insights_days: 180,
  workflow_runs_days: 90,
  agent_memory_days: 365,
}

export class RetentionWorker {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.db.collection('signals').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      this.db.collection('insights').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      this.db.collection('workflow_runs').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
      this.db.collection('agent_memory').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    ])
  }

  async run(): Promise<Record<string, number>> {
    const tenants = await this.db
      .collection('tenants')
      .find({ status: { $ne: 'erased' } })
      .toArray()
    const deleted: Record<string, number> = {}
    for (const tenant of tenants) {
      const tenantId = String(tenant['tenant_id'] ?? tenant['id'])
      const retention = normalizeRetention(
        tenant['data_retention'] as Partial<DataRetention> | undefined,
      )
      const classes = [
        ['signals', 'created_at', retention.events_days],
        ['insights', 'created_at', retention.insights_days],
        ['workflow_runs', 'created_at', retention.workflow_runs_days],
        ['agent_memory', 'created_at', retention.agent_memory_days],
      ] as const
      for (const [collection, dateField, days] of classes) {
        const result = await this.db.collection(collection).deleteMany({
          tenant_id: tenantId,
          [dateField]: { $lt: new Date(Date.now() - days * 86_400_000) },
        })
        deleted[collection] = (deleted[collection] ?? 0) + result.deletedCount
      }
    }
    return deleted
  }
}

function normalizeRetention(value: Partial<DataRetention> | undefined): DataRetention {
  return {
    events_days: clamp(value?.events_days, DEFAULT_RETENTION.events_days, 30, 365),
    insights_days: clamp(value?.insights_days, DEFAULT_RETENTION.insights_days, 30, 365),
    workflow_runs_days: clamp(
      value?.workflow_runs_days,
      DEFAULT_RETENTION.workflow_runs_days,
      30,
      365,
    ),
    agent_memory_days: clamp(
      value?.agent_memory_days,
      DEFAULT_RETENTION.agent_memory_days,
      30,
      730,
    ),
  }
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value ?? fallback))
}
