import type { Db } from 'mongodb'
import { recordJobRun } from './job-runs.js'

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

/** Fixed windows for records not owned by one active household (R23). */
export const PLATFORM_RETENTION_DAYS = {
  leads: 730,
  lifecycle_sends: 730,
  growth_events: 395,
  stripe_webhook_events: 400,
  family_invite_sends: 7,
  /** UK record-keeping for company accounts: 6 years after the end of the financial year. */
  billing_after_deletion: 7 * 365,
} as const

/**
 * Age-based sweep of DERIVED data only: signals, insights, workflow runs and
 * agent memory. It never touches a family's documents, vault, profile or
 * roster: those are deleted only when the family deletes them or their
 * account (PRD-146 amendment 3, CLAUDE.md rule 1). Defaults are documented in
 * docs/data-retention.md.
 */
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
    Object.assign(deleted, await this.sweepPlatformRecords())
    // Evidence that a sweep ran and what it removed (counts only; PRD-146).
    await recordJobRun(this.db, 'retention', deleted)
    return deleted
  }

  /**
   * Records keyed by email or event rather than by an active household
   * (R23). Each window is in docs/data-retention.md with its reason.
   */
  private async sweepPlatformRecords(): Promise<Record<string, number>> {
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000)
    const out: Record<string, number> = {}
    const sweep = async (collection: string, filter: Record<string, unknown>) => {
      const r = await this.db.collection(collection).deleteMany(filter)
      out[collection] = (out[collection] ?? 0) + r.deletedCount
    }
    // Marketing contacts with no activity for two years.
    await sweep('leads', {
      $or: [
        { updated_at: { $lt: ago(PLATFORM_RETENTION_DAYS.leads) } },
        { updated_at: { $exists: false }, created_at: { $lt: ago(PLATFORM_RETENTION_DAYS.leads) } },
      ],
    })
    await sweep('lifecycle_sends', { created_at: { $lt: ago(PLATFORM_RETENTION_DAYS.lifecycle_sends) } })
    await sweep('growth_events', { created_at: { $lt: ago(PLATFORM_RETENTION_DAYS.growth_events) } })
    await sweep('stripe_webhook_events', {
      status: 'completed',
      processed_at: { $lt: ago(PLATFORM_RETENTION_DAYS.stripe_webhook_events) },
    })
    await sweep('family_invite_sends', { created_at: { $lt: ago(PLATFORM_RETENTION_DAYS.family_invite_sends) } })

    // Billing evidence of a deleted household is kept for the tax period,
    // then the ledger and the payment-provider identifiers go too.
    const expired = await this.db
      .collection('tenants')
      .find(
        { status: 'deleted', deleted_at: { $lt: ago(PLATFORM_RETENTION_DAYS.billing_after_deletion) } },
        { projection: { tenant_id: 1 } },
      )
      .toArray()
    if (expired.length > 0) {
      const ids = expired.map((t) => String(t['tenant_id']))
      await sweep('credit_ledger', { tenant_id: { $in: ids } })
      await this.db.collection('tenants').updateMany(
        { tenant_id: { $in: ids } },
        { $unset: { stripe_customer_id: '', stripe_subscription_id: '', billing: '' } },
      )
    }
    return out
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
