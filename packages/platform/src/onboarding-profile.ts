/**
 * Onboarding profile config — persona → vertical + risk tier presets.
 *
 * Shared between the Studio onboarding UI and the API so both sides agree on
 * the same mappings and default values. Risk tier presets are written into
 * `tenant_settings.defensive_trend_strategy` and into the KPIs of the tenant's
 * active goal(s), giving every detector that reads those contexts a single,
 * consistent set of thresholds.
 */

export type Persona = 'investor' | 'business-owner' | 'real-estate' | 'creator' | 'healthcare' | 'family-organizer' | 'growth-marketer'
export type RiskTier = 'conservative' | 'balanced' | 'aggressive'

// Every value here must match a real id in verticals/*/vertical.yaml —
// 'sme' and 'real-estate' never did (the real ids are 'smb-operations' and
// 'property-wealth'), so GET /verticals/active found nothing and those two
// personas silently got zero nav/theming personalization despite
// active_vertical being "set". 'healthcare' still has no matching vertical
// manifest at all; that persona intentionally stays unmapped to a real
// vertical rather than mislabeling it as one it isn't.
// 'family-organizer' maps to the family vertical; 'growth-marketer' maps to
// branding-marketing. Both are non-trading personas — no risk tier required.
export const PERSONA_VERTICALS: Record<Persona, string> = {
  'investor': 'trading-investment',
  'business-owner': 'smb-operations',
  'real-estate': 'property-wealth',
  'creator': 'audience-growth',
  'healthcare': 'healthcare',
  'family-organizer': 'family',
  'growth-marketer': 'branding-marketing',
}

export interface StrategyPreset {
  maxPositionWeight: number
  targetVolatility: number
  cashDeployThreshold: number
  stopLossThreshold: number
}

export interface GoalKpiPreset {
  price_drop_alert_threshold_pct: number
  portfolio_concentration_max_pct: number
  cash_allocation_max_pct: number
}

export interface RiskTierPreset {
  strategy: StrategyPreset
  goalKpis: GoalKpiPreset
}

export const RISK_TIER_PRESETS: Record<RiskTier, RiskTierPreset> = {
  conservative: {
    strategy: {
      maxPositionWeight: 5,
      targetVolatility: 5,
      cashDeployThreshold: 10,
      stopLossThreshold: 0.05,
    },
    goalKpis: {
      price_drop_alert_threshold_pct: 3,
      portfolio_concentration_max_pct: 8,
      cash_allocation_max_pct: 10,
    },
  },
  balanced: {
    strategy: {
      maxPositionWeight: 10,
      targetVolatility: 10,
      cashDeployThreshold: 5,
      stopLossThreshold: 0.10,
    },
    goalKpis: {
      price_drop_alert_threshold_pct: 5,
      portfolio_concentration_max_pct: 10,
      cash_allocation_max_pct: 5,
    },
  },
  aggressive: {
    strategy: {
      maxPositionWeight: 20,
      targetVolatility: 20,
      cashDeployThreshold: 2,
      stopLossThreshold: 0.15,
    },
    goalKpis: {
      price_drop_alert_threshold_pct: 10,
      portfolio_concentration_max_pct: 20,
      cash_allocation_max_pct: 3,
    },
  },
}

/** Default strategy fields that are independent of risk tier. */
export const STRATEGY_DEFAULTS = {
  enabled: true,
  minLookback: 63,
  qualityWeight: 0.35,
  momentumWeight: 0.40,
  volatilityWeight: 0.25,
} as const

export function isPersona(value: unknown): value is Persona {
  return typeof value === 'string' && value in PERSONA_VERTICALS
}

export function isRiskTier(value: unknown): value is RiskTier {
  return typeof value === 'string' && value in RISK_TIER_PRESETS
}
