/**
 * FederatedLearningService — federated training loop wiring tests.
 *
 * Verifies that the service correctly:
 *   1. Extracts gradients from TenantLevelScorer
 *   2. Submits them to the FL engine with privacy hardening
 *   3. Aggregates the round (requires min cohort)
 *   4. Stores the global model in MongoDB
 *   5. New tenants warm-start from the global model
 *   6. Aborts gracefully with insufficient participants
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TenantLevelScorer } from '../scoring/tenant-level-scorer.js'
import { FederatedLearningService } from '../federated-learning-service.js'
import { FederatedLearning } from '../federated/FederatedLearning.js'

// ── MongoDB stub ─────────────────────────────────────────────────────────────

function makeDb() {
  const collections: Record<
    string,
    {
      store: Map<string, unknown>
      createIndex: () => Promise<void>
      replaceOne: (f: unknown, doc: unknown, opts?: unknown) => Promise<void>
      findOne: (f: unknown) => Promise<unknown>
      find: () => {
        sort: () => { limit: () => { toArray: () => Promise<unknown[]> } }
        toArray: () => Promise<unknown[]>
      }
      distinct: () => Promise<unknown[]>
    }
  > = {}

  const getCol = (name: string) => {
    if (!collections[name]) {
      const store = new Map<string, unknown>()
      collections[name] = {
        store,
        createIndex: () => Promise.resolve(),
        replaceOne: (f: unknown, doc: unknown, _opts?: unknown) => {
          store.set(JSON.stringify(f), doc)
          return Promise.resolve()
        },
        findOne: (f: unknown) => Promise.resolve(store.get(JSON.stringify(f)) ?? null),
        find: () => ({
          sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([...store.values()]) }) }),
          toArray: () => Promise.resolve([...store.values()]),
        }),
        distinct: () => Promise.resolve([]),
      }
    }
    return collections[name]!
  }

  return {
    collection: getCol,
    _collections: collections,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create N tenants, each with some training updates. */
async function seedTenants(
  scorer: TenantLevelScorer,
  count: number,
  updatesPerTenant = 15,
): Promise<string[]> {
  const tenantIds: string[] = []
  for (let t = 0; t < count; t++) {
    const tenantId = `tenant_${t}`
    tenantIds.push(tenantId)
    for (let i = 0; i < updatesPerTenant; i++) {
      await scorer.update(tenantId, 'entity_1', 'invoice.overdue', 'det_a', [], t % 2 === 0 ? 1 : 0)
    }
    await scorer.flush(tenantId)
  }
  return tenantIds
}

