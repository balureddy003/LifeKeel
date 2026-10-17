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
} from './scoring/cascade.js'
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
} from './scoring/cascade.js'
export { Detector } from './scoring/detector.js'
export {
  evaluate,
  evaluateNumeric,
  interpolate,
  isValidExpression,
  EvaluatorError,
  evaluateWithTimeout,
  evaluateWithMetrics,
  calculateComplexity,
  validateComplexity,
  getExpressionMetrics,
  getAllExpressionMetrics,
  clearExpressionMetrics,
  getExpressionCacheStats,
  clearExpressionCache,
} from './evaluator.js'
export type { ExpressionValidationResult } from './evaluator.js'
export { EvaluatorTimeoutError, EvaluatorComplexityError } from './evaluator.js'
export {
  validateDetector,
  formatValidationErrors,
  setSchemaRegistry,
} from './scoring/detector-validator.js'
export type { ValidationResult, ValidationError } from './scoring/detector-validator.js'
export { MetricsCollector } from './engine-metrics.js'
export type { EngineMetrics, DetectorMetrics } from './engine-metrics.js'
export { InsightExplainer, insightExplainer } from './explain/insight-explainer.js'
export type { UserFriendlyExplanation } from './explain/insight-explainer.js'
export { DatabaseIndexManager, createIndexManager } from './scoring/database-indexes.js'
export type { IndexDefinition } from './scoring/database-indexes.js'
export {
  BatchProcessor,
  BatchNoveltyTracker,
  BatchChangePointDetector,
  BatchFeatureHashScorer,
  createBatchProcessor,
} from './calibration/batch-processor.js'
export type { BatchConfig, BatchOperation } from './calibration/batch-processor.js'
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

export { AdaptiveThresholdStore } from './calibration/adaptive-thresholds.js'
export type { AdaptiveThreshold, ThresholdFallback } from './calibration/adaptive-thresholds.js'
export { TemporalPatternEngine } from './scoring/temporal-patterns.js'
export type {
  TemporalPattern,
  TemporalPatternType,
  TemporalMatchResult,
  FrequencyPattern,
  SequencePattern,
  AbsencePattern,
  TemporalRuleConfig,
} from './scoring/temporal-patterns.js'
export { IntentClassifier, withEmbeddingCache } from './scoring/intent-classifier.js'
export type {
  IntentClassification,
  IntentClass,
  ClassifierOptions,
  ClassifierTier,
} from './scoring/intent-classifier.js'
export { ScoreCalibrator, buildCalibrationPairs } from './calibration/calibration.js'
export type {
  CalibrationPair,
  CalibrationParams,
  CalibrationBucket,
} from './calibration/calibration.js'
export { CalibrationJobScheduler } from './calibration/calibration-scheduler.js'
export type { CalibrationJob, CalibrationJobConfig } from './calibration/calibration-scheduler.js'
export { DetectorEvalRunner } from './eval-runner.js'
export { SkillOptimizer, SKILL_DEFAULT_PROMPTS } from './skill-opt/SkillOptimizer.js'
export type {
  SkillOptRunOptions,
  SkillOptResult,
  OptIteration,
  EditProposal,
  OptTarget,
} from './skill-opt/SkillOptimizer.js'
export { checkSkillOptimizerQuota, DEFAULT_QUOTA } from './skill-opt/SkillOptimizerQuota.js'
export type {
  SkillOptimizerQuotaConfig,
  QuotaCheckResult,
} from './skill-opt/SkillOptimizerQuota.js'

// ── Lightweight ML layer ──────────────────────────────────────────────────────
export { NoveltyTracker } from './scoring/novelty-tracker.js'
export type { NoveltyScore, NoveltyContext, NoveltyConfig } from './scoring/novelty-tracker.js'
export { ChangePointDetector } from './scoring/change-point.js'
export type {
  CUSUMConfig,
  CUSUMState,
  ChangePointResult,
  CUSUMDirection,
  ChangePointAlgorithm,
  ADWINConfig,
  PELTConfig,
} from './scoring/change-point.js'
export { FeatureHashScorer } from './scoring/feature-hash-scorer.js'
export type {
  FeatureHashConfig,
  ScoreResult,
  ModelMeta,
  LearningRateSchedule,
  ModelVersion,
  FeatureHashScorerOptions,
  FeatureHashScorerMetrics,
} from './scoring/feature-hash-scorer.js'
export { TenantLevelScorer } from './scoring/tenant-level-scorer.js'
export type {
  RecentInsight,
  TenantLevelScoreResult,
  TenantLevelScorerOptions,
  TenantLevelScorerMetrics,
} from './scoring/tenant-level-scorer.js'
export { FederatedLearningService } from './federated-learning-service.js'
export type { FederatedLearningServiceOptions } from './federated-learning-service.js'
export { ExponentialSmoother } from './calibration/adaptive-thresholds.js'
export type { ExponentialSmootherState } from './calibration/adaptive-thresholds.js'
export { fitIsotonic, applyIsotonic } from './calibration/calibration.js'
export type { IsotonicBreakpoint } from './calibration/calibration.js'
export type { CUSUMConfig as CUSUMRuleConfig, ScoreModelConfig } from './schemas.js'
export { CorrelationBuffer } from './scoring/correlation-buffer.js'
export type { CorrelationEvidence, CorrelationWindow } from './scoring/correlation-buffer.js'
export { runMoveGuard, scanText } from './explain/move-guard.js'
export type { GuardOutcome, GuardReason, GuardResult } from './explain/move-guard.js'
export { MoveJudge, JudgeScoresSchema, decideScores } from './explain/move-judge.js'
export type {
  JudgeDecision,
  JudgeEvaluator,
  JudgeInput,
  JudgeScores,
  JudgeVerdict,
  MoveJudgeOptions,
} from './explain/move-judge.js'
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
export { IndustryEmbeddingProvider } from './scoring/industry-embeddings.js'
export type {
  Industry,
  EmbeddingConfig,
  EmbeddingResult,
  IndustryEmbeddingService,
} from './scoring/industry-embeddings.js'
