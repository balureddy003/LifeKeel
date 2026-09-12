/**
 * Federated Learning Service — wires the FederatedLearning engine into
 * the actual training loop.
 *
 * The FederatedLearning class provides privacy-preserving aggregation
 * (DP noise, secure aggregation, k-anonymity, privacy budget). This
 * service wraps it with:
 *   1. Automatic gradient extraction from TenantLevelScorer
 *   2. Weekly round scheduling (cron-driven)
 *   3. Global model distribution back to tenants (warm-start)
 *   4. MongoDB persistence for rounds + global model
 *
 * Lifecycle:
 *   1. startWeeklyRound() — called by cron every Monday 4 AM
 *      - Creates a new federated round
 *      - Collects gradients from all active tenants (via scorer.extractGradient)
 *      - Submits each gradient with DP + secure aggregation
 *      - Aggregates the round (requires minCohortSize = 20 tenants)
 *      - Stores the global model in MongoDB (federated_global_models)
 *   2. On each approve/dismiss (routes/insights.ts):
 *      - The scorer.update() is called as before
 *      - No immediate FL action — gradients accumulate in the scorer
 *      - Gradients are extracted at the next weekly round
 *   3. New tenants automatically warm-start from the global model
 *      via TenantLevelScorer.tryWarmStart()
 */

import { FederatedLearning } from './federated/FederatedLearning.js'
import type { TenantLevelScorer } from './tenant-level-scorer.js'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'federated-learning-service', version: '1.0.0' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

export interface FederatedLearningServiceOptions {
  /** Minimum tenants with enough updates to participate in a round. Default: 20. */
  minParticipants?: number
  /** Minimum updates a tenant must have since last gradient submission. Default: 10. */
  minUpdatesForGradient?: number
  /** Scale factor for applying global model to tenants. Default: 0.3. */
  globalUpdateScale?: number
}

export class FederatedLearningService {
  private fl: FederatedLearning
  private db: MongoDb
  private scorer: TenantLevelScorer
  private options: Required<FederatedLearningServiceOptions>
  /** Current active round ID (null if no round in progress). */
  private currentRoundId: string | null = null

  constructor(
    db: MongoDb,
    scorer: TenantLevelScorer,
    fl?: FederatedLearning,
    options?: FederatedLearningServiceOptions,
  ) {
    this.db = db
    this.scorer = scorer
    this.fl = fl ?? new FederatedLearning()
    this.options = {
      minParticipants: options?.minParticipants ?? 20,
      minUpdatesForGradient: options?.minUpdatesForGradient ?? 10,
      globalUpdateScale: options?.globalUpdateScale ?? 0.3,
    }
  }

  /** The underlying FederatedLearning instance (for route handlers). */
  get federatedLearning(): FederatedLearning {
    return this.fl
  }

  /** Whether a federated round is currently in progress. */
  get roundInProgress(): boolean {
    return this.currentRoundId !== null
  }

