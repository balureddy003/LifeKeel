/**
 * Anomaly Detector
 *
 * Detects unusual patterns in social media metrics and business data:
 * - Engagement drops
 * - Platform-specific anomalies
 * - Unusual correlation patterns
 * - Triggers alerts when anomalies are detected
 */

import { Detector, DetectorContext, Signal } from '../types'
import { SocialMediaMetrics } from './SocialMediaMetricsFetcher'
import { PerformanceAnalysis } from './SocialMediaPerformanceAnalyzer'

export interface Anomaly {
  type: 'engagement_drop' | 'platform_anomaly' | 'correlation_anomaly'
  platform: string
  severity: 'critical' | 'warning' | 'info'
  message: string
  current_value: number
  expected_value: number
  deviation_percentage: number
}

export interface AnomalyDetectorConfig {
  current_metrics: SocialMediaMetrics
  previous_metrics?: SocialMediaMetrics
  performance_analysis: PerformanceAnalysis
  thresholds: {
    engagement_drop_percentage: number
    platform_engagement_threshold: number
    correlation_threshold: number
  }
}

function detectEngagementDrops(
  current: SocialMediaMetrics,
  previous: SocialMediaMetrics,
  thresholds: AnomalyDetectorConfig['thresholds']
): Anomaly[] {
    const anomalies: Anomaly[] = []

    // Check Twitter engagement drop
    if (current.twitter && previous.twitter) {
      const drop = calculateEngagementDrop(
        current.twitter.total_likes + current.twitter.total_retweets + current.twitter.total_replies,
        previous.twitter.total_likes + previous.twitter.total_retweets + previous.twitter.total_replies
      )

      if (drop > thresholds.engagement_drop_percentage) {
        anomalies.push({
          type: 'engagement_drop',
          platform: 'twitter',
          severity: drop > 30 ? 'critical' : 'warning',
          message: `Twitter engagement dropped by ${drop.toFixed(1)}% compared to previous period`,
          current_value: current.twitter.total_likes + current.twitter.total_retweets + current.twitter.total_replies,
          expected_value: previous.twitter.total_likes + previous.twitter.total_retweets + previous.twitter.total_replies,
          deviation_percentage: drop,
        })
      }
    }

    // Check YouTube engagement drop
    if (current.youtube && previous.youtube) {
      const drop = calculateEngagementDrop(
        current.youtube.total_likes + current.youtube.total_comments,
        previous.youtube.total_likes + previous.youtube.total_comments
      )

      if (drop > thresholds.engagement_drop_percentage) {
        anomalies.push({
          type: 'engagement_drop',
          platform: 'youtube',
          severity: drop > 30 ? 'critical' : 'warning',
          message: `YouTube engagement dropped by ${drop.toFixed(1)}% compared to previous period`,
          current_value: current.youtube.total_likes + current.youtube.total_comments,
          expected_value: previous.youtube.total_likes + previous.youtube.total_comments,
          deviation_percentage: drop,
        })
      }
    }

    // Check Facebook engagement drop
    if (current.facebook && previous.facebook) {
      const drop = calculateEngagementDrop(
        current.facebook.total_likes + current.facebook.total_comments + current.facebook.total_shares,
        previous.facebook.total_likes + previous.facebook.total_comments + previous.facebook.total_shares
      )

      if (drop > thresholds.engagement_drop_percentage) {
        anomalies.push({
          type: 'engagement_drop',
          platform: 'facebook',
          severity: drop > 30 ? 'critical' : 'warning',
          message: `Facebook engagement dropped by ${drop.toFixed(1)}% compared to previous period`,
          current_value: current.facebook.total_likes + current.facebook.total_comments + current.facebook.total_shares,
          expected_value: previous.facebook.total_likes + previous.facebook.total_comments + previous.facebook.total_shares,
          deviation_percentage: drop,
        })
      }
    }

    // Check Instagram engagement drop
    if (current.instagram && previous.instagram) {
      const drop = calculateEngagementDrop(
        current.instagram.total_likes + current.instagram.total_comments,
        previous.instagram.total_likes + previous.instagram.total_comments
      )

      if (drop > thresholds.engagement_drop_percentage) {
        anomalies.push({
          type: 'engagement_drop',
          platform: 'instagram',
          severity: drop > 30 ? 'critical' : 'warning',
          message: `Instagram engagement dropped by ${drop.toFixed(1)}% compared to previous period`,
          current_value: current.instagram.total_likes + current.instagram.total_comments,
          expected_value: previous.instagram.total_likes + previous.instagram.total_comments,
          deviation_percentage: drop,
        })
      }
    }

    return anomalies
}

