/**
 * FeatureHashScorer — rollback and reset tests.
 *
 * Verifies two bug fixes:
 *   1. rollbackToVersion() actually restores weights (previously only
 *      restored the learning rate — weights were never stored per version)
 *   2. resetModel() clears weights to zero, allowing retraining from
 *      scratch when early training was corrupted
 *
 * All tests use in-memory stubs — no MongoDB required.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FeatureHashScorer } from '../feature-hash-scorer.js'

// ── MongoDB stub with versions collection support ───────────────────────────

function makeDb() {
  const models = new Map<string, unknown>()
  const versions = new Map<string, unknown>()

  const makeCol = (store: Map<string, unknown>) => ({
    createIndex: () => Promise.resolve(),
    replaceOne: (filter: unknown, doc: unknown) => {
      store.set(JSON.stringify(filter), doc)
      return Promise.resolve()
    },
    findOne: (filter: unknown) => Promise.resolve(store.get(JSON.stringify(filter)) ?? null),
    find: () => ({
      sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([...store.values()]) }) }),
      toArray: () => Promise.resolve([...store.values()]),
    }),
    distinct: () => Promise.resolve([]),
    deleteOne: (filter: unknown) => { store.delete(JSON.stringify(filter)); return Promise.resolve({}) },
    deleteMany: (filter: unknown) => {
      // Simple filter: { tenant_id, detector_id } — delete matching
      const f = filter as Record<string, unknown>
      for (const key of [...store.keys()]) {
        const doc = store.get(key) as Record<string, unknown> | undefined
        if (!doc) continue
        if (f.tenant_id && doc.tenant_id !== f.tenant_id) continue
        if (f.detector_id && doc.detector_id !== f.detector_id) continue
        store.delete(key)
      }
      return Promise.resolve({})
    },
  })

  const collections: Record<string, ReturnType<typeof makeCol>> = {
    feature_hash_models: makeCol(models),
    feature_hash_model_versions: makeCol(versions),
  }

  return {
    collection: (name: string) => collections[name] ?? makeCol(new Map()),
    _versions: versions,
  }
}

const CONFIG = { features: ['data.x'], l1_reg: 0, l2_reg: 0 }

describe('FeatureHashScorer rollback and reset', () => {
  let db: ReturnType<typeof makeDb>

  beforeEach(() => {
    db = makeDb()
  })

  // ── rollbackToVersion ──────────────────────────────────────────────────────

  it('rollbackToVersion restores weights from the version snapshot', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })

    // Train the model with 100 positive updates → weights change
    const before = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    for (let i = 0; i < 100; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 1, CONFIG)
    }
    const after100 = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    expect(after100).toBeGreaterThan(before)

    // Version 1 should have been created at update 100
    const versions = scorer.getModelVersions('t1', 'det')
    expect(versions.length).toBeGreaterThanOrEqual(1)
    const v1 = versions[0]!

    // Train with 100 more updates → weights change further
    for (let i = 0; i < 100; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 0, CONFIG) // negative signal
    }
    const after200 = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    expect(after200).toBeLessThan(after100)

    // Rollback to version 1 — weights should be restored
    await scorer.rollbackToVersion('t1', 'det', v1.version)
    const restored = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    // Restored score should match the score at version 1 (after100), not after200
    expect(restored).toBeCloseTo(after100, 2)
    expect(restored).not.toBeCloseTo(after200, 2)
  })

  it('rollbackToVersion throws for unknown version', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })
    await scorer.score('t1', 'det', { x: 1 }, CONFIG)

    // No versions created yet (need 100 updates)
    await expect(scorer.rollbackToVersion('t1', 'det', 999)).rejects.toThrow(/No versions found/)
  })

  it('rollbackToVersion throws for non-existent version number', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })
    // Create version 1
    for (let i = 0; i < 100; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 1, CONFIG)
    }

    await expect(scorer.rollbackToVersion('t1', 'det', 999)).rejects.toThrow(/Version 999 not found/)
  })

  // ── resetModel ─────────────────────────────────────────────────────────────

  it('resetModel zeros out weights and resets update count', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })

    // Train the model → weights become non-zero
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 1, CONFIG)
    }
    const trained = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    expect(trained).toBeGreaterThan(0.5) // sigmoid(0) = 0.5, trained > 0.5

    // Reset
    await scorer.resetModel('t1', 'det')

    // Score should be back to 0.5 (sigmoid(0) with zero weights)
    const reset = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    expect(reset).toBeCloseTo(0.5, 4)
  })

  it('resetModel clears model versions', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })

    // Create version 1
    for (let i = 0; i < 100; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 1, CONFIG)
    }
    expect(scorer.getModelVersions('t1', 'det').length).toBeGreaterThanOrEqual(1)

    await scorer.resetModel('t1', 'det')
    expect(scorer.getModelVersions('t1', 'det').length).toBe(0)
  })

  it('resetModel allows retraining from scratch', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })

    // Train with positive signal
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 1, CONFIG)
    }
    const positiveScore = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    expect(positiveScore).toBeGreaterThan(0.5)

    // Reset
    await scorer.resetModel('t1', 'det')

    // Retrain with negative signal → should go below 0.5
    for (let i = 0; i < 20; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 0, CONFIG)
    }
    const negativeScore = (await scorer.score('t1', 'det', { x: 1 }, CONFIG)).score
    expect(negativeScore).toBeLessThan(0.5)
  })

  it('resetModel prunes old version snapshots from the versions collection', async () => {
    const scorer = new FeatureHashScorer(db, { maxLoadedModels: 10 })

    for (let i = 0; i < 100; i++) {
      await scorer.update('t1', 'det', { x: 1 }, 1, CONFIG)
    }
    expect(db._versions.size).toBeGreaterThanOrEqual(1)

    await scorer.resetModel('t1', 'det')
    expect(db._versions.size).toBe(0)
  })
})
