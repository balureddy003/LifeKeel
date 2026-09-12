/**
 * Insight Generator Detector
 *
 * Generates actionable insights from performance analysis:
 * - Identifies best-performing platforms
 * - Suggests content optimization strategies
 * - Recommends posting schedules
 * - Highlights opportunities for improvement
 */

import { Detector, DetectorContext, Signal } from '../types'
import { PerformanceAnalysis } from './SocialMediaPerformanceAnalyzer'

export interface Insight {
  type: 'recommendation' | 'opportunity' | 'trend' | 'warning'
  platform: string
  message: string
  priority: 'high' | 'medium' | 'low'
}

export interface InsightGeneratorConfig {
  performance_analysis: PerformanceAnalysis
  business_metrics?: {
    revenue: number
    conversions: number
    traffic: number
  }
}

function generateTwitterInsights(
  performance: any,
  best_platform: string
): Insight[] {
    const insights: Insight[] = []

    if (performance.roi > 2.5) {
      insights.push({
        type: 'recommendation',
        platform: 'twitter',
        message: `Twitter has strong ROI (${performance.roi.toFixed(2)}). Increase tweet frequency and engagement.`,
        priority: 'high',
      })
    } else if (performance.roi < 1.5) {
      insights.push({
        type: 'opportunity',
        platform: 'twitter',
        message: `Twitter ROI is low (${performance.roi.toFixed(2)}). Review content strategy and posting times.`,
        priority: 'medium',
      })
    }

    if (performance.engagement_rate > 0.2) {
      insights.push({
        type: 'trend',
        platform: 'twitter',
        message: 'Twitter engagement is above average. Consider running more interactive campaigns.',
        priority: 'medium',
      })
    }

    if (best_platform === 'twitter') {
      insights.push({
        type: 'recommendation',
        platform: 'twitter',
        message: 'Twitter is your best-performing platform. Allocate more resources here.',
        priority: 'high',
      })
    }

    return insights
}

function generateYouTubeInsights(
  performance: any,
  best_platform: string
): Insight[] {
    const insights: Insight[] = []

    if (performance.roi > 3.0) {
      insights.push({
        type: 'recommendation',
        platform: 'youtube',
        message: `YouTube has excellent ROI (${performance.roi.toFixed(2)}). Invest in video content production.`,
        priority: 'high',
      })
    } else if (performance.roi < 2.0) {
      insights.push({
        type: 'opportunity',
        platform: 'youtube',
        message: `YouTube ROI is suboptimal (${performance.roi.toFixed(2)}). Improve video quality and SEO.`,
        priority: 'medium',
      })
    }

    if (performance.correlation_with_revenue > 0.8) {
      insights.push({
        type: 'trend',
        platform: 'youtube',
        message: 'YouTube activity strongly correlates with revenue. Focus on video marketing.',
        priority: 'high',
      })
    }

    if (best_platform === 'youtube') {
      insights.push({
        type: 'recommendation',
        platform: 'youtube',
        message: 'YouTube is your best-performing platform. Expand video content strategy.',
        priority: 'high',
      })
    }

    return insights
}

function generateFacebookInsights(
  performance: any,
  best_platform: string
): Insight[] {
    const insights: Insight[] = []

    if (performance.roi > 2.0) {
      insights.push({
        type: 'recommendation',
        platform: 'facebook',
        message: `Facebook ROI is solid (${performance.roi.toFixed(2)}). Continue current strategy.`,
        priority: 'medium',
      })
    } else if (performance.roi < 1.5) {
      insights.push({
        type: 'opportunity',
        platform: 'facebook',
        message: `Facebook ROI needs improvement (${performance.roi.toFixed(2)}). Try different content formats.`,
        priority: 'medium',
      })
    }

    if (performance.engagement_rate < 0.1) {
      insights.push({
        type: 'warning',
        platform: 'facebook',
        message: 'Facebook engagement is low. Review post timing and content.',
        priority: 'medium',
      })
    }

    if (best_platform === 'facebook') {
      insights.push({
        type: 'recommendation',
        platform: 'facebook',
        message: 'Facebook is your best-performing platform. Leverage this for campaigns.',
        priority: 'high',
      })
    }

    return insights
}

