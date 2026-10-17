/**
 * Social Analytics Poller — fetches post performance metrics 24h after publishing
 * and fires them as `social.post.performance` events into the LifeKeel engine.
 *
 * Platforms supported:
 *   LinkedIn: GET /v2/organizationalEntityShareStatistics
 *   Twitter:  GET /2/tweets/:id?tweet.fields=public_metrics,non_public_metrics
 *
 * Scheduling:
 *   Runs every 6 hours. For each action_receipt with status=success and
 *   external_id set, checks if 24h have passed since execution, fetches
 *   metrics, fires the event, and marks the receipt as analytics_fetched=true.
 *
 * The fired event carries:
 *   {
 *     post_id:          'urn:li:share:...' | '1234567890',
 *     platform:         'linkedin' | 'twitter',
 *     impressions:      number,
 *     engagement_rate:  number,   // (likes + comments + shares) / impressions
 *     likes:            number,
 *     comments:         number,
 *     shares:           number,
 *     clicks:           number,
 *     follower_delta:   number,   // follower change since last poll
 *     insight_id:       string,   // originating LifeKeel insight
 *     posted_at:        ISO string,
 *   }
 */

import type { Db } from 'mongodb'
import type { Engine, Insight } from '@lifekeel/engine'
import { decryptIfNeeded, createLogger } from '@lifekeel/platform'

const log = createLogger({ service: 'social-analytics', version: '0.0.0' })

interface ActionReceiptDoc {
  insight_id: string
  tenant_id: string
  action_type: string
  external_id?: string
  external_platform?: string
  executed_at: Date
  analytics_fetched?: boolean
}

type SocialInsightHandler = (insights: Insight[], tenantId: string) => Promise<void> | void

export class SocialAnalyticsPoller {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private receipts: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private creds: any

  constructor(
    private readonly db: Db,
    private readonly engine: Engine,
    private readonly onInsights?: SocialInsightHandler,
  ) {
    this.receipts = db.collection('action_receipts')
    this.creds    = db.collection('connector_credentials')
    // Index for efficient polling query
    this.receipts.createIndex(
      { external_id: 1, analytics_fetched: 1, executed_at: 1 },
    ).catch(() => {})
  }

  // ── Main poll cycle ─────────────────────────────────────────────────────────

