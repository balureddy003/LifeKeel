/**
 * @lifekeel/engine
 *
 * Deterministic rules engine for production AI applications.
 * Rules run first. LLMs score second. Evidence always required.
 */

export { Engine } from './engine.js'
export type {
  EngineOptions,
  EngineResult,
  EvaluateInput,
  LlmScorer,
  InsightTrace,
  DetectorInventoryEntry,
  ReasoningContext,
  ReasoningContextBuilder,
} from './engine.js'
export {
  CascadeScorer,
  StaticConformalGate,
  computeConformalThreshold,
  empiricalWrongSkipRate,
} from './cascade.js'
export type {
  CascadePolicy,
  CascadeTier,
  CascadeDecision,
  CascadeTelemetry,
  CascadeScorable,
  ConformalGateProvider,
  ConformalCalibrationSample,
  ConformalThresholdResult,
  ConformalThresholdOptions,
} from './cascade.js'
export { Detector } from './detector.js'
export { evaluate, evaluateNumeric, interpolate, isValidExpression, EvaluatorError, evaluateWithTimeout, evaluateWithMetrics, calculateComplexity, validateComplexity, getExpressionMetrics, getAllExpressionMetrics, clearExpressionMetrics, getExpressionCacheStats, clearExpressionCache } from './evaluator.js'
export type { ExpressionValidationResult } from './evaluator.js'
export { EvaluatorTimeoutError, EvaluatorComplexityError } from './evaluator.js'
export { validateDetector, formatValidationErrors, setSchemaRegistry } from './detector-validator.js'
export type { ValidationResult, ValidationError } from './detector-validator.js'
export { MetricsCollector } from './engine-metrics.js'
export type { EngineMetrics, DetectorMetrics } from './engine-metrics.js'
export { InsightExplainer, insightExplainer } from './insight-explainer.js'
export type { UserFriendlyExplanation } from './insight-explainer.js'
export { DatabaseIndexManager, createIndexManager } from './database-indexes.js'
export type { IndexDefinition } from './database-indexes.js'
export { BatchProcessor, BatchNoveltyTracker, BatchChangePointDetector, BatchFeatureHashScorer, createBatchProcessor } from './batch-processor.js'
export type { BatchConfig, BatchOperation } from './batch-processor.js'
export type {
  Insight,
  Trigger,
  Move,
  ConfidenceBreakdown,
  EvidenceTrail,
  DetectorConfig,
  DetectorRule,
  EvaluationResult,
  EvaluationContext,
  RuleHistoryEntry,
  CddFilter,
  CddAction,
  DetectorVersion,
  BlendPolicy,
} from './schemas.js'
export {
  InsightSchema,
  TriggerSchema,
  ConfidenceBreakdownSchema,
  EvidenceTrailSchema,
  DetectorConfigSchema,
  DetectorRuleSchema,
  EvaluationResultSchema,
  BlendPolicySchema,
} from './schemas.js'

export { AdaptiveThresholdStore } from './adaptive-thresholds.js'
export type { AdaptiveThreshold, ThresholdFallback } from './adaptive-thresholds.js'
export { TemporalPatternEngine } from './temporal-patterns.js'
export type {
  TemporalPattern, TemporalPatternType, TemporalMatchResult,
  FrequencyPattern, SequencePattern, AbsencePattern, TemporalRuleConfig,
} from './temporal-patterns.js'
export { IntentClassifier, withEmbeddingCache } from './intent-classifier.js'
export type { IntentClassification, IntentClass, ClassifierOptions, ClassifierTier } from './intent-classifier.js'
export { ScoreCalibrator, buildCalibrationPairs } from './calibration.js'
export type { CalibrationPair, CalibrationParams, CalibrationBucket } from './calibration.js'
export { CalibrationJobScheduler } from './calibration-scheduler.js'
export type { CalibrationJob, CalibrationJobConfig } from './calibration-scheduler.js'
export { DetectorEvalRunner } from './eval-runner.js'
export { SkillOptimizer, SKILL_DEFAULT_PROMPTS } from './skill-opt/SkillOptimizer.js'
export type { SkillOptRunOptions, SkillOptResult, OptIteration, EditProposal, OptTarget } from './skill-opt/SkillOptimizer.js'
export { checkSkillOptimizerQuota, DEFAULT_QUOTA } from './skill-opt/SkillOptimizerQuota.js'
export type { SkillOptimizerQuotaConfig, QuotaCheckResult } from './skill-opt/SkillOptimizerQuota.js'

