import type { Db } from 'mongodb'
import { decryptIfNeeded } from '@kairos/platform'

interface XCredential {
  tenant_id: string
  connector_id: string
  access_token?: string
}

interface GoalKpi {
  metric: string
  current: number
}

interface GoalDoc {
  id: string
  tenant_id: string
  status: string
  kpis?: GoalKpi[]
}

interface XUserResponse {
  data?: {
    id?: string
    username?: string
    public_metrics?: {
      followers_count?: number
    }
  }
}

interface XTweetsResponse {
  data?: Array<{
    id?: string
    public_metrics?: {
      retweet_count?: number
      reply_count?: number
      like_count?: number
      quote_count?: number
      impression_count?: number
    }
  }>
}

export interface XGoalMetricsSyncResult {
  connected: boolean
  goals_updated: number
  kpis_updated: number
  username?: string
  followers?: number
  posts_seen?: number
  impressions?: number
  engagement_rate?: number
  impressions_available?: boolean
  note?: string
}

const X_METRIC_ALIASES = {
  followers: ['twitter_followers', 'x_followers', 'twitter_x_followers'],
  impressions: ['twitter_impressions', 'x_impressions', 'twitter_x_impressions'],
  engagementRate: ['twitter_engagement_rate', 'x_engagement_rate', 'twitter_x_engagement_rate'],
}

function metricKind(metric: string): keyof typeof X_METRIC_ALIASES | null {
  for (const [kind, aliases] of Object.entries(X_METRIC_ALIASES)) {
    if (aliases.includes(metric)) return kind as keyof typeof X_METRIC_ALIASES
  }
  return null
}

function hasXKpi(goal: GoalDoc): boolean {
  return (goal.kpis ?? []).some(kpi => metricKind(kpi.metric))
}

export class XGoalMetricsSync {
  constructor(
    private readonly db: Db,
    private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  ) {}

  async syncGoal(tenantId: string, goalId: string): Promise<XGoalMetricsSyncResult> {
    const goal = await this.db.collection<GoalDoc>('goals').findOne({ tenant_id: tenantId, id: goalId })
    if (!goal) throw new Error(`Goal not found: ${goalId}`)
    if (!hasXKpi(goal)) {
      return { connected: false, goals_updated: 0, kpis_updated: 0, note: 'Goal has no X KPI metrics' }
    }

    const metrics = await this.fetchMetrics(tenantId)
    if (!metrics.connected) return metrics
    const kpisUpdated = await this.updateGoal(goal, metrics)
    return {
      ...metrics,
      goals_updated: kpisUpdated > 0 ? 1 : 0,
      kpis_updated: kpisUpdated,
    }
  }

  async syncTenant(tenantId: string): Promise<XGoalMetricsSyncResult> {
    const metrics = await this.fetchMetrics(tenantId)
    if (!metrics.connected) return metrics

    const goals = await this.db.collection<GoalDoc>('goals')
      .find({ tenant_id: tenantId, status: 'active' })
      .toArray()

    let goalsUpdated = 0
    let kpisUpdated = 0
    for (const goal of goals) {
      if (!hasXKpi(goal)) continue
      const updated = await this.updateGoal(goal, metrics)
      if (updated > 0) goalsUpdated++
      kpisUpdated += updated
    }

    return {
      ...metrics,
      goals_updated: goalsUpdated,
      kpis_updated: kpisUpdated,
    }
  }

  private async fetchMetrics(tenantId: string): Promise<XGoalMetricsSyncResult> {
    const cred = await this.db.collection<XCredential>('connector_credentials')
      .findOne({ tenant_id: tenantId, connector_id: 'twitter_x' })
    if (!cred?.access_token) {
      return { connected: false, goals_updated: 0, kpis_updated: 0, note: 'X is not connected' }
    }

    const token = decryptIfNeeded(cred.access_token)
    if (!token) {
      return { connected: false, goals_updated: 0, kpis_updated: 0, note: 'X access token is missing' }
    }

    const user = await this.getXJson<XUserResponse>(
      'https://api.x.com/2/users/me?user.fields=public_metrics',
      token,
      'X profile metrics',
    )
    const userId = user.data?.id
    if (!userId) throw new Error('X profile did not include a user id')

    const tweets = await this.getXJson<XTweetsResponse>(
      `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?max_results=10&tweet.fields=created_at,public_metrics`,
      token,
      'X recent posts',
    ).catch(() => ({ data: [] }))

    const posts = tweets.data ?? []
    let impressions = 0
    let engagements = 0
    let impressionsAvailable = false

    for (const post of posts) {
      const metrics = post.public_metrics ?? {}
      if (typeof metrics.impression_count === 'number') {
        impressionsAvailable = true
        impressions += metrics.impression_count
      }
      engagements +=
        (metrics.like_count ?? 0) +
        (metrics.reply_count ?? 0) +
        (metrics.retweet_count ?? 0) +
        (metrics.quote_count ?? 0)
    }

    const engagementRate = impressions > 0
      ? Math.round((engagements / impressions) * 10000) / 10000
      : 0

    const result: XGoalMetricsSyncResult = {
      connected: true,
      goals_updated: 0,
      kpis_updated: 0,
      followers: user.data?.public_metrics?.followers_count ?? 0,
      posts_seen: posts.length,
      impressions,
      engagement_rate: engagementRate,
      impressions_available: impressionsAvailable,
    }
    if (user.data?.username) result.username = user.data.username
    if (!impressionsAvailable && posts.length > 0) {
      result.note = 'X returned recent posts but no impression_count values for this token.'
    }
    return result
  }

  private async getXJson<T>(url: string, token: string, label: string): Promise<T> {
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json().catch(() => ({})) as T & { title?: string; detail?: string; error?: string }
    if (!res.ok) {
      throw new Error(`${label} failed: ${body.error ?? body.detail ?? body.title ?? `HTTP ${res.status}`}`)
    }
    return body
  }

  private async updateGoal(goal: GoalDoc, metrics: XGoalMetricsSyncResult): Promise<number> {
    const kpis = goal.kpis ?? []
    let updated = 0

    for (let i = 0; i < kpis.length; i++) {
      const kpi = kpis[i]
      if (!kpi) continue
      const kind = metricKind(kpi.metric)
      if (!kind) continue

      const value = kind === 'followers'
        ? metrics.followers ?? 0
        : kind === 'impressions'
          ? metrics.impressions ?? 0
          : metrics.engagement_rate ?? 0

      await this.db.collection('goals').updateOne(
        { id: goal.id, tenant_id: goal.tenant_id },
        { $set: { [`kpis.${i}.current`]: value, updated_at: new Date() } },
      )
      await this.db.collection('goal_kpi_snapshots').insertOne({
        tenant_id: goal.tenant_id,
        goal_id: goal.id,
        metric: kpi.metric,
        value,
        prev_value: kpi.current ?? 0,
        source: 'twitter_x_sync',
        metadata: {
          username: metrics.username,
          posts_seen: metrics.posts_seen,
          impressions_available: metrics.impressions_available,
          note: metrics.note,
        },
        recorded_at: new Date(),
      })
      updated++
    }

    return updated
  }
}