  async poll(): Promise<{ fetched: number; errors: number }> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)  // 24h ago
    let fetched = 0, errors = 0

    // Find receipts published > 24h ago, not yet fetched
    const pending = await this.receipts.find({
      external_id:       { $exists: true, $ne: '' },
      analytics_fetched: { $ne: true },
      executed_at:       { $lte: cutoff },
      action_type:       { $in: ['post_linkedin', 'post_twitter'] },
    }).limit(50).toArray() as ActionReceiptDoc[]

    for (const receipt of pending) {
      try {
        await this.fetchAndFire(receipt)
        await this.receipts.updateOne(
          { insight_id: receipt.insight_id, external_id: receipt.external_id },
          { $set: { analytics_fetched: true, analytics_fetched_at: new Date() } },
        )
        fetched++
      } catch (err) {
        log.warn({ external_id: receipt.external_id, err }, 'Failed to fetch metrics')
        errors++
      }
    }

    return { fetched, errors }
  }

  // ── Fetch metrics and fire engine event ──────────────────────────────────────

  private async fetchAndFire(receipt: ActionReceiptDoc): Promise<void> {
    const platform = receipt.external_platform ?? 'unknown'
    let metrics: Record<string, number> = {}

    if (platform === 'linkedin') {
      metrics = await this.fetchLinkedIn(receipt)
    } else if (platform === 'twitter') {
      metrics = await this.fetchTwitter(receipt)
    } else {
      return  // unsupported platform — skip
    }

    const impressions     = metrics['impressions'] ?? 0
    const likes           = metrics['likes'] ?? 0
    const comments        = metrics['comments'] ?? 0
    const shares          = metrics['shares'] ?? 0
    const clicks          = metrics['clicks'] ?? 0
    const followerDelta   = metrics['follower_delta'] ?? 0
    const engagementRate  = impressions > 0
      ? Math.round(((likes + comments + shares) / impressions) * 10000) / 10000
      : 0

    // Fire as a LifeKeel event — the engine will evaluate social performance detectors
    const evaluation = await this.engine.evaluate({
      event_type: 'social.post.performance',
      tenant_id:  receipt.tenant_id,
      event_id:   `analytics_${receipt.external_id}_${Date.now()}`,
      data: {
        post_id:         receipt.external_id,
        platform,
        impressions,
        engagement_rate: engagementRate,
        likes,
        comments,
        shares,
        clicks,
        follower_delta:  followerDelta,
        insight_id:      receipt.insight_id,
        posted_at:       receipt.executed_at.toISOString(),
      },
    })
    if (evaluation.insights.length > 0) {
      await this.onInsights?.(evaluation.insights, receipt.tenant_id)
    }

    // Also push a snapshot to any linked goals
    await this.updateGoalKpis(receipt.tenant_id, platform, {
      impressions, engagementRate, followerDelta, likes, comments,
    })
  }

  // ── LinkedIn metrics ─────────────────────────────────────────────────────────

  private async fetchLinkedIn(receipt: ActionReceiptDoc): Promise<Record<string, number>> {
    const cred = await this.creds.findOne(
      { tenant_id: receipt.tenant_id, connector_id: 'linkedin' },
    ) as Record<string, string> | null
    if (!cred?.access_token) throw new Error('LinkedIn not connected')

    const token = decryptIfNeeded(cred.access_token)
    if (!token) throw new Error('LinkedIn token missing')

    // Share statistics
    const statsUrl = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(receipt.external_id!)}`
    const res = await fetch(statsUrl, {
      headers: {
        Authorization:              `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    })
    if (!res.ok) throw new Error(`LinkedIn stats ${res.status}`)

    const data = await res.json() as {
      likesSummary?:    { totalLikes?: number }
      commentsSummary?: { totalFirstLevelComments?: number }
    }

    // Org follower count (separate endpoint)
    const authorUrn = cred.author_urn as string | undefined
    let followerDelta = 0
    if (authorUrn) {
      const orgId = authorUrn.replace('urn:li:organization:', '')
      const followerRes = await fetch(
        `https://api.linkedin.com/v2/networkSizes/${encodeURIComponent(`urn:li:organization:${orgId}`)}?edgeType=CompanyFollowedByMember`,
        { headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' } },
      )
      if (followerRes.ok) {
        const fData = await followerRes.json() as { firstDegreeSize?: number }
        // Delta = current - last stored (simplified: we store in goal snapshot)
        followerDelta = fData.firstDegreeSize ?? 0
      }
    }

    return {
      likes:          data.likesSummary?.totalLikes ?? 0,
      comments:       data.commentsSummary?.totalFirstLevelComments ?? 0,
      shares:         0,   // requires separate call
      clicks:         0,   // only available via Campaign Manager API
      impressions:    0,   // only available via org analytics API
      follower_delta: followerDelta,
    }
  }

  // ── Twitter metrics ──────────────────────────────────────────────────────────

  private async fetchTwitter(receipt: ActionReceiptDoc): Promise<Record<string, number>> {
    const cred = await this.creds.findOne(
      { tenant_id: receipt.tenant_id, connector_id: 'twitter_x' },
    ) as Record<string, string> | null
    if (!cred?.access_token) throw new Error('Twitter not connected')

    const token = decryptIfNeeded(cred.access_token)
    if (!token) throw new Error('Twitter token missing')

    const url = `https://api.x.com/2/tweets/${receipt.external_id}?tweet.fields=public_metrics`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Twitter metrics ${res.status}`)

    const data = await res.json() as {
      data?: {
        public_metrics?: {
          retweet_count?: number
          reply_count?: number
          like_count?: number
          quote_count?: number
          impression_count?: number
          bookmark_count?: number
        }
      }
    }

    const m = data.data?.public_metrics ?? {}
    const impressions = m.impression_count ?? 0
    const likes       = m.like_count ?? 0
    const comments    = m.reply_count ?? 0
    const shares      = (m.retweet_count ?? 0) + (m.quote_count ?? 0)

    return { impressions, likes, comments, shares, clicks: m.bookmark_count ?? 0, follower_delta: 0 }
  }

  // ── Update linked goal KPIs ───────────────────────────────────────────────────

  private async updateGoalKpis(
    tenantId: string,
    platform: string,
    metrics: {
      impressions: number
      engagementRate: number
      followerDelta: number
      likes: number
      comments: number
    },
  ): Promise<void> {
    const metricAliases = [
      {
        metric: `${platform}_followers`,
        value: (current: number) => current + metrics.followerDelta,
      },
      {
        metric: `${platform}_engagement_rate`,
        value: () => metrics.engagementRate,
      },
      {
        metric: `${platform}_impressions`,
        value: (current: number) => current + metrics.impressions,
      },
      ...(platform === 'twitter'
        ? [
            {
              metric: 'x_followers',
              value: (current: number) => current + metrics.followerDelta,
            },
            {
              metric: 'x_engagement_rate',
              value: () => metrics.engagementRate,
            },
            {
              metric: 'x_impressions',
              value: (current: number) => current + metrics.impressions,
            },
            {
              metric: 'twitter_x_followers',
              value: (current: number) => current + metrics.followerDelta,
            },
            {
              metric: 'twitter_x_engagement_rate',
              value: () => metrics.engagementRate,
            },
            {
              metric: 'twitter_x_impressions',
              value: (current: number) => current + metrics.impressions,
            },
          ]
        : []),
    ]

    // Find active goals with social KPIs for this tenant
    const goals = await this.db.collection('goals').find({
      tenant_id: tenantId,
      status:    'active',
      'kpis.metric': { $in: metricAliases.map(alias => alias.metric) },
    }).toArray() as unknown as Array<{ id: string; kpis: Array<{ metric: string; current: number }> }>

    for (const goal of goals) {
      for (const kpi of goal.kpis) {
        const alias = metricAliases.find(entry => entry.metric === kpi.metric)
        if (!alias) continue
        const newValue = alias.value(kpi.current)

        // Push snapshot via the goal route logic (direct DB write for the job)
        const kpiIdx = goal.kpis.findIndex(k => k.metric === kpi.metric)
        await this.db.collection('goals').updateOne(
          { id: goal.id, tenant_id: tenantId },
          { $set: { [`kpis.${kpiIdx}.current`]: newValue, updated_at: new Date() } },
        )
        await this.db.collection('goal_kpi_snapshots').insertOne({
          tenant_id:  tenantId,
          goal_id:    goal.id,
          metric:     kpi.metric,
          value:      newValue,
          source:     `${platform}_analytics_poller`,
          recorded_at: new Date(),
        })
      }
    }
  }
}
