/**
 * Entitlements API Routes
 *
 * Exposes feature availability and quota information to clients.
 * Used by the frontend to show/hide features based on plan tier.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getPlanFeatures, getEnabledFeatures, hasFeature, type Feature, type Plan } from '../entitlements.js'

export function registerEntitlementRoutes(app: FastifyInstance, db: Db): void {
  /**
   * GET /entitlements/features
   * Returns all features available for the current tenant's plan
   */
  app.get('/entitlements/features', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const tenant = await db.collection('tenants').findOne({ tenant_id })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const plan = (tenant.plan ?? 'free') as Plan
    const features = getPlanFeatures(plan)
    const enabledFeatures = getEnabledFeatures(plan)

    return {
      plan,
      features,
      enabled_features: enabledFeatures,
    }
  })

  /**
   * GET /entitlements/features/:feature
   * Check if a specific feature is enabled for the current tenant
   */
  app.get<{ Params: { feature: string } }>('/entitlements/features/:feature', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const tenant = await db.collection('tenants').findOne({ tenant_id })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const plan = (tenant.plan ?? 'free') as Plan
    const feature = req.params.feature as Feature

    const available = hasFeature(feature, plan)

    return {
      feature,
      available,
      plan,
    }
  })

  /**
   * GET /entitlements/quotas
   * Returns current usage against quotas
   */
  app.get('/entitlements/quotas', async (req, reply) => {
    const tenant_id = req.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const tenant = await db.collection('tenants').findOne({ tenant_id })
    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const quotas = tenant.quotas ?? {}
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    // Parallelize all count queries — these were sequential, adding 1-2s
    // of latency to /entitlements/quotas (called by Settings on load).
    const [events_per_month, workflows_per_month, detectors_max, connectors_max, users_max] = await Promise.all([
      db.collection('events').countDocuments({ tenant_id, created_at: { $gte: startOfMonth } }),
      db.collection('workflow_runs').countDocuments({ tenant_id, created_at: { $gte: startOfMonth } }),
      db.collection('detectors').countDocuments({ tenant_id }),
      db.collection('connector_credentials').countDocuments({ tenant_id }),
      db.collection('users').countDocuments({ tenant_id }),
    ])

    const usage = { events_per_month, workflows_per_month, detectors_max, connectors_max, users_max }

    const quotaUsage = Object.entries(quotas).map(([resource, limit]) => ({
      resource,
      limit,
      used: usage[resource as keyof typeof usage] ?? 0,
      remaining: limit === -1 ? -1 : Math.max(0, (limit as number) - (usage[resource as keyof typeof usage] ?? 0)),
      percentage: limit === -1 ? 0 : Math.round(((usage[resource as keyof typeof usage] ?? 0) / (limit as number)) * 100),
    }))

    return {
      plan: tenant.plan,
      quotas: quotaUsage,
    }
  })

  /**
   * GET /entitlements/plans
   * Returns plan comparison for pricing page
   */
  app.get('/entitlements/plans', async () => {
    const plans: Plan[] = ['free', 'starter', 'growth', 'enterprise']

    const planComparison = plans.map((plan) => ({
      name: plan,
      features: getPlanFeatures(plan),
    }))

    return { plans: planComparison }
  })
}