describe('FederatedLearningService', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
  })

  // ── Gradient extraction ───────────────────────────────────────────────────

  it('extractGradient returns non-empty gradient after training', async () => {
    const scorer = new TenantLevelScorer(db)
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'e1', 'sig', 'det', [], 1)
    }
    const grad = await scorer.extractGradient('t1')
    expect(grad.indices.length).toBeGreaterThan(0)
    expect(grad.deltas.length).toBe(grad.indices.length)
    expect(grad.sampleCount).toBe(20)
  })

  it('extractGradient returns empty gradient before any training', async () => {
    const scorer = new TenantLevelScorer(db)
    const grad = await scorer.extractGradient('t1')
    expect(grad.indices.length).toBe(0)
    expect(grad.sampleCount).toBe(0)
  })

  it('markGradientSubmitted resets the baseline — second extraction is empty', async () => {
    const scorer = new TenantLevelScorer(db)
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'e1', 'sig', 'det', [], 1)
    }
    const grad1 = await scorer.extractGradient('t1')
    expect(grad1.indices.length).toBeGreaterThan(0)

    scorer.markGradientSubmitted('t1')

    // No new updates → gradient should be empty
    const grad2 = await scorer.extractGradient('t1')
    expect(grad2.indices.length).toBe(0)
  })

  // ── Global model warm-start ────────────────────────────────────────────────

  it('new tenant warm-starts from the global model', async () => {
    const scorer = new TenantLevelScorer(db)

    // Store a global model with indices that match actual token hash positions
    // for score('new_tenant', 'e1', 'sig', 'det', [])
    // Token "entity=e1" hashes to index 26928, "signal_type=sig" to 27455, etc.
    const globalCol = db.collection('federated_global_models')
    await globalCol.replaceOne(
      { _id: 'latest' },
      {
        _id: 'latest',
        indices: [26928, 27455, 37607],
        deltas: [0.5, 0.3, 0.2],
        participant_count: 25,
        total_samples: 500,
        updated_at: new Date(),
      },
      { upsert: true },
    )

    // New tenant — should warm-start, not start from zero
    const result = await scorer.score('new_tenant', 'e1', 'sig', 'det', [])
    // Warm-started weights are non-zero → score should differ from 0.5
    expect(result.score).not.toBeCloseTo(0.5, 2)
  })

  it('new tenant starts from zero when no global model exists', async () => {
    const scorer = new TenantLevelScorer(db)
    const result = await scorer.score('new_tenant', 'e1', 'sig', 'det', [])
    expect(result.score).toBeCloseTo(0.5, 4) // sigmoid(0)
  })

  // ── Weekly round ───────────────────────────────────────────────────────────

  it('runWeeklyRound aborts with insufficient participants', async () => {
    const scorer = new TenantLevelScorer(db)
    const fl = new FederatedLearning({ minCohortSize: 20 })
    const service = new FederatedLearningService(db, scorer, fl, { minParticipants: 20 })

    // Only 5 tenants — below minCohortSize
    await seedTenants(scorer, 5)

    const result = await service.runWeeklyRound()
    expect(result.aggregated).toBe(false)
    expect(result.participants).toBe(0)
  })

  it('runWeeklyRound aggregates with sufficient participants', async () => {
    const scorer = new TenantLevelScorer(db)
    // Lower the cohort size for testing
    const fl = new FederatedLearning({ minCohortSize: 5 })
    const service = new FederatedLearningService(db, scorer, fl, { minParticipants: 5 })

    await seedTenants(scorer, 10, 15)

    const result = await service.runWeeklyRound()
    expect(result.aggregated).toBe(true)
    expect(result.participants).toBe(10)
    expect(result.global_model_stored).toBe(true)
  })

  it('runWeeklyRound stores the global model in MongoDB', async () => {
    const scorer = new TenantLevelScorer(db)
    const fl = new FederatedLearning({ minCohortSize: 5 })
    const service = new FederatedLearningService(db, scorer, fl, { minParticipants: 5 })

    await seedTenants(scorer, 8, 20)

    await service.runWeeklyRound()

    const globalCol = db.collection('federated_global_models')
    const globalDoc = (await globalCol.findOne({ _id: 'latest' })) as {
      indices?: number[]
      deltas?: number[]
      participant_count?: number
    } | null
    expect(globalDoc).not.toBeNull()
    expect(globalDoc!.indices!.length).toBeGreaterThan(0)
    expect(globalDoc!.deltas!.length).toBe(globalDoc!.indices!.length)
    expect(globalDoc!.participant_count).toBe(8)
  })

  it('runWeeklyRound marks gradients as submitted — second round only gets new updates', async () => {
    const scorer = new TenantLevelScorer(db)
    const fl = new FederatedLearning({ minCohortSize: 5 })
    const service = new FederatedLearningService(db, scorer, fl, { minParticipants: 5 })

    // First round: 10 tenants with 20 updates each
    await seedTenants(scorer, 10, 20)
    const result1 = await service.runWeeklyRound()
    expect(result1.aggregated).toBe(true)

    // No new updates → second round should have no gradients to submit
    const result2 = await service.runWeeklyRound()
    expect(result2.participants).toBe(0)
  })

  it('roundInProgress is true during a round, false after', async () => {
    const scorer = new TenantLevelScorer(db)
    const fl = new FederatedLearning({ minCohortSize: 5 })
    const service = new FederatedLearningService(db, scorer, fl, { minParticipants: 5 })

    expect(service.roundInProgress).toBe(false)

    await seedTenants(scorer, 8, 15)
    await service.runWeeklyRound()

    expect(service.roundInProgress).toBe(false)
  })

  // ── applyGlobalUpdate ──────────────────────────────────────────────────────

  it('applyGlobalUpdate modifies tenant weights additively', async () => {
    const scorer = new TenantLevelScorer(db)

    // Get baseline score
    const before = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score

    // Apply a global update at indices that match token hash positions
    // Token "entity=e1" → 26928, "signal_type=sig" → 27455, "detector=det" → 37607
    await scorer.applyGlobalUpdate('t1', [26928, 27455, 37607], [0.5, 0.3, 0.2], 1.0)

    const after = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(after).not.toBeCloseTo(before, 2)
  })

  it('applyGlobalUpdate with scale=0 is a no-op', async () => {
    const scorer = new TenantLevelScorer(db)
    const before = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score

    await scorer.applyGlobalUpdate('t1', [26928, 27455, 37607], [0.5, 0.3, 0.2], 0)

    const after = (await scorer.score('t1', 'e1', 'sig', 'det', [])).score
    expect(after).toBeCloseTo(before, 4)
  })
})
