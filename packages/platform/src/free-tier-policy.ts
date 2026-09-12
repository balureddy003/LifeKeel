export type FreeTierResource = 'active_goals' | 'community_detectors' | 'monthly_move_approvals'

export interface QuotaDecision {
  allowed: boolean
  resource: FreeTierResource
  used: number
  limit: number | null
  upgrade_required: boolean
}

export const FREE_TIER_LIMITS: Record<FreeTierResource, number> = {
  active_goals: 3,
  community_detectors: 5,
  monthly_move_approvals: 10,
}

export class FreeTierPolicy {
  check(resource: FreeTierResource, used: number, tier = 'free'): QuotaDecision {
    const limit = tier === 'free' ? FREE_TIER_LIMITS[resource] : null
    return {
      allowed: limit === null || used < limit,
      resource,
      used,
      limit,
      upgrade_required: limit !== null && used >= limit,
    }
  }
}
