/**
 * Tier Provider Interface
 *
 * Defines the interface for inference tiers in the cascade system.
 * Each tier provides scoring capabilities with different cost/latency tradeoffs.
 *
 * ADR-0068: Tiered Inference Cascade and Conformal Escalation Gate
 */

export interface TierScoreResult {
  tier: string
  score: number
  confidence: number
  escalated: boolean
  latency_ms: number
  cost_microdollars: number
  metadata?: Record<string, unknown>
}

export interface TierProvider {
  /**
   * Unique identifier for this tier
   */
  readonly tierId: string

  /**
   * Human-readable tier name
   */
  readonly tierName: string

  /**
   * Score the input and return result
   */
  score(input: CascadeInput): Promise<TierScoreResult>

  /**
   * Check if this tier is available for the given context
   */
  isAvailable(context: CascadeContext): boolean

  /**
   * Get estimated cost for this tier (in microdollars)
   */
  estimateCost(): number
}

export interface CascadeInput {
  tenant_id: string
  detector_id: string
  event_data: Record<string, unknown>
  business_context: Record<string, unknown>
  cache_key?: string
}

export interface CascadeContext {
  tenant_id: string
  detector_id: string
  calibration_version?: string
  tau_tenant?: number
  alpha?: number
  deterministic_mode?: boolean
  local_llm_available?: boolean
}

export interface CascadeOptions {
  /**
   * Feature flag to enable/disable cascade
   */
  enabled?: boolean

  /**
   * Conformal escalation parameters
   */
  conformal?: {
    alpha?: number // Maximum acceptable wrong-skip rate (default: 0.02)
    calibration_window?: number // Days of calibration data to use
  }

  /**
   * Tier-specific configuration
   */
  tiers?: {
    t0?: {
      enabled: boolean
      cache_enabled?: boolean
    }
    t1?: {
      enabled: boolean
      model_path?: string
    }
    t2?: {
      enabled: boolean
      local_llm_url?: string
    }
    t3?: {
      enabled: boolean
      provider?: string
    }
  }
}

export interface CascadeResult {
  tier_used: string
  escalated: boolean
  score: number
  confidence: number
  latency_ms: number
  cost_microdollars: number
  tau_used?: number
  alpha_used?: number
  cache_hit?: boolean
  metadata: Record<string, unknown>
}
