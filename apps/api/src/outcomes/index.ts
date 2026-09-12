import type { Db } from 'mongodb'
import { MongoOutcomeRepository } from '@agentoak/mongodb-adapter'
import { LegacyGoalOutcomeBridge } from './legacy-goal-outcome-bridge.js'

export interface OutcomeCompatibilityLayer {
  repository: MongoOutcomeRepository
  legacyBridge: LegacyGoalOutcomeBridge
}

/**
 * Builds the compatibility layer without changing existing route behavior.
 * Runtime composition can call this during startup once dual-read or dual-write
 * migration is explicitly enabled.
 */
export async function createOutcomeCompatibilityLayer(db: Db): Promise<OutcomeCompatibilityLayer> {
  const repository = new MongoOutcomeRepository(db)
  await repository.ensureIndexes()
  return {
    repository,
    legacyBridge: new LegacyGoalOutcomeBridge(db, repository),
  }
}