function generateInstagramInsights(
  performance: any,
  best_platform: string
): Insight[] {
    const insights: Insight[] = []

    if (performance.roi > 2.5) {
      insights.push({
        type: 'recommendation',
        platform: 'instagram',
        message: `Instagram ROI is strong (${performance.roi.toFixed(2)}). Focus on visual content.`,
        priority: 'high',
      })
    } else if (performance.roi < 2.0) {
      insights.push({
        type: 'opportunity',
        platform: 'instagram',
        message: `Instagram ROI is moderate (${performance.roi.toFixed(2)}). Optimize for conversions.`,
        priority: 'medium',
      })
    }

    if (performance.engagement_rate > 0.15) {
      insights.push({
        type: 'trend',
        platform: 'instagram',
        message: 'Instagram engagement is high. Use Stories and Reels for more reach.',
        priority: 'medium',
      })
    }

    if (best_platform === 'instagram') {
      insights.push({
        type: 'recommendation',
        platform: 'instagram',
        message: 'Instagram is your best-performing platform. Invest in visual storytelling.',
        priority: 'high',
      })
    }

    return insights
}

function generateCrossPlatformInsights(
  analysis: PerformanceAnalysis,
  business_metrics?: any
): Insight[] {
    const insights: Insight[] = []

    // Overall ROI insight
    if (analysis.total_roi > 2.5) {
      insights.push({
        type: 'trend',
        platform: 'all',
        message: `Overall social media ROI is excellent (${analysis.total_roi.toFixed(2)}). Current strategy is working well.`,
        priority: 'high',
      })
    } else if (analysis.total_roi < 1.5) {
      insights.push({
        type: 'warning',
        platform: 'all',
        message: `Overall social media ROI is low (${analysis.total_roi.toFixed(2)}). Review overall strategy.`,
        priority: 'high',
      })
    }

    // Best platform insight
    insights.push({
      type: 'recommendation',
      platform: 'all',
      message: `${analysis.best_performing_platform.toUpperCase()} is your best-performing platform. Consider doubling down on this channel.`,
      priority: 'high',
    })

    // Business correlation insight
    if (business_metrics && business_metrics.revenue > 0) {
      insights.push({
        type: 'trend',
        platform: 'all',
        message: `Social media activity correlates with $${business_metrics.revenue.toLocaleString()} in revenue.`,
        priority: 'medium',
      })
    }

    return insights
}

export const InsightGenerator: Detector<InsightGeneratorConfig, Insight[]> = {
  id: 'insight_generator',
  name: 'Insight Generator',
  description: 'Generates actionable insights from performance analysis',
  version: '1.0.0',

  async execute(
    context: DetectorContext,
    config: InsightGeneratorConfig
  ): Promise<Signal<Insight[]>> {
    const { performance_analysis, business_metrics } = config
    const insights: Insight[] = []

    const { platform_performance, best_performing_platform, total_roi } = performance_analysis

    // Generate insights for each platform
    if (platform_performance.twitter) {
      insights.push(...generateTwitterInsights(platform_performance.twitter, best_performing_platform))
    }

    if (platform_performance.youtube) {
      insights.push(...generateYouTubeInsights(platform_performance.youtube, best_performing_platform))
    }

    if (platform_performance.facebook) {
      insights.push(...generateFacebookInsights(platform_performance.facebook, best_performing_platform))
    }

    if (platform_performance.instagram) {
      insights.push(...generateInstagramInsights(platform_performance.instagram, best_performing_platform))
    }

    // Generate cross-platform insights
    insights.push(...generateCrossPlatformInsights(performance_analysis, business_metrics))

    // Sort insights by priority
    const priority_order = { high: 0, medium: 1, low: 2 }
    insights.sort((a, b) => priority_order[a.priority] - priority_order[b.priority])

    return {
      type: 'insights',
      timestamp: new Date().toISOString(),
      data: insights,
      metadata: {
        total_insights: insights.length,
        high_priority: insights.filter(i => i.priority === 'high').length,
        medium_priority: insights.filter(i => i.priority === 'medium').length,
        low_priority: insights.filter(i => i.priority === 'low').length,
      },
    }
  },
}
