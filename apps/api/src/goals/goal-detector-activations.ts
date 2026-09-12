import {
  GoalDetectorActivationMap,
  type Engine,
} from '@kairos/engine'
import type { Db } from 'mongodb'

interface GoalLike {
  id: string
  tenant_id: string
  name: string
  description?: string | undefined
  detector_ids?: string[] | undefined
  kpis?: Array<{ signal_types?: string[] | undefined }> | undefined
}

export async function refreshGoalDetectorActivations(
  db: Db,
  engine: Engine,
  goal: GoalLike,
): Promise<void> {
  const scorer = new GoalDetectorActivationMap(Number(process.env['GOAL_DETECTOR_THRESHOLD'] ?? 0.4))
  const evidenceTypes = [...new Set((goal.kpis ?? []).flatMap(kpi => kpi.signal_types ?? []))]
  const activations = engine.inventory().map(detector => scorer.score({
    goal_id: goal.id,
    name: goal.name,
    ...(goal.description !== undefined && { description: goal.description }),
    evidence_types: evidenceTypes,
    detector_ids: goal.detector_ids ?? [],
  }, {
    detector_id: detector.id,
    name: detector.name,
    ...(detector.description !== undefined && { description: detector.description }),
    evidence_types: detector.signal_types,
    industries: detector.industries,
  }))
  const manualDetectorIds = new Set((await db.collection('goal_detector_activations')
    .find({ tenant_id: goal.tenant_id, goal_id: goal.id, source: 'manual' })
    .project({ detector_id: 1 })
    .toArray()).map(record => String(record['detector_id'])))
  const computedActivations = activations.filter(activation => !manualDetectorIds.has(activation.detector_id))

  await db.collection('goal_detector_activations').deleteMany({
    tenant_id: goal.tenant_id,
    goal_id: goal.id,
    source: { $ne: 'manual' },
  })
  if (computedActivations.length > 0) {
    await db.collection('goal_detector_activations').bulkWrite(computedActivations.map(activation => ({
      updateOne: {
        filter: { tenant_id: goal.tenant_id, goal_id: goal.id, detector_id: activation.detector_id },
        update: { $set: { ...activation, tenant_id: goal.tenant_id, updated_at: new Date() } },
        upsert: true,
      },
    })))
  }
}