  /**
   * Run a complete federated round:
   *   1. Start the round
   *   2. Collect gradients from all active tenants
   *   3. Submit each gradient with privacy hardening
   *   4. Aggregate (requires minCohortSize)
   *   5. Store the global model in MongoDB for warm-start
   *
   * Called weekly by the server cron.
   */
  async runWeeklyRound(): Promise<{
    round_id: string
    participants: number
    aggregated: boolean
    global_model_stored: boolean
  }> {
    log.info({}, 'Starting weekly federated learning round')

    // 1. Start the round
    const globalModelVersion = `global-${new Date().toISOString().slice(0, 10)}`
    const round = await this.fl.startRound(globalModelVersion)
    this.currentRoundId = round.round_id

    try {
      // 2. Find all active tenants with recent model updates
      const tenantIds = await this.getActiveTenants()
      log.info({ tenant_count: tenantIds.length }, 'Found active tenants for federated round')

      if (tenantIds.length < this.options.minParticipants) {
        log.warn(
          { tenant_count: tenantIds.length, min_required: this.options.minParticipants },
          'Federated round aborted — insufficient participants for k-anonymity',
        )
        return {
          round_id: round.round_id,
          participants: 0,
          aggregated: false,
          global_model_stored: false,
        }
      }

      // 3. Collect + submit gradients from each tenant
      const peerTenantIds = tenantIds // all tenants are peers for secure aggregation
      let submittedCount = 0
      const aggregatedGradients: { indices: number[]; deltas: number[]; sampleCount: number }[] = []

      for (const tenantId of tenantIds) {
        try {
          const gradient = await this.scorer.extractGradient(tenantId)
          if (gradient.sampleCount < this.options.minUpdatesForGradient) {
            continue // skip tenants with too few updates
          }

          // Convert sparse gradient to dense for the FL engine
          // (the FL engine expects a full gradient vector)
          const denseGradient = this.sparseToDense(gradient.indices, gradient.deltas)

          await this.fl.submitGradient(
            tenantId,
            round.round_id,
            denseGradient,
            gradient.sampleCount,
            0, // loss — not tracked per-tenant here; FL engine weights by sample_count
            peerTenantIds,
          )

          aggregatedGradients.push(gradient)
          this.scorer.markGradientSubmitted(tenantId)
          submittedCount++
        } catch (err) {
          // Privacy budget exceeded or other error — skip this tenant
          log.debug({ tenant_id: tenantId, err: (err as Error).message }, 'Tenant skipped from federated round')
        }
      }

      log.info({ submitted: submittedCount }, 'Gradients submitted to federated round')

      // 4. Aggregate the round
      const completedRound = await this.fl.aggregateRound(round.round_id)
      const aggregated = completedRound !== null

      // 5. Store the global model (averaged gradients) for warm-start
      let globalModelStored = false
      if (aggregated && aggregatedGradients.length > 0) {
        globalModelStored = await this.storeGlobalModel(aggregatedGradients)
        log.info({ round_id: round.round_id, participants: completedRound.participant_count }, 'Federated round completed — global model stored')
      }

      return {
        round_id: round.round_id,
        participants: submittedCount,
        aggregated,
        global_model_stored: globalModelStored,
      }
    } finally {
      this.currentRoundId = null
    }
  }

  /**
   * Find all tenants with recent model updates (last 7 days).
   * These are the candidates for the federated round.
   */
  private async getActiveTenants(): Promise<string[]> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const docs = await this.db.collection('tenant_level_models')
      .find({ last_updated_at: { $gte: cutoff } })
      .toArray() as Array<{ tenant_id?: string }>
    return docs.map(d => d.tenant_id).filter((id): id is string => typeof id === 'string')
  }

  /**
   * Store the aggregated global model in MongoDB.
   * Uses a single document with _id: 'latest' so new tenants can
   * warm-start from it via TenantLevelScorer.tryWarmStart().
   *
   * The global model is the weighted average of all tenant gradients
   * (weighted by sample count — tenants with more updates contribute more).
   */
  private async storeGlobalModel(
    gradients: Array<{ indices: number[]; deltas: number[]; sampleCount: number }>,
  ): Promise<boolean> {
    // Weighted average of sparse gradients
    const totalSamples = gradients.reduce((sum, g) => sum + g.sampleCount, 0)
    if (totalSamples === 0) return false

    const globalMap = new Map<number, number>()
    for (const g of gradients) {
      const weight = g.sampleCount / totalSamples
      for (let i = 0; i < g.indices.length; i++) {
        const idx = g.indices[i]!
        const delta = g.deltas[i]! * weight
        globalMap.set(idx, (globalMap.get(idx) ?? 0) + delta)
      }
    }

    const indices = [...globalMap.keys()].sort((a, b) => a - b)
    const deltas = indices.map(i => Math.round((globalMap.get(i) ?? 0) * 1e6) / 1e6)

    const globalCol = this.db.collection('federated_global_models')
    await globalCol.replaceOne(
      { _id: 'latest' },
      {
        _id: 'latest',
        indices,
        deltas,
        participant_count: gradients.length,
        total_samples: totalSamples,
        updated_at: new Date(),
      },
      { upsert: true },
    )

    log.info({ indices_count: indices.length, participants: gradients.length }, 'Global federated model stored')
    return true
  }

  /** Convert a sparse gradient to a dense number[] for the FL engine. */
  private sparseToDense(indices: number[], deltas: number[]): number[] {
    // Use a smaller dense vector (sampled) to keep FL engine manageable.
    // The FL engine adds DP noise proportional to vector size.
    const MAX_SIZE = 16384 // 16K — enough for sampled gradients
    const dense = new Array(MAX_SIZE).fill(0)
    for (let i = 0; i < indices.length; i++) {
      const denseIdx = indices[i]! % MAX_SIZE
      dense[denseIdx] = (dense[denseIdx] ?? 0) + deltas[i]!
    }
    return dense
  }
}
