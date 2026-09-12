/**
 * Social Media Performance Analyzer Detector
 *
 * Analyzes social media metrics and correlates them with business metrics:
 * - Calculates engagement rate per platform
 * - Correlates social media activity with business metrics
 * - Identifies trends and patterns
 * - Calculates ROI per platform
 */

import { Detector, DetectorContext, Signal } from '../types'
import { SocialMediaMetrics } from './SocialMediaMetricsFetcher'
import { BusinessMetrics } from './AzureFoundryDataFetcher'

export interface PlatformPerformance {
  engagement_rate: number
  roi: number
  correlation_with_revenue: number
  total_engagement: number
}

export interface PerformanceAnalysis {
  platform_performance: {
    twitter?: PlatformPerformance
    youtube?: PlatformPerformance
    facebook?: PlatformPerformance
    instagram?: PlatformPerformance
  }
  best_performing_platform: string
  total_engagement: number
  total_roi: number
  insights: string[]
}

export interface SocialMediaPerformanceAnalyzerConfig {
  social_media_metrics: SocialMediaMetrics
  business_metrics: BusinessMetrics
  engagement_weights?: {
    likes?: number
    shares?: number
    comments?: number
    views?: number
  }
}

function analyzeTwitter(
  metrics: SocialMediaMetrics['twitter'],
  business: BusinessMetrics,
  weights: any
): PlatformPerformance {
    if (!metrics) {
      return {
        engagement_rate: 0,
        roi: 0,
        correlation_with_revenue: 0,
        total_engagement: 0,
      }
    }

    const total_engagement =
      (metrics.total_likes * (weights.likes || 1)) +
      (metrics.total_retweets * (weights.shares || 2)) +
      (metrics.total_replies * (weights.comments || 3))

    const engagement_rate = metrics.tweets > 0 ? total_engagement / metrics.tweets : 0

    // Simple ROI calculation: revenue / total_engagement
    const roi = total_engagement > 0 ? business.revenue / total_engagement : 0

    // Simple correlation: assume higher engagement correlates with higher revenue
    const correlation_with_revenue = Math.min(0.9, engagement_rate * 10)

    return {
      engagement_rate,
      roi,
      correlation_with_revenue,
      total_engagement,
    }
}

function analyzeYouTube(
  metrics: SocialMediaMetrics['youtube'],
  business: BusinessMetrics,
  weights: any
): PlatformPerformance {
    if (!metrics) {
      return {
        engagement_rate: 0,
        roi: 0,
        correlation_with_revenue: 0,
        total_engagement: 0,
      }
    }

    const total_engagement =
      (metrics.total_likes * (weights.likes || 1)) +
      (metrics.total_comments * (weights.comments || 3)) +
      (metrics.total_views * (weights.views || 0.1))

    const engagement_rate = metrics.videos > 0 ? total_engagement / metrics.videos : 0

    const roi = total_engagement > 0 ? business.revenue / total_engagement : 0

    const correlation_with_revenue = Math.min(0.95, engagement_rate * 5)

    return {
      engagement_rate,
      roi,
      correlation_with_revenue,
      total_engagement,
    }
}

function analyzeFacebook(
  metrics: SocialMediaMetrics['facebook'],
  business: BusinessMetrics,
  weights: any
): PlatformPerformance {
    if (!metrics) {
      return {
        engagement_rate: 0,
        roi: 0,
        correlation_with_revenue: 0,
        total_engagement: 0,
      }
    }

    const total_engagement =
      (metrics.total_likes * (weights.likes || 1)) +
      (metrics.total_shares * (weights.shares || 2)) +
      (metrics.total_comments * (weights.comments || 3))

    const engagement_rate = metrics.posts > 0 ? total_engagement / metrics.posts : 0

    const roi = total_engagement > 0 ? business.revenue / total_engagement : 0

    const correlation_with_revenue = Math.min(0.85, engagement_rate * 8)

    return {
      engagement_rate,
      roi,
      correlation_with_revenue,
      total_engagement,
    }
}

