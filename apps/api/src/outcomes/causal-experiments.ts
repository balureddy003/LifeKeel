import type { Db } from 'mongodb'
import type { Trigger } from '@lifekeel/engine'
import { CausalExperimentTracker } from '@lifekeel/workflows'
import { MongoMemoryRepository } from '@lifekeel/mongodb-adapter'
import { createHash, randomUUID } from 'node:crypto'

interface GoalWithKpis {
  id: string
  tenant_id: string
  kpis: Array<{ metric: string; current: number }>
}

export async function startGoalExperimentsForApproval(
  db: Db,
  insight: Trigger,
  actionReceiptIds: string[],
  approvedAt = new Date(),
): Promise<string[]> {
  const goalId = insight.feature_snapshot?.['goal_id']
  if (typeof goalId !== 'string' || actionReceiptIds.length === 0) return []

  const goal = await db.collection<GoalWithKpis>('goals').findOne({
    id: goalId,
    tenant_id: insight.tenant_id,
  })
  if (!goal) return []

  const snapshot = Object.fromEntries(goal.kpis.map(kpi => [kpi.metric, kpi.current]))
  const tracker = new CausalExperimentTracker(db)
  const memory = new MongoMemoryRepository(db)
  const experiments = await Promise.all(actionReceiptIds.map(moveId =>
    tracker.createExperiment(insight.tenant_id, goal.id, moveId, snapshot, approvedAt),
  ))
  const content = `${insight.detector_id} fired and was approved. ${insight.reasoning}`
  await memory.save({
    id: randomUUID(),
    tenant_id: insight.tenant_id,
    scope_type: 'detector',
    scope_id: insight.detector_id,
    memory_type: 'episodic',
    content,
    content_hash: createHash('sha256').update(content).digest('hex'),
    metadata: { trigger_id: insight.id, goal_id: goal.id, move_ids: actionReceiptIds, approved: true },
    tags: [insight.detector_id, goal.id],
    created_at: approvedAt,
    expires_at: new Date(approvedAt.getTime() + 180 * 86_400_000),
  })
  return experiments.map(experiment => experiment.experiment_id)
}
