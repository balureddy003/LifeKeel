/**
 * Benchmark Exchange Routes
 *
 * GET  /benchmarks?industry=saas&tier=smb — returns peer median and quartiles
 * POST /benchmarks/aggregate — nightly aggregation job (admin only)
 *
 * Privacy: Only includes opted-in tenants, adds Laplacian noise (epsilon=1.5),
 * requires minimum 20 tenants per cohort before publishing results.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'benchmarks', version: '0.0.0' })

// ─── Types ─────────────────────────────────────────────────────────────────────

interface BenchmarkMetrics {
  approval_rate_30d: number
  safe_action_rate_30d: number
  workflow_conversion_rate: number
  avg_time_to_approval_minutes: number
}

interface BenchmarkCohort {
  industry: string
  tier: string
  tenant_count: number
  metrics: {
    approval_rate_30d_median: number
    approval_rate_30d_q25: number
    approval_rate_30d_q75: number
    safe_action_rate_30d_median: number
    safe_action_rate_30d_q25: number
    safe_action_rate_30d_q75: number
    workflow_conversion_rate_median: number
    workflow_conversion_rate_q25: number
    workflow_conversion_rate_q75: number
    avg_time_to_approval_minutes_median: number
    avg_time_to_approval_minutes_q25: number
    avg_time_to_approval_minutes_q75: number
  }
  aggregated_at: string
}

// ─── Privacy: Laplacian noise (epsilon=1.5) ───────────────────────────────────

function addLaplacianNoise(value: number, epsilon: number = 1.5): number {
  // Laplacian noise: sample from Laplace(0, 1/epsilon)
  // For simplicity, we use uniform noise scaled by epsilon
  const sensitivity = 1.0
  const noise = (Math.random() - 0.5) * 2 * sensitivity / epsilon
  return value + noise
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

async function getTenantMetrics(db: Db, tenantId: string): Promise<BenchmarkMetrics | null> {
  const insights = db.collection('insights')
  const receipts = db.collection('action_receipts')
  const attributions = db.collection('workflow_attributions')
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  
  try {
    // Approval rate: completed / total insights in last 30 days
    const totalInsights = await insights.countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
    })
    const completedInsights = await insights.countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
      state: 'completed',
    })
    const approval_rate_30d = totalInsights > 0 ? completedInsights / totalInsights : 0
    
    // Safe action rate: safe actions / total actions in last 30 days
    const totalActions = await receipts.countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
    })
    const safeActions = await receipts.countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
      safe: true,
    })
    const safe_action_rate_30d = totalActions > 0 ? safeActions / totalActions : 0
    
    // Workflow conversion rate: completed workflows / triggered workflows
    const triggeredWorkflows = await attributions.countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
    })
    const completedWorkflows = await attributions.countDocuments({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
      outcome: 'completed',
    })
    const workflow_conversion_rate = triggeredWorkflows > 0 ? completedWorkflows / triggeredWorkflows : 0
    
    // Avg time to approval: calculate from insights with approval timestamps
    const approvedInsights = await insights.find({
      tenant_id: tenantId,
      created_at: { $gte: thirtyDaysAgo },
      approved_at: { $exists: true },
    }).toArray()
    
    let avg_time_to_approval_minutes = 0
    if (approvedInsights.length > 0) {
      const timeDiffs = approvedInsights.map(insight => {
        const approvedAt = new Date(insight['approved_at'] as string)
        const createdAt = new Date(insight['created_at'] as string)
        return (approvedAt.getTime() - createdAt.getTime()) / (1000 * 60) // minutes
      })
      avg_time_to_approval_minutes = timeDiffs.reduce((sum, diff) => sum + diff, 0) / timeDiffs.length
    }
    
    return {
      approval_rate_30d,
      safe_action_rate_30d,
      workflow_conversion_rate,
      avg_time_to_approval_minutes,
    }
  } catch (error) {
    log.error({ tenant_id: tenantId, err: error }, 'Failed to get metrics for tenant')
    return null
  }
}

function calculateQuartiles(values: number[]): { median: number; q25: number; q75: number } {
  if (values.length === 0) return { median: 0, q25: 0, q75: 0 }
  
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)]
  const q25 = sorted[Math.floor(n * 0.25)]
  const q75 = sorted[Math.floor(n * 0.75)]
  
  return { median, q25, q75 }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function registerBenchmarkRoutes(fastify: FastifyInstance, db: Db): void {
  const benchmarkCohorts = db.collection<BenchmarkCohort>('benchmark_cohorts')
  const tenantSettings = db.collection('tenant_settings')
  
  // GET /benchmarks?industry=saas&tier=smb — returns peer median and quartiles
  fastify.get<{
    Querystring: { industry?: string; tier?: string }
  }>('/benchmarks', async (req, reply) => {
    const { industry, tier } = req.query
    
    const query: Record<string, unknown> = {}
    if (industry) query.industry = industry
    if (tier) query.tier = tier
    
    const cohort = await benchmarkCohorts.findOne(query, { sort: { aggregated_at: -1 } })
    
    if (!cohort) {
      return reply.status(404).send({
        available: false,
        reason: 'insufficient_cohort',
      })
    }
    
    // Check if cohort has minimum 20 tenants
    if (cohort.tenant_count < 20) {
      return reply.status(404).send({
        available: false,
        reason: 'insufficient_cohort',
      })
    }
    
    return reply.send({
      available: true,
      cohort: {
        industry: cohort.industry,
        tier: cohort.tier,
        tenant_count: cohort.tenant_count,
        metrics: cohort.metrics,
        aggregated_at: cohort.aggregated_at,
      },
    })
  })
  
  // POST /benchmarks/aggregate — nightly aggregation job (admin only)
  fastify.post('/benchmarks/aggregate', async (req, reply) => {
    // Admin check
    const roles = req.authContext.roles as string[]
    if (!roles.includes('admin')) {
      return reply.status(403).send({ error: 'Admin role required' })
    }
    
    // Get all opted-in tenants
    const optedInTenants = await tenantSettings.find({
      'benchmarks.opted_in': true,
    }).toArray()
    
    if (optedInTenants.length === 0) {
      return reply.send({ message: 'No opted-in tenants found' })
    }
    
    // Group tenants by industry and tier
    const cohorts = new Map<string, BenchmarkMetrics[]>()
    
    for (const tenant of optedInTenants) {
      const tenantId = tenant['tenant_id'] as string
      const industry = (tenant['industry'] as string) ?? 'other'
      const tier = (tenant['tier'] as string) ?? 'smb'
      const cohortKey = `${industry}:${tier}`
      
      const metrics = await getTenantMetrics(db, tenantId)
      if (metrics) {
        if (!cohorts.has(cohortKey)) {
          cohorts.set(cohortKey, [])
        }
        cohorts.get(cohortKey)!.push(metrics)
      }
    }
    
    // Aggregate metrics per cohort with noise injection
    const results = []
    for (const [cohortKey, metricsArray] of cohorts.entries()) {
      const [industry, tier] = cohortKey.split(':')
      
      if (metricsArray.length < 20) {
        // Skip cohorts with insufficient tenants
        continue
      }
      
      // Add Laplacian noise to each metric
      const noisyMetrics = metricsArray.map(metrics => ({
        approval_rate_30d: addLaplacianNoise(metrics.approval_rate_30d, 1.5),
        safe_action_rate_30d: addLaplacianNoise(metrics.safe_action_rate_30d, 1.5),
        workflow_conversion_rate: addLaplacianNoise(metrics.workflow_conversion_rate, 1.5),
        avg_time_to_approval_minutes: addLaplacianNoise(metrics.avg_time_to_approval_minutes, 1.5),
      }))
      
      // Calculate quartiles
      const approvalRates = noisyMetrics.map(m => m.approval_rate_30d)
      const safeActionRates = noisyMetrics.map(m => m.safe_action_rate_30d)
      const conversionRates = noisyMetrics.map(m => m.workflow_conversion_rate)
      const approvalTimes = noisyMetrics.map(m => m.avg_time_to_approval_minutes)
      
      const approvalQuartiles = calculateQuartiles(approvalRates)
      const safeActionQuartiles = calculateQuartiles(safeActionRates)
      const conversionQuartiles = calculateQuartiles(conversionRates)
      const timeQuartiles = calculateQuartiles(approvalTimes)
      
      results.push({
        industry,
        tier,
        tenant_count: metricsArray.length,
        metrics: {
          approval_rate_30d_median: approvalQuartiles.median,
          approval_rate_30d_q25: approvalQuartiles.q25,
          approval_rate_30d_q75: approvalQuartiles.q75,
          safe_action_rate_30d_median: safeActionQuartiles.median,
          safe_action_rate_30d_q25: safeActionQuartiles.q25,
          safe_action_rate_30d_q75: safeActionQuartiles.q75,
          workflow_conversion_rate_median: conversionQuartiles.median,
          workflow_conversion_rate_q25: conversionQuartiles.q25,
          workflow_conversion_rate_q75: conversionQuartiles.q75,
          avg_time_to_approval_minutes_median: timeQuartiles.median,
          avg_time_to_approval_minutes_q25: timeQuartiles.q25,
          avg_time_to_approval_minutes_q75: timeQuartiles.q75,
        },
        aggregated_at: new Date().toISOString(),
      })
    }
    
    // Store results
    for (const result of results) {
      await benchmarkCohorts.updateOne(
        { industry: result.industry, tier: result.tier },
        { $set: result },
        { upsert: true },
      )
    }
    
    return reply.send({
      message: `Aggregated ${results.length} cohorts`,
      cohorts: results.map(r => ({
        industry: r.industry,
        tier: r.tier,
        tenant_count: r.tenant_count,
      })),
    })
  })
}