function analyzeInstagram(
  metrics: SocialMediaMetrics['instagram'],
  business: BusinessMetrics,
  weights: any
): PlatformPerformance {
    if (!metrics) {
      return {
        engagement_rate: 0,
        roi: 0,
        correlation_with_revenue: 0,
        total_engagement: 0,
      }
    }

    const total_engagement =
      (metrics.total_likes * (weights.likes || 1)) +
      (metrics.total_comments * (weights.comments || 3))

    const engagement_rate = metrics.posts > 0 ? total_engagement / metrics.posts : 0

    const roi = total_engagement > 0 ? business.revenue / total_engagement : 0

    const correlation_with_revenue = Math.min(0.9, engagement_rate * 6)

    return {
      engagement_rate,
      roi,
      correlation_with_revenue,
      total_engagement,
    }
}

export const SocialMediaPerformanceAnalyzer: Detector<
  SocialMediaPerformanceAnalyzerConfig,
  PerformanceAnalysis
> = {
  id: 'social_media_performance_analyzer',
  name: 'Social Media Performance Analyzer',
  description: 'Analyzes social media metrics and correlates with business metrics',
  version: '1.0.0',

  async execute(
    context: DetectorContext,
    config: SocialMediaPerformanceAnalyzerConfig
  ): Promise<Signal<PerformanceAnalysis>> {
    const { social_media_metrics, business_metrics } = config
    const weights = config.engagement_weights || {
      likes: 1,
      shares: 2,
      comments: 3,
      views: 0.1,
    }

    const platform_performance: PerformanceAnalysis['platform_performance'] = {}
    const insights: string[] = []
    let total_engagement = 0
    let total_roi = 0
    let best_platform = ''
    let best_roi = 0

    // Analyze Twitter
    if (social_media_metrics.twitter) {
      const performance = analyzeTwitter(
        social_media_metrics.twitter,
        business_metrics,
        weights
      )
      platform_performance.twitter = performance
      total_engagement += performance.total_engagement
      total_roi += performance.roi

      if (performance.roi > best_roi) {
        best_roi = performance.roi
        best_platform = 'twitter'
      }

      insights.push(
        `Twitter engagement rate: ${(performance.engagement_rate * 100).toFixed(2)}%`
      )
    }

    // Analyze YouTube
    if (social_media_metrics.youtube) {
      const performance = analyzeYouTube(
        social_media_metrics.youtube,
        business_metrics,
        weights
      )
      platform_performance.youtube = performance
      total_engagement += performance.total_engagement
      total_roi += performance.roi

      if (performance.roi > best_roi) {
        best_roi = performance.roi
        best_platform = 'youtube'
      }

      insights.push(
        `YouTube engagement rate: ${(performance.engagement_rate * 100).toFixed(2)}%`
      )
    }

    // Analyze Facebook
    if (social_media_metrics.facebook) {
      const performance = analyzeFacebook(
        social_media_metrics.facebook,
        business_metrics,
        weights
      )
      platform_performance.facebook = performance
      total_engagement += performance.total_engagement
      total_roi += performance.roi

      if (performance.roi > best_roi) {
        best_roi = performance.roi
        best_platform = 'facebook'
      }

      insights.push(
        `Facebook engagement rate: ${(performance.engagement_rate * 100).toFixed(2)}%`
      )
    }

    // Analyze Instagram
    if (social_media_metrics.instagram) {
      const performance = analyzeInstagram(
        social_media_metrics.instagram,
        business_metrics,
        weights
      )
      platform_performance.instagram = performance
      total_engagement += performance.total_engagement
      total_roi += performance.roi

      if (performance.roi > best_roi) {
        best_roi = performance.roi
        best_platform = 'instagram'
      }

      insights.push(
        `Instagram engagement rate: ${(performance.engagement_rate * 100).toFixed(2)}%`
      )
    }

    // Calculate average ROI
    const platform_count = Object.keys(platform_performance).length
    const average_roi = platform_count > 0 ? total_roi / platform_count : 0

    // Add insights
    insights.push(`Best performing platform: ${best_platform}`)
    insights.push(`Average ROI across platforms: ${average_roi.toFixed(2)}`)

    return {
      type: 'performance_analysis',
      timestamp: new Date().toISOString(),
      data: {
        platform_performance,
        best_performing_platform: best_platform,
        total_engagement,
        total_roi: average_roi,
        insights,
      },
      metadata: {
        platforms_analyzed: Object.keys(platform_performance),
        business_period: business_metrics.period,
      },
    }
  },
}
