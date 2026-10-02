/**
 * Entitlements System
 *
 * Controls feature access based on tenant plan tier.
 * Used by route handlers and middleware to enforce plan limits.
 */


export const FEATURE_ENTITLEMENTS = {
  // Core features
  workflows: { free: true, starter: true, growth: true, enterprise: true },
  detectors: { free: true, starter: true, growth: true, enterprise: true },
  connectors: { free: true, starter: true, growth: true, enterprise: true },
  insights: { free: true, starter: true, growth: true, enterprise: true },
  analytics: { free: true, starter: true, growth: true, enterprise: true },

  // Collaboration
  team_members: { free: false, starter: true, growth: true, enterprise: true },
  approvals: { free: false, starter: true, growth: true, enterprise: true },
  collaboration: { free: false, starter: true, growth: true, enterprise: true },

  // Enterprise features
  sso: { free: false, starter: false, growth: true, enterprise: true },
  scim: { free: false, starter: false, growth: false, enterprise: true },
  audit_logs: { free: false, starter: false, growth: true, enterprise: true },
  custom_integrations: { free: false, starter: false, growth: false, enterprise: true },
  sla: { free: false, starter: false, growth: false, enterprise: true },
  dedicated_support: { free: false, starter: false, growth: false, enterprise: true },

  // Advanced
  webhook_custom: { free: false, starter: true, growth: true, enterprise: true },
  advanced_analytics: { free: false, starter: true, growth: true, enterprise: true },
  ai_custom_models: { free: false, starter: false, growth: true, enterprise: true },
  marketplace: { free: true, starter: true, growth: true, enterprise: true },
  marketplace_publish: { free: false, starter: false, growth: true, enterprise: true },

  // Family app: document upload, scanning, and connecting email/bank/broker
  // accounts stay free on every plan — only the AI-powered document field
  // extraction (GPT-4o vision) and email summarization are paid.
  document_ai_extraction: { free: false, starter: true, growth: true, enterprise: true },
  email_ai_summary: { free: false, starter: true, growth: true, enterprise: true },
} as const

export type Feature = keyof typeof FEATURE_ENTITLEMENTS
export type Plan = 'free' | 'starter' | 'growth' | 'enterprise'

/**
 * Check if a feature is enabled for a given plan
 */
export function hasFeature(feature: Feature, plan: Plan): boolean {
  return FEATURE_ENTITLEMENTS[feature]?.[plan] ?? false
}

/**
 * The plan to use for feature checks. A free-plan tenant whose signup
 * trial is still running gets starter-level feature access — the trial
 * exists to demo what Oak Plus sells, so gating the flagship features off
 * during it would make the trial dead weight. Once `trial_ends_at` passes
 * (or `trial_expired` was set — e.g. a paid subscription that churned),
 * this falls back to the stored plan.
 *
 * Quotas are deliberately not bumped: this only affects boolean feature
 * gates, not PLAN_QUOTAS or credit balances.
 */
export function effectivePlan(tenant: Record<string, unknown> | null | undefined): Plan {
  const plan = (tenant?.['plan'] ?? 'free') as Plan
  if (plan !== 'free') return plan
  const billing = tenant?.['billing'] as Record<string, unknown> | undefined
  if (billing?.['trial_expired'] === true) return plan
  const trialEndsAt = billing?.['trial_ends_at']
  if (trialEndsAt && new Date(trialEndsAt as string | Date).getTime() > Date.now()) {
    return 'starter'
  }
  return plan
}

/**
 * Get all features available for a plan
 */
export function getPlanFeatures(plan: Plan): Record<string, boolean> {
  const features: Record<string, boolean> = {}
  for (const [feature, plans] of Object.entries(FEATURE_ENTITLEMENTS)) {
    features[feature] = plans[plan] ?? false
  }
  return features
}

/**
 * Get enabled features as an array
 */
export function getEnabledFeatures(plan: Plan): Feature[] {
  return Object.entries(FEATURE_ENTITLEMENTS)
    .filter(([, plans]) => plans[plan])
    .map(([feature]) => feature as Feature)
}

/**
 * Create a Fastify preHandler that checks if a feature is enabled
 * for the current tenant's plan.
 */
export function requireFeature(feature: Feature) {
  return async (request: any, reply: any) => {
    const tenant_id = request.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    // Get tenant's plan from database
    const db = request.server.mongo?.db ?? request.server.db
    const tenant = await db.collection('tenants').findOne({ tenant_id })

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const plan = effectivePlan(tenant)

    if (!hasFeature(feature, plan)) {
      // Paywall hit = the strongest upgrade-intent signal there is. Log it
      // (tenant-scoped, fire-and-forget) so lifecycle email can target the
      // tenants actually bumping into limits rather than blasting everyone.
      db.collection('growth_events').insertOne({
        event: 'upgrade_intent',
        meta: { tenant_id, feature, plan },
        created_at: new Date(),
      }).catch(() => {})
      return reply.status(403).send({
        error: 'Feature not available on current plan',
        feature,
        required_plan: Object.entries(FEATURE_ENTITLEMENTS[feature])
          .filter(([, enabled]) => enabled)
          .map(([p]) => p)
          .join(' or '),
        current_plan: plan,
      })
    }
  }
}

/**
 * Middleware to check quota limits
 */
export function checkQuota(resource: string) {
  return async (request: any, reply: any) => {
    const tenant_id = request.authContext?.tenant_id
    if (!tenant_id) {
      return reply.status(401).send({ error: 'Authentication required' })
    }

    const db = request.server.mongo?.db ?? request.server.db
    const tenant = await db.collection('tenants').findOne({ tenant_id })

    if (!tenant) {
      return reply.status(404).send({ error: 'Tenant not found' })
    }

    const quotas = tenant.quotas ?? {}
    const quota = quotas[resource]

    if (quota === undefined || quota === -1) {
      // No limit
      return
    }

    // Count current usage
    let currentUsage = 0
    switch (resource) {
      case 'events_per_month':
        currentUsage = await db.collection('events').countDocuments({
          tenant_id,
          created_at: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        })
        break
      case 'workflows_per_month':
        currentUsage = await db.collection('workflow_runs').countDocuments({
          tenant_id,
          created_at: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        })
        break
      case 'detectors_max':
        currentUsage = await db.collection('detectors').countDocuments({ tenant_id })
        break
      case 'connectors_max':
        currentUsage = await db.collection('connector_credentials').countDocuments({ tenant_id })
        break
      case 'users_max':
        currentUsage = await db.collection('users').countDocuments({ tenant_id })
        break
    }

    if (currentUsage >= quota) {
      db.collection('growth_events').insertOne({
        event: 'upgrade_intent',
        meta: { tenant_id, resource, plan: effectivePlan(tenant) },
        created_at: new Date(),
      }).catch(() => {})
      return reply.status(429).send({
        error: 'Quota exceeded',
        resource,
        limit: quota,
        used: currentUsage,
        upgrade_url: '/billing/checkout',
      })
    }

    // Store usage info on request for potential use
    request.quotaInfo = { resource, limit: quota, used: currentUsage, remaining: quota - currentUsage }
  }
}