// ── Lightweight ML layer ──────────────────────────────────────────────────────
export { NoveltyTracker } from './novelty-tracker.js'
export type { NoveltyScore, NoveltyContext, NoveltyConfig } from './novelty-tracker.js'
export { ChangePointDetector } from './change-point.js'
export type { CUSUMConfig, CUSUMState, ChangePointResult, CUSUMDirection, ChangePointAlgorithm, ADWINConfig, PELTConfig } from './change-point.js'
export { FeatureHashScorer } from './feature-hash-scorer.js'
export type { FeatureHashConfig, ScoreResult, ModelMeta, LearningRateSchedule, ModelVersion, FeatureHashScorerOptions, FeatureHashScorerMetrics } from './feature-hash-scorer.js'
export { TenantLevelScorer } from './tenant-level-scorer.js'
export type { RecentInsight, TenantLevelScoreResult, TenantLevelScorerOptions, TenantLevelScorerMetrics } from './tenant-level-scorer.js'
export { FederatedLearningService } from './federated-learning-service.js'
export type { FederatedLearningServiceOptions } from './federated-learning-service.js'
export { ExponentialSmoother } from './adaptive-thresholds.js'
export type { ExponentialSmootherState } from './adaptive-thresholds.js'
export { fitIsotonic, applyIsotonic } from './calibration.js'
export type { IsotonicBreakpoint } from './calibration.js'
export type { CUSUMConfig as CUSUMRuleConfig, ScoreModelConfig } from './schemas.js'
export { CorrelationBuffer } from './correlation-buffer.js'
export type { CorrelationEvidence, CorrelationWindow } from './correlation-buffer.js'
export { projectGoal } from './goal-trajectory.js'
export type {
  GoalProjection,
  GoalProjectionInput,
  GoalProjectionKpi,
  GoalProjectionSignal,
} from './goal-trajectory.js'
export { GoalDetectorActivationMap } from './goal-detector-activation.js'
export type {
  DetectorActivationInput,
  GoalActivationInput,
  GoalDetectorActivation,
} from './goal-detector-activation.js'
export { runMoveGuard, scanText } from './move-guard.js'
export type { GuardOutcome, GuardReason, GuardResult } from './move-guard.js'
export { MoveJudge, JudgeScoresSchema, decideScores } from './move-judge.js'
export type {
  JudgeDecision,
  JudgeEvaluator,
  JudgeInput,
  JudgeScores,
  JudgeVerdict,
  MoveJudgeOptions,
} from './move-judge.js'
export {
  FederatedLearning,
  DifferentialPrivacy,
  PrivacyAccountant,
  PrivacyBudgetExceededError,
  SecureAggregationProtocol,
} from './federated/index.js'
export type {
  FederatedRound,
  TenantUpdate,
  PrivacyHardeningConfig,
  DPConfig,
  PrivacyBudget,
} from './federated/index.js'
export { IndustryEmbeddingProvider } from './industry-embeddings.js'
export type { Industry, EmbeddingConfig, EmbeddingResult, IndustryEmbeddingService } from './industry-embeddings.js'

// ── Trading strategy layer ───────────────────────────────────────────────────
export { generateDefensiveTrendRecommendations, computeMomentumScore, computeVolatilityScore, computeQualityScore, computeEnhancedQualityScore } from './trading/defensiveTrendFollowing.js'
export { generateMomentumRecommendations, computePureMomentumScore, scoreMomentumUniverse } from './trading/momentumTrendFollowing.js'
export type { UniverseScore } from './trading/momentumTrendFollowing.js'
export { simulateRecommendation } from './trading/simulator.js'
export type { SimulationResult, PortfolioMetrics } from './trading/simulator.js'
export { evaluateTradeExecution, isWithinCancellationWindow, buildTradeReceipt } from './trading/trade-executor.js'
export type { LiveTradingOptIn, TradeIntent, TradeReceipt, TradeExecutionGuard, TradeStatus, ExecuteBrokerTrade, BrokerExecutionResult } from './trading/trade-executor.js'
export type {
  MarketData,
  PortfolioSnapshot,
  Position,
  PricePoint,
  RiskConfig,
  StrategyRecommendation,
  PortfolioTier,
} from './trading/types.js'
export {
  classifyPortfolioTier,
  tierDefaults,
  mergeWithTierDefaults,
} from './trading/types.js'
export {
  detectRegime,
  detectRegimeFromMarketData,
  selectRegimeStrategy,
} from './trading/regime-detector.js'
export type { MarketRegime, RegimeResult, MacroIndicators } from './trading/regime-detector.js'
export {
  volatilityScale,
  week52HighScore,
  multiTimeframeMomentumScore,
  marketStateGate,
  computeADX,
  filterByTurnover,
  estimateTransactionCost,
  realizedVolatility,
  dailyReturns,
  crossSectionalRank,
  blendTsAndCsMomentum,
  attentionScore,
  percentileRankScore,
  computeKellyFraction,
  kellyScaledWeight,
  averageTrueRangePct,
  atrBasedStopPct,
  dynamicRebalanceIntervalDays,
  bearRegimeHedgeAllocation,
} from './trading/strategy-enhancements.js'
export type { TradeOutcome, KellyEstimate } from './trading/strategy-enhancements.js'
export {
  rsiSignal,
  bollingerBreakoutSignal,
  shortTermSurgeSignal,
  gapContinuationSignal,
  volatilityContractionSignal,
  compositeAlphaSignal,
  mineAlphaSignal,
} from './trading/alpha-mining.js'
export type { AlphaSignal } from './trading/alpha-mining.js'
export { residualReturn } from './trading/strategy-enhancements.js'
export {
  extractFeatures,
  trainRidge,
  predictRidge,
  walkForwardPredict,
  computeOutOfSampleSharpe,
  computeCrossSectionalMlSignal,
  featureImportance,
  FEATURE_NAMES,
} from './trading/ml-ensemble.js'
export type { FeatureVector, RidgeModel } from './trading/ml-ensemble.js'
