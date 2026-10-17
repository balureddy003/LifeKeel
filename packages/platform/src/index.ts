export { AuthService, extractBearerToken } from './auth.js'
export type { JwtPayload, AuthContext } from './auth.js'
export { toMinorUnits, fromMinorUnits, formatMoney, formatMoneyDisplay, addMinorUnits, percentOf } from './money.js'
export type { MinorUnits, Currency, MoneyDisplay } from './money.js'
export {
  getCountryConfig,
  getCurrencyForCountry,
  getLocaleForCountry,
  getTimezoneForCountry,
  listSupportedCountries,
  isValidCountryCode,
} from './country-config.js'
export type { CountryConfig, CountryCode } from './country-config.js'
export { withSpan, setTracer, getTracer, initTelemetry } from './telemetry.js'
export type { Span, Tracer } from './telemetry.js'
export { createLlmRouter, createLlmRouterFromEnv, DEFAULT_MODELS, DEFAULT_TIER_MODELS, resolveTierModel, estimateReasoningTier, isValidAzureEndpoint, isAzureFoundryEndpoint } from './llm.js'
export type { LlmFn, LlmConfig, LlmProvider, ReasoningTier } from './llm.js'
export { encryptField, decryptField, encryptIfNeeded, decryptIfNeeded, encryptBuffer, decryptBuffer } from './crypto.js'
export { CostLedger, computeCost, formatMicroDollars } from './cost-ledger.js'
export type { LlmUsageRecord, CostSummary, ModelPricing } from './cost-ledger.js'
export { createLocalDecisionFn, LocalDecisionError } from './local-decision.js'
export type { DecisionFn, LocalDecisionConfig, LocalDecisionRequest, LocalDecisionResult } from './local-decision.js'
export { callStructured, StructuredOutputError, BudgetExhaustedError } from './structured-llm.js'
export type { StructuredCallOptions, StructuredCallResult, LlmGovernanceOptions } from './structured-llm.js'
export { createGuardEventSink } from './guard-event-sink.js'
export type { GuardEventSink } from './guard-event-sink.js'
export type { LlmTokenUsage, LlmUsageCallback } from './llm.js'
export { LlmInputGuard, LlmOutputGuard } from './llm-guards.js'
export type {
  GuardResult,
  LlmGuardEvent,
  LlmGuardEventType,
  LlmGuardOptions,
} from './llm-guards.js'
export { ContextAssembler } from './context-assembler.js'
export type { AssembledContext, ContextRequest } from './context-assembler.js'
export { PromptVersionRegistry } from './prompts/PromptVersionRegistry.js'
export type {
  LlmSpan,
  PromptCallType,
  PromptEvalResult,
  PromptStatus,
  PromptVersion,
} from './prompts/PromptVersionRegistry.js'
export { createLogger } from './logger.js'
export type { LogContext, LogLevel, StructuredLogger } from './logger.js'
export { RETRY_CONFIGS, retryWithPolicy } from './retry.js'
export type { RetryConfig } from './retry.js'
export { RoleResolver } from './auth/RoleResolver.js'
export type { LifeKeelRole, SsoRoleMapping } from './auth/RoleResolver.js'
export { SafeHttpClient } from './safe-http-client.js'
export { TenantScopedCollection, getTenantCollection } from './tenant-scoped-collection.js'
export { FreeTierPolicy, FREE_TIER_LIMITS } from './free-tier-policy.js'
export type { FreeTierResource, QuotaDecision } from './free-tier-policy.js'
export { enforceQuota, QuotaExceededError } from './quota.js'
export type { QuotaResource } from './quota.js'
export { validateLicenseKey } from './license.js'
export type { LicensePayload } from './license.js'
export { LlmResponseCache, MongoLlmCacheStore, withCache } from './llm-response-cache.js'
export type {
  LlmCacheEntry,
  LlmCacheStore,
  LlmCacheConfig,
  LlmCacheHitCallback,
} from './llm-response-cache.js'
// Deprecated alias — use LlmResponseCache instead
export { SemanticCache } from './semantic-cache.js'
export type { SemanticCacheEntry, SemanticCacheStore } from './semantic-cache.js'
export { LlmBudgetGuard } from './llm-budget.js'
export type { LlmBudgetDecision } from './llm-budget.js'
export { ApprovalSignalHealthMonitor } from './approval-signal-health.js'
export type { ApprovalSignalHealthScore, ApprovalFlag } from './approval-signal-health.js'
export { canPerform } from './abilities.js'
export type { ProductAction, ProductResource, ProductRole } from './abilities.js'

export {
  getEdition, getEditionInfo, requireEdition, isFeatureEnabled,
  EditionError,
} from './edition.js'
export type { LifeKeelEdition, EditionInfo } from './edition.js'

export { LlmCircuitBreaker, getCircuitBreaker, getAllCircuitBreakers } from './llm-circuit-breaker.js'
export type { CircuitBreakerOptions } from './llm-circuit-breaker.js'
export { EnvKeyRegistry, defaultKeyRegistry } from './key-registry.js'
export type { KeyRegistry } from './key-registry.js'
export { InMemoryCircuitBreakerRegistry, defaultCircuitBreakerRegistry } from './circuit-breaker-registry.js'
export type { CircuitBreakerRegistry } from './circuit-breaker-registry.js'
export { EmbeddingWorker } from './memory/EmbeddingWorker.js'
export type { EmbedFn } from './memory/EmbeddingWorker.js'
export { LocalEmbeddingProvider, DEFAULT_LOCAL_EMBEDDING_MODEL } from './memory/LocalEmbeddingProvider.js'
export type { LocalEmbeddingOptions } from './memory/LocalEmbeddingProvider.js'
export { repoRoot } from './repo-root.js'
export { buildGoalKpiTargets, buildGoalContext, DEFAULT_GOAL_KPI_TARGETS } from './goal-kpi-targets.js'
export type { GoalContext } from './goal-kpi-targets.js'
export {
  PERSONA_VERTICALS,
  RISK_TIER_PRESETS,
  STRATEGY_DEFAULTS,
  isPersona,
  isRiskTier,
} from './onboarding-profile.js'
export type { Persona, RiskTier, RiskTierPreset, StrategyPreset, GoalKpiPreset } from './onboarding-profile.js'
