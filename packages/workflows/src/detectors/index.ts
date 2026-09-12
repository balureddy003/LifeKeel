/**
 * Detector Registry
 *
 * Exports all detectors for use in workflows and the engine.
 */

import { AnomalyDetector } from './AnomalyDetector'
import type { Anomaly, AnomalyDetectorConfig } from './AnomalyDetector'

import { AzureFoundryDataFetcher } from './AzureFoundryDataFetcher'
import type { BusinessMetrics, AzureFoundryDataFetcherConfig } from './AzureFoundryDataFetcher'

import { InsightGenerator } from './InsightGenerator'
import type { Insight, InsightGeneratorConfig } from './InsightGenerator'

import { SocialMediaMetricsFetcher } from './SocialMediaMetricsFetcher'
import type { SocialMediaMetrics, SocialMediaMetricsFetcherConfig } from './SocialMediaMetricsFetcher'

import { SocialMediaPerformanceAnalyzer } from './SocialMediaPerformanceAnalyzer'
import type { PlatformPerformance, PerformanceAnalysis, SocialMediaPerformanceAnalyzerConfig } from './SocialMediaPerformanceAnalyzer'

// Re-export for convenience
export { AnomalyDetector } from './AnomalyDetector'
export type { Anomaly, AnomalyDetectorConfig } from './AnomalyDetector'

export { AzureFoundryDataFetcher } from './AzureFoundryDataFetcher'
export type { BusinessMetrics, AzureFoundryDataFetcherConfig } from './AzureFoundryDataFetcher'

export { InsightGenerator } from './InsightGenerator'
export type { Insight, InsightGeneratorConfig } from './InsightGenerator'

export { SocialMediaMetricsFetcher } from './SocialMediaMetricsFetcher'
export type { SocialMediaMetrics, SocialMediaMetricsFetcherConfig } from './SocialMediaMetricsFetcher'

export { SocialMediaPerformanceAnalyzer } from './SocialMediaPerformanceAnalyzer'
export type { PlatformPerformance, PerformanceAnalysis, SocialMediaPerformanceAnalyzerConfig } from './SocialMediaPerformanceAnalyzer'

// Detector registry for runtime lookup
export const detectors = {
  anomaly_detector: AnomalyDetector,
  azure_foundry_data_fetcher: AzureFoundryDataFetcher,
  insight_generator: InsightGenerator,
  social_media_metrics_fetcher: SocialMediaMetricsFetcher,
  social_media_performance_analyzer: SocialMediaPerformanceAnalyzer,
} as const

export type DetectorId = keyof typeof detectors
