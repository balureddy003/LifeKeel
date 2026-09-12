/**
 * ML Tenant Isolation Tests
 *
 * Tests to verify that ML components (calibration, novelty tracking, job queues)
 * properly isolate data and execution per tenant, preventing cross-tenant leakage.
 *
 * ADR-0019: Tenant ML Isolation
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { MongoClient, Db } from 'mongodb'
import { ScoreCalibrator } from '@agentoak/engine'
import { NoveltyTracker } from '@agentoak/engine'
import { queueManager } from '../queue/QueueManager.js'

describe('ML Tenant Isolation', () => {
  let mongoClient: MongoClient
  let db: Db
  let calibrator: ScoreCalibrator
  let noveltyTracker: NoveltyTracker

  const TENANT_A = 'tenant-iso-test-a'
  const TENANT_B = 'tenant-iso-test-b'

  // Generate enough pairs to trigger real calibration (MIN_CALIBRATION_SAMPLES = 20)
  function makePairs(seed: number, count = 25): { raw_score: number; outcome: 1 | 0 }[] {
    const pairs: { raw_score: number; outcome: 1 | 0 }[] = []
    for (let i = 0; i < count; i++) {
      const pseudoRandom = Math.abs(Math.sin(seed + i))
      const raw_score = Math.round(pseudoRandom * 100) / 100
      const outcome = (i % 3 === 0 ? 0 : 1) as 1 | 0
      pairs.push({ raw_score, outcome })
    }
    return pairs
  }

  beforeEach(async () => {
    mongoClient = new MongoClient(process.env.MONGODB_URL ?? 'mongodb://localhost:27017')
    await mongoClient.connect()
    db = mongoClient.db('kairos-ml-iso-test')

    calibrator = new ScoreCalibrator(db)
    noveltyTracker = new NoveltyTracker(db)

    // Clean up test data
    await db.collection('calibration_params').deleteMany({})
    await db.collection('novelty_sketches').deleteMany({})
  })

  afterEach(async () => {
    await db.collection('calibration_params').deleteMany({})
    await db.collection('novelty_sketches').deleteMany({})
    await mongoClient.close()
  })

  describe('ScoreCalibrator Tenant Isolation', () => {
    it('should not leak calibration params between tenants', async () => {
      // Fit calibrator for tenant A
      const pairsA = makePairs(1)
      await calibrator.fit(TENANT_A, 'detector-1', pairsA)

      // Fit calibrator for tenant B with different data
      const pairsB = makePairs(42)
      await calibrator.fit(TENANT_B, 'detector-1', pairsB)

      // Verify tenant A gets its own calibration
      const calibratedA = await calibrator.calibrate(TENANT_A, 'detector-1', 0.8)
      const allParamsA = await calibrator.getAllParams(TENANT_A)
      const paramsA = allParamsA.find(p => p.detector_id === 'detector-1')

      // Verify tenant B gets its own calibration
      const calibratedB = await calibrator.calibrate(TENANT_B, 'detector-1', 0.8)
      const allParamsB = await calibrator.getAllParams(TENANT_B)
      const paramsB = allParamsB.find(p => p.detector_id === 'detector-1')

      // Calibrations should be different
      expect(calibratedA).not.toBe(calibratedB)
      expect(paramsA?.temperature).not.toBe(paramsB?.temperature)
      expect(paramsA?.temperature).not.toBe(1)
      expect(paramsB?.temperature).not.toBe(1)

      // Verify no cross-tenant data leakage
      const finalParamsA = await calibrator.getAllParams(TENANT_A)
      const finalParamsB = await calibrator.getAllParams(TENANT_B)

      expect(finalParamsA).toHaveLength(1)
      expect(finalParamsB).toHaveLength(1)
      expect(allParamsA[0]?.tenant_id).toBe(TENANT_A)
      expect(allParamsB[0]?.tenant_id).toBe(TENANT_B)
    })

    it('should isolate detector calibration within tenant', async () => {
      // Fit two detectors for same tenant
      await calibrator.fit(TENANT_A, 'detector-1', makePairs(7))
      await calibrator.fit(TENANT_A, 'detector-2', makePairs(99))

      // Verify isolation
      const allParams = await calibrator.getAllParams(TENANT_A)
      const params1 = allParams.find(p => p.detector_id === 'detector-1')
      const params2 = allParams.find(p => p.detector_id === 'detector-2')

      expect(params1?.detector_id).toBe('detector-1')
      expect(params2?.detector_id).toBe('detector-2')
      expect(params1?.temperature).not.toBe(params2?.temperature)
    })

    it('should handle missing tenant calibration gracefully', async () => {
      // Tenant A has calibration
      await calibrator.fit(TENANT_A, 'detector-1', makePairs(21))

      // Tenant B has no calibration - should return identity (T=1)
      const calibratedB = await calibrator.calibrate(TENANT_B, 'detector-1', 0.8)
      expect(calibratedB).toBe(0.8) // No calibration applied

      const allParamsB = await calibrator.getAllParams(TENANT_B)
      const paramsB = allParamsB.find(p => p.detector_id === 'detector-1')
      expect(paramsB).toBeUndefined()
    })
  })

  describe('NoveltyTracker Tenant Isolation', () => {
    it('should not leak novelty sketches between tenants', async () => {
      // Load and observe data for tenant A
      await noveltyTracker.load(TENANT_A)
      noveltyTracker.observe(TENANT_A, 'data.amount', '1000')
      noveltyTracker.observe(TENANT_A, 'data.amount', '1000')
      await noveltyTracker.flush(TENANT_A)

      // Load and observe data for tenant B
      await noveltyTracker.load(TENANT_B)
      noveltyTracker.observe(TENANT_B, 'data.amount', '1000')
      await noveltyTracker.flush(TENANT_B)

      // Reload to verify persistence
      await noveltyTracker.load(TENANT_A)
      const scoreA = noveltyTracker.score(TENANT_A, 'data.amount', '1000').novelty

      await noveltyTracker.load(TENANT_B)
      const scoreB = noveltyTracker.score(TENANT_B, 'data.amount', '1000').novelty

      // Tenant A observed twice, tenant B observed once
      // Scores should reflect different observation counts
      expect(scoreA).toBeLessThan(scoreB) // More observations = lower novelty
    })

    it('should isolate field sketches within tenant', async () => {
      await noveltyTracker.load(TENANT_A)
      noveltyTracker.observe(TENANT_A, 'field1', 'value1')
      noveltyTracker.observe(TENANT_A, 'field2', 'value1')
      await noveltyTracker.flush(TENANT_A)

      await noveltyTracker.load(TENANT_A)
      const score1 = noveltyTracker.score(TENANT_A, 'field1', 'value1').novelty
      const score2 = noveltyTracker.score(TENANT_A, 'field2', 'value1').novelty

      // Same value in different fields should have separate counts
      expect(score1).toBe(score2) // Both observed once
    })

    it('should handle missing tenant sketches gracefully', async () => {
      // Tenant A has data
      await noveltyTracker.load(TENANT_A)
      noveltyTracker.observe(TENANT_A, 'field', 'value')
      await noveltyTracker.flush(TENANT_A)

      // Tenant B has no data - should return high novelty
      await noveltyTracker.load(TENANT_B)
      const scoreB = noveltyTracker.score(TENANT_B, 'field', 'value').novelty

      expect(scoreB).toBe(1.0) // Never observed = max novelty
    })
  })

  describe('Queue Tenant Isolation', () => {
    const TEST_QUEUE = 'ml-iso-test-queue'

    beforeEach(async () => {
      await queueManager.connect()
    })

    afterEach(async () => {
      await queueManager.shutdown()
    })

    it('should include tenant_id in job payloads', async () => {
      const jobA = { tenant_id: TENANT_A, data: 'test-a' }
      const jobB = { tenant_id: TENANT_B, data: 'test-b' }

      const receivedJobs: unknown[] = []
      queueManager.subscribe(TEST_QUEUE, async (payload) => {
        receivedJobs.push(payload)
      }, { concurrency: 1 })

      await queueManager.publish(TEST_QUEUE, jobA)
      await queueManager.publish(TEST_QUEUE, jobB)

      // Wait for jobs to be processed
      await new Promise(resolve => setTimeout(resolve, 300))

      expect(receivedJobs).toHaveLength(2)
      expect((receivedJobs[0] as { tenant_id: string }).tenant_id).toBe(TENANT_A)
      expect((receivedJobs[1] as { tenant_id: string }).tenant_id).toBe(TENANT_B)
    })

    it('should prevent cross-tenant job inspection in handlers', async () => {
      const processedTenants: string[] = []

      queueManager.subscribe(TEST_QUEUE, async (payload) => {
        const job = payload as { tenant_id: string; data: string }
        processedTenants.push(job.tenant_id)

        // Simulate handler logic - should only access own tenant's data
        if (job.tenant_id !== TENANT_A && job.tenant_id !== TENANT_B) {
          throw new Error('Cross-tenant job detected')
        }
      }, { concurrency: 1 })

      await queueManager.publish(TEST_QUEUE, { tenant_id: TENANT_A, data: 'test' })
      await queueManager.publish(TEST_QUEUE, { tenant_id: TENANT_B, data: 'test' })

      await new Promise(resolve => setTimeout(resolve, 300))

      expect(processedTenants).toEqual(expect.arrayContaining([TENANT_A, TENANT_B]))
    })
  })

  describe('Cross-Component Isolation', () => {
    it('should maintain isolation across calibration and novelty tracking', async () => {
      // Tenant A: calibration and novelty
      await calibrator.fit(TENANT_A, 'detector-1', makePairs(3))
      await noveltyTracker.load(TENANT_A)
      noveltyTracker.observe(TENANT_A, 'field', 'value')
      await noveltyTracker.flush(TENANT_A)

      // Tenant B: different data
      await calibrator.fit(TENANT_B, 'detector-1', makePairs(17))
      await noveltyTracker.load(TENANT_B)
      noveltyTracker.observe(TENANT_B, 'field', 'value')
      await noveltyTracker.flush(TENANT_B)

      // Verify no cross-component leakage
      const calParamsA = await calibrator.getAllParams(TENANT_A)
      const calParamsB = await calibrator.getAllParams(TENANT_B)

      expect(calParamsA).toHaveLength(1)
      expect(calParamsB).toHaveLength(1)
      expect(calParamsA[0]?.tenant_id).toBe(TENANT_A)
      expect(calParamsB[0]?.tenant_id).toBe(TENANT_B)

      // Verify novelty isolation
      await noveltyTracker.load(TENANT_A)
      const noveltyA = noveltyTracker.score(TENANT_A, 'field', 'value').novelty

      await noveltyTracker.load(TENANT_B)
      const noveltyB = noveltyTracker.score(TENANT_B, 'field', 'value').novelty

      expect(noveltyA).toBe(noveltyB) // Both observed once
    })
  })

  describe('Tenant Isolation Under Load', () => {
    it('isolates 25 tenants writing calibration data concurrently', async () => {
      const tenantIds = Array.from({ length: 25 }, (_, i) => `load-tenant-${i}`)

      await Promise.all(
        tenantIds.map((tenantId, i) =>
          calibrator.fit(tenantId, 'detector-load', makePairs(i + 1)),
        ),
      )

      // Each tenant should only see its own calibration params.
      for (const tenantId of tenantIds) {
        const params = await calibrator.getAllParams(tenantId)
        expect(params).toHaveLength(1)
        expect(params[0]?.tenant_id).toBe(tenantId)
        expect(params[0]?.detector_id).toBe('detector-load')
      }
    })
  })
})