function detectPlatformAnomalies(
  current: SocialMediaMetrics,
  analysis: PerformanceAnalysis,
  thresholds: AnomalyDetectorConfig['thresholds']
): Anomaly[] {
    const anomalies: Anomaly[] = []

    // Check if any platform has unusually low engagement
    if (current.twitter && analysis.platform_performance.twitter) {
      const engagement_rate = analysis.platform_performance.twitter.engagement_rate
      if (engagement_rate < thresholds.platform_engagement_threshold) {
        anomalies.push({
          type: 'platform_anomaly',
          platform: 'twitter',
          severity: 'warning',
          message: `Twitter engagement rate (${(engagement_rate * 100).toFixed(2)}%) is below threshold`,
          current_value: engagement_rate,
          expected_value: thresholds.platform_engagement_threshold,
          deviation_percentage: ((thresholds.platform_engagement_threshold - engagement_rate) / thresholds.platform_engagement_threshold) * 100,
        })
      }
    }

    if (current.youtube && analysis.platform_performance.youtube) {
      const engagement_rate = analysis.platform_performance.youtube.engagement_rate
      if (engagement_rate < thresholds.platform_engagement_threshold) {
        anomalies.push({
          type: 'platform_anomaly',
          platform: 'youtube',
          severity: 'warning',
          message: `YouTube engagement rate (${(engagement_rate * 100).toFixed(2)}%) is below threshold`,
          current_value: engagement_rate,
          expected_value: thresholds.platform_engagement_threshold,
          deviation_percentage: ((thresholds.platform_engagement_threshold - engagement_rate) / thresholds.platform_engagement_threshold) * 100,
        })
      }
    }

    if (current.facebook && analysis.platform_performance.facebook) {
      const engagement_rate = analysis.platform_performance.facebook.engagement_rate
      if (engagement_rate < thresholds.platform_engagement_threshold) {
        anomalies.push({
          type: 'platform_anomaly',
          platform: 'facebook',
          severity: 'warning',
          message: `Facebook engagement rate (${(engagement_rate * 100).toFixed(2)}%) is below threshold`,
          current_value: engagement_rate,
          expected_value: thresholds.platform_engagement_threshold,
          deviation_percentage: ((thresholds.platform_engagement_threshold - engagement_rate) / thresholds.platform_engagement_threshold) * 100,
        })
      }
    }

    if (current.instagram && analysis.platform_performance.instagram) {
      const engagement_rate = analysis.platform_performance.instagram.engagement_rate
      if (engagement_rate < thresholds.platform_engagement_threshold) {
        anomalies.push({
          type: 'platform_anomaly',
          platform: 'instagram',
          severity: 'warning',
          message: `Instagram engagement rate (${(engagement_rate * 100).toFixed(2)}%) is below threshold`,
          current_value: engagement_rate,
          expected_value: thresholds.platform_engagement_threshold,
          deviation_percentage: ((thresholds.platform_engagement_threshold - engagement_rate) / thresholds.platform_engagement_threshold) * 100,
        })
      }
    }

    return anomalies
}

function detectCorrelationAnomalies(
  analysis: PerformanceAnalysis,
  thresholds: AnomalyDetectorConfig['thresholds']
): Anomaly[] {
    const anomalies: Anomaly[] = []

    // Check if correlation with revenue is unusually low
    Object.entries(analysis.platform_performance).forEach(([platform, performance]) => {
      if (performance.correlation_with_revenue < thresholds.correlation_threshold) {
        anomalies.push({
          type: 'correlation_anomaly',
          platform,
          severity: 'info',
          message: `${platform} correlation with revenue (${performance.correlation_with_revenue.toFixed(2)}) is below expected`,
          current_value: performance.correlation_with_revenue,
          expected_value: thresholds.correlation_threshold,
          deviation_percentage: ((thresholds.correlation_threshold - performance.correlation_with_revenue) / thresholds.correlation_threshold) * 100,
        })
      }
    })

    return anomalies
}

function calculateEngagementDrop(current: number, previous: number): number {
  if (previous === 0) return 0
  return ((previous - current) / previous) * 100
}

export const AnomalyDetector: Detector<AnomalyDetectorConfig, Anomaly[]> = {
  id: 'anomaly_detector',
  name: 'Anomaly Detector',
  description: 'Detects unusual patterns in social media metrics and triggers alerts',
  version: '1.0.0',

  async execute(
    context: DetectorContext,
    config: AnomalyDetectorConfig
  ): Promise<Signal<Anomaly[]>> {
    const { current_metrics, previous_metrics, performance_analysis, thresholds } = config
    const anomalies: Anomaly[] = []

    // Detect engagement drops if we have previous metrics
    if (previous_metrics) {
      anomalies.push(...detectEngagementDrops(current_metrics, previous_metrics, thresholds))
    }

    // Detect platform-specific anomalies
    anomalies.push(...detectPlatformAnomalies(current_metrics, performance_analysis, thresholds))

    // Detect correlation anomalies
    anomalies.push(...detectCorrelationAnomalies(performance_analysis, thresholds))

    // Sort anomalies by severity
    const severity_order = { critical: 0, warning: 1, info: 2 }
    anomalies.sort((a, b) => severity_order[a.severity] - severity_order[b.severity])

    // Log anomalies
    if (anomalies.length > 0) {
      context.logger.warn(`Detected ${anomalies.length} anomalies`, { anomalies })
    }

    return {
      type: 'anomalies',
      timestamp: new Date().toISOString(),
      data: anomalies,
      metadata: {
        total_anomalies: anomalies.length,
        critical: anomalies.filter(a => a.severity === 'critical').length,
        warning: anomalies.filter(a => a.severity === 'warning').length,
        info: anomalies.filter(a => a.severity === 'info').length,
      },
    }
  },
}
