import type { Db } from 'mongodb'
import type { OutcomeContract } from '@agentoak/specifications'
import type { OutcomeRepository } from '@agentoak/runtime'
import {
  legacyGoalToOutcomeContract,
  type LegacyEvidenceObservation,
  type LegacyGoal,
} from '@agentoak/legacy-compat'

interface GoalKpiSnapshot {
  tenant_id: string
  goal_id: string
  metric: string
  value: number
  source?: string
  recorded_at: Date
}

/**
 * Compatibility bridge used while the legacy goals collection and the open
 * Outcome Contract repository coexist. It is intentionally not registered as a
 * route or scheduler; callers decide when migration or synchronization occurs.
 */
export class LegacyGoalOutcomeBridge {
  constructor(
    private readonly db: Db,
    private readonly outcomes: OutcomeRepository,
  ) {}

  async migrateGoal(tenantId: string, goalId: string): Promise<OutcomeContract | null> {
    const goal = await this.db.collection<LegacyGoal>('goals').findOne({
      tenant_id: tenantId,
      id: goalId,
    })
    if (!goal) return null

    const [evidence, connectedProviders] = await Promise.all([
      this.latestEvidence(tenantId, goalId),
      this.db.collection('connector_credentials').distinct('connector_id', { tenant_id: tenantId }),
    ])

    const contract = legacyGoalToOutcomeContract(goal, {
      evidence,
      connected_providers: connectedProviders.filter(
        (provider): provider is string => typeof provider === 'string' && provider.length > 0,
      ),
    })
    await this.outcomes.save(contract)
    return contract
  }

  async migrateTenant(tenantId: string): Promise<OutcomeContract[]> {
    const goals = await this.db.collection<LegacyGoal>('goals')
      .find({ tenant_id: tenantId })
      .toArray()
    const migrated = await Promise.all(goals.map(goal => this.migrateGoal(tenantId, goal.id)))
    return migrated.filter((contract): contract is OutcomeContract => contract !== null)
  }

  private async latestEvidence(tenantId: string, goalId: string): Promise<LegacyEvidenceObservation[]> {
    const snapshots = await this.db.collection<GoalKpiSnapshot>('goal_kpi_snapshots')
      .find({ tenant_id: tenantId, goal_id: goalId })
      .sort({ recorded_at: -1 })
      .toArray()

    const latest = new Map<string, LegacyEvidenceObservation>()
    for (const snapshot of snapshots) {
      if (latest.has(snapshot.metric)) continue
      latest.set(snapshot.metric, {
        metric: snapshot.metric,
        source: snapshot.source ?? 'goal_kpi_snapshots',
        observed_at: snapshot.recorded_at,
        state: 'measured',
        value: snapshot.value,
      })
    }
    return [...latest.values()]
  }
}
