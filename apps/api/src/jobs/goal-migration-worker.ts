import type { Db } from 'mongodb'
import { createOutcomeCompatibilityLayer } from '../outcomes/index.js'

export interface GoalMigrationResult {
  tenant_id: string
  attempted: number
  migrated: number
  failed: number
}

const DEFAULT_GOAL_MIGRATION_ENABLED = process.env['GOAL_MIGRATION_ENABLED'] !== 'false'

export class GoalMigrationWorker {
  private readonly enabled: boolean

  constructor(private readonly db: Db, enabled = DEFAULT_GOAL_MIGRATION_ENABLED) {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  async migrateNextBatch(tenantId: string, batchSize = 50): Promise<GoalMigrationResult> {
    if (!this.enabled) {
      return { tenant_id: tenantId, attempted: 0, migrated: 0, failed: 0 }
    }

    const goals = await this.db.collection('goals')
      .find({ tenant_id: tenantId, migrated: { $ne: true } })
      .sort({ created_at: 1 })
      .limit(batchSize)
      .toArray()
    const layer = await createOutcomeCompatibilityLayer(this.db)
    let migrated = 0
    let failed = 0
    for (const goal of goals) {
      try {
        const contract = await layer.legacyBridge.migrateGoal(tenantId, String(goal['id']))
        if (!contract) {
          failed++
          continue
        }
        await this.db.collection('goals').updateOne(
          { tenant_id: tenantId, id: goal['id'] },
          { $set: {
            migrated: true,
            migrated_at: new Date(),
            outcome_contract_id: contract.id,
          } },
        )
        migrated++
      } catch {
        failed++
      }
    }
    return { tenant_id: tenantId, attempted: goals.length, migrated, failed }
  }

  async runAllTenants(batchSize = 50): Promise<GoalMigrationResult[]> {
    if (!this.enabled) {
      return []
    }

    const tenants = await this.db.collection('goals').distinct('tenant_id', { migrated: { $ne: true } })
    return Promise.all(tenants.map(tenantId => this.migrateNextBatch(String(tenantId), batchSize)))
  }
}
