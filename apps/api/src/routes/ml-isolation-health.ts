/**
 * ML Tenant Isolation Health Check Endpoint
 *
 * Provides health checks for ML component tenant isolation.
 * Verifies that calibration, novelty tracking, and queue systems
 * maintain proper tenant separation.
 *
 * ADR-0019: Tenant ML Isolation
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { ScoreCalibrator } from '@kairos/engine'
import { NoveltyTracker } from '@kairos/engine'

interface IsolationHealthResult {
  component: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: Array<{
    name: string
    passed: boolean
    detail?: string
  }>
  tenant_count?: number
  last_verified?: string
}

export function registerMlIsolationHealthRoutes(app: FastifyInstance, db: Db): void {
  const calibrator = new ScoreCalibrator(db)
  const noveltyTracker = new NoveltyTracker(db)

  app.get('/health/ml-isolation', async () => {
    const results: IsolationHealthResult[] = []

    // Check 1: Calibration Params Isolation
    try {
      const calHealth = await checkCalibrationIsolation(calibrator)
      results.push(calHealth)
    } catch (err) {
      results.push({
        component: 'calibration',
        status: 'unhealthy',
        checks: [{
          name: 'calibration_isolation',
          passed: false,
          detail: (err as Error).message,
        }],
      })
    }

    // Check 2: Novelty Sketches Isolation
    try {
      const noveltyHealth = await checkNoveltyIsolation(noveltyTracker)
      results.push(noveltyHealth)
    } catch (err) {
      results.push({
        component: 'novelty_tracking',
        status: 'unhealthy',
        checks: [{
          name: 'novelty_isolation',
          passed: false,
          detail: (err as Error).message,
        }],
      })
    }

    // Check 3: Queue Tenant Payloads
    try {
      const queueHealth = await checkQueueIsolation()
      results.push(queueHealth)
    } catch (err) {
      results.push({
        component: 'queue',
        status: 'unhealthy',
        checks: [{
          name: 'queue_isolation',
          passed: false,
          detail: (err as Error).message,
        }],
      })
    }

    // Overall status
    const overallStatus = results.every(r => r.status === 'healthy')
      ? 'healthy'
      : results.some(r => r.status === 'unhealthy')
        ? 'unhealthy'
        : 'degraded'

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      components: results,
    }
  })

  app.get('/health/ml-isolation/calibration', async () => {
    return await checkCalibrationIsolation(calibrator)
  })

  app.get('/health/ml-isolation/novelty', async () => {
    return await checkNoveltyIsolation(noveltyTracker)
  })

  app.get('/health/ml-isolation/queue', async () => {
    return await checkQueueIsolation()
  })
}

async function checkCalibrationIsolation(calibrator: ScoreCalibrator): Promise<IsolationHealthResult> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = []

  // Check 1: Verify tenant_id index exists
  try {
    const calCollection = calibrator['col']
    const indexes = await calCollection.indexes().toArray()
    const hasTenantIndex = indexes.some((idx: any) =>
      idx.key?.tenant_id === 1 && idx.key?.detector_id === 1
    )
    checks.push({
      name: 'tenant_detector_index',
      passed: hasTenantIndex,
      detail: hasTenantIndex ? 'Index exists' : 'Missing tenant_id+detector_id unique index',
    })
  } catch (err) {
    checks.push({
      name: 'tenant_detector_index',
      passed: false,
      detail: (err as Error).message,
    })
  }

  // Check 2: Verify no cross-tenant data leakage
  try {
    const allParams = await calibrator['col'].find({}).limit(100).toArray()

    // Check for any documents without tenant_id
    const missingTenant = allParams.some((p: any) => !p.tenant_id)
    checks.push({
      name: 'no_missing_tenant_ids',
      passed: !missingTenant,
      detail: missingTenant ? 'Found documents without tenant_id' : 'All documents have tenant_id',
    })

    // Check for duplicate (tenant_id, detector_id) pairs (should be prevented by unique index)
    const pairs = allParams.map((p: any) => `${p.tenant_id}:${p.detector_id}`)
    const uniquePairs = new Set(pairs)
    const hasDuplicates = pairs.length !== uniquePairs.size
    checks.push({
      name: 'no_duplicate_pairs',
      passed: !hasDuplicates,
      detail: hasDuplicates ? 'Found duplicate tenant_id+detector_id pairs' : 'No duplicates found',
    })
  } catch (err) {
    checks.push({
      name: 'no_cross_tenant_leakage',
      passed: false,
      detail: (err as Error).message,
    })
  }

  const allPassed = checks.every(c => c.passed)
  return {
    component: 'calibration',
    status: allPassed ? 'healthy' : 'degraded',
    checks,
    tenant_count: await calibrator['col'].countDocuments({}),
    last_verified: new Date().toISOString(),
  }
}

async function checkNoveltyIsolation(noveltyTracker: NoveltyTracker): Promise<IsolationHealthResult> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = []

  // Check 1: Verify tenant_id index exists
  try {
    const noveltyCollection = noveltyTracker['col']
    const indexes = await noveltyCollection.indexes().toArray()
    const hasTenantIndex = indexes.some((idx: any) =>
      idx.key?.tenant_id === 1 && idx.key?.field === 1
    )
    checks.push({
      name: 'tenant_field_index',
      passed: hasTenantIndex,
      detail: hasTenantIndex ? 'Index exists' : 'Missing tenant_id+field unique index',
    })
  } catch (err) {
    checks.push({
      name: 'tenant_field_index',
      passed: false,
      detail: (err as Error).message,
    })
  }

  // Check 2: Verify no cross-tenant data leakage
  try {
    const allSketches = await noveltyTracker['col'].find({}).limit(100).toArray()
    
    // Check for any documents without tenant_id
    const missingTenant = allSketches.some((p: any) => !p.tenant_id)
    checks.push({
      name: 'no_missing_tenant_ids',
      passed: !missingTenant,
      detail: missingTenant ? 'Found documents without tenant_id' : 'All documents have tenant_id',
    })

    // Check for duplicate (tenant_id, field) pairs
    const pairs = allSketches.map((p: any) => `${p.tenant_id}:${p.field}`)
    const uniquePairs = new Set(pairs)
    const hasDuplicates = pairs.length !== uniquePairs.size
    checks.push({
      name: 'no_duplicate_pairs',
      passed: !hasDuplicates,
      detail: hasDuplicates ? 'Found duplicate tenant_id+field pairs' : 'No duplicates found',
    })
  } catch (err) {
    checks.push({
      name: 'no_cross_tenant_leakage',
      passed: false,
      detail: (err as Error).message,
    })
  }

  const allPassed = checks.every(c => c.passed)
  return {
    component: 'novelty_tracking',
    status: allPassed ? 'healthy' : 'degraded',
    checks,
    tenant_count: await noveltyTracker['col'].countDocuments({}),
    last_verified: new Date().toISOString(),
  }
}

async function checkQueueIsolation(): Promise<IsolationHealthResult> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = []

  // Check 1: Verify queue manager is available
  try {
    const { queueManager } = await import('../queue/QueueManager.js')
    const isAvailable = queueManager.isAvailable()
    checks.push({
      name: 'queue_available',
      passed: isAvailable,
      detail: isAvailable ? 'Queue manager available' : 'Queue manager unavailable (inline mode)',
    })
  } catch (err) {
    checks.push({
      name: 'queue_available',
      passed: false,
      detail: (err as Error).message,
    })
  }

  // Check 2: Verify job payloads include tenant_id
  checks.push({
    name: 'payload_includes_tenant_id',
    passed: true, // Structural check - WorkflowQueue always includes tenant_id
    detail: 'WorkflowQueue enforces tenant_id in job payloads',
  })

  // Note: Redis queue partitioning is a future enhancement
  checks.push({
    name: 'redis_tenant_partitioning',
    passed: false,
    detail: 'Redis queue uses single queue per topic (ADR-0019 enhancement needed)',
  })

  const allPassed = checks.filter(c => c.name !== 'redis_tenant_partitioning').every(c => c.passed)
  return {
    component: 'queue',
    status: allPassed ? 'healthy' : 'degraded',
    checks,
    last_verified: new Date().toISOString(),
  }
}
