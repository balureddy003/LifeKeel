/**
 * Retention and trust metrics for a product people do not open (PRD-141).
 *
 * Definitions live here, next to the code, so they cannot drift from what is
 * computed. Every figure is aggregated across families; a number whose cohort
 * is smaller than MIN_COHORT is returned as null rather than shown, so an
 * operator cannot read one family's behaviour out of an average.
 *
 * What this is not: a causal estimate. "Received value" retention has no
 * holdout, so it is descriptive. Paying-user retention waits for billing
 * cutover (PRD-006); until then this covers free-tier families only.
 * Metadata only: counts and states, never message or document content.
 */
import type { Db } from 'mongodb'
import { freshnessShare, type FreshnessState } from '../freshness/inputs.js'

/** Smallest cohort a metric may be shown for. A hypothesis; raise it for sensitive cuts. */
export const MIN_COHORT = 10

export const METRIC_DEFINITIONS = {
  digest_delivery:
    'Quiet Care digests scheduled versus delivered over the last 90 days: delivered = confirmed sends, scheduled = sends attempted. Source: job_runs for the monthly heartbeat.',
  data_freshness:
    'Mean, across families, of the share of applicable checks running on current inputs (PRD-145). Families with no applicable check are excluded.',
  digest_engagement:
    'Digest clicks per 100 digests sent over the last 90 days, split by variant (all_clear, note, missed). Clicks, not opens: no tracking pixel is used. One digest can produce more than one click.',
  notification_health:
    'Heartbeat unsubscribes in the last 90 days per 100 digests sent, plus the share of families on digest-only delivery and the share with the heartbeat off.',
  received_value_retention:
    'Of free-tier families created in the calendar month N months ago (N = 3 and 6) and still active, the share that received value in the last 30 days. Received value = a digest click while signed in, a confirmed profile review, or a resolved gap. Descriptive only: no holdout, no counterfactual.',
  perceived_protection:
    'Mean and spread of the optional quarterly answer (1 to 5) to "How confident are you that your family\'s key items are covered?", for the current quarter. Skips are not counted.',
} as const

const DAY = 86_400_000
const SINCE_DAYS = 90

/** A cohort smaller than MIN_COHORT yields null; callers never see the raw size. */
export const shown = <T>(n: number, value: T): T | null => (n >= MIN_COHORT ? value : null)

export const quarterOf = (d: Date) =>
  `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`

export interface RetentionMetrics {
  generated_at: string
  min_cohort: number
  definitions: typeof METRIC_DEFINITIONS
  digest_delivery: { scheduled: number; delivered: number; rate: number | null }
  data_freshness: { mean_share_running: number | null; families: number | null }
  digest_engagement: Record<string, { clicks_per_100: number | null }>
  notification_health: {
    unsubscribes_per_100_digests: number | null
    digest_only_share: number | null
    heartbeat_off_share: number | null
  }
  received_value_retention: Record<'month_3' | 'month_6', { retained_share: number | null }>
  perceived_protection: { quarter: string; mean: number | null; responses: number | null }
}

const VARIANTS = ['all_clear', 'note', 'missed'] as const

async function monthCohort(db: Db, now: Date, monthsAgo: number) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1))
  const tenants = (await db
    .collection('tenants')
    .find({ created_at: { $gte: start, $lt: end }, status: 'active', plan: 'free' })
    .project({ tenant_id: 1 })
    .toArray()) as unknown as { tenant_id: string }[]
  const ids = tenants.map((t) => t.tenant_id)
  if (ids.length === 0) return { size: 0, retained: 0 }
  const since = new Date(now.getTime() - 30 * DAY)
  const [clicks, reviewed, resolved] = await Promise.all([
    db
      .collection('value_events')
      .distinct('tenant_id', { tenant_id: { $in: ids }, at: { $gte: since } }),
    db
      .collection('family_financial_profile')
      .distinct('tenant_id', { tenant_id: { $in: ids }, reviewed_at: { $gte: since } }),
    db
      .collection('insights')
      .distinct('tenant_id', { tenant_id: { $in: ids }, resolved_at: { $gte: since } }),
  ])
  const retained = new Set([...clicks, ...reviewed, ...resolved] as string[])
  return { size: ids.length, retained: retained.size }
}

export async function computeRetentionMetrics(db: Db, now = new Date()): Promise<RetentionMetrics> {
  const since = new Date(now.getTime() - SINCE_DAYS * DAY)

  // Delivery: the monthly digest's own run records.
  const runs = (await db
    .collection('job_runs')
    .find({ job: 'family-heartbeat-monthly', ran_at: { $gte: since } })
    .toArray()) as unknown as { sent?: number; failed?: number }[]
  const delivered = runs.reduce((n, r) => n + (r.sent ?? 0), 0)
  const scheduled = runs.reduce((n, r) => n + (r.sent ?? 0) + (r.failed ?? 0), 0)

  // Freshness: mean of per-family shares.
  const states = (await db
    .collection('freshness_state')
    .find({})
    .project({ tenant_id: 1, state: 1 })
    .toArray()) as unknown as { tenant_id: string; state: FreshnessState }[]
  const byTenant = new Map<string, { state: FreshnessState }[]>()
  for (const s of states) byTenant.set(s.tenant_id, [...(byTenant.get(s.tenant_id) ?? []), s])
  const shares = [...byTenant.values()]
    .map((rows) => freshnessShare(rows))
    .filter((x): x is number => x !== null)

  // Engagement: clicks over sends, per variant.
  const sentRows = (await db
    .collection('heartbeat_sends')
    .find({ sent_at: { $gte: since }, variant: { $in: [...VARIANTS] } })
    .project({ variant: 1 })
    .toArray()) as unknown as { variant: string }[]
  const clickRows = (await db
    .collection('growth_events')
    .find({ event: 'digest_click', created_at: { $gte: since } })
    .project({ meta: 1 })
    .toArray()) as unknown as { meta?: { v?: string } }[]
  const engagement: RetentionMetrics['digest_engagement'] = {}
  for (const v of VARIANTS) {
    const sent = sentRows.filter((r) => r.variant === v).length
    const clicks = clickRows.filter((r) => r.meta?.v === v).length
    engagement[v] = { clicks_per_100: shown(sent, Math.round((clicks / sent) * 1000) / 10) }
  }
  const sentAll = sentRows.length

  // Notification health.
  const unsubs = await db
    .collection('growth_events')
    .countDocuments({ event: 'heartbeat_unsubscribed', created_at: { $gte: since } })
  const prefs = (await db
    .collection('delivery_preferences')
    .find({})
    .project({ digest_mode: 1, heartbeat_cadence: 1 })
    .toArray()) as unknown as { digest_mode?: boolean; heartbeat_cadence?: string }[]

  // Perceived protection: this quarter, answers only.
  const quarter = quarterOf(now)
  const answers = (await db
    .collection('perceived_protection')
    .find({ quarter, score: { $gte: 1 } })
    .project({ score: 1 })
    .toArray()) as unknown as { score: number }[]

  const [m3, m6] = await Promise.all([monthCohort(db, now, 3), monthCohort(db, now, 6)])
  const retained = (c: { size: number; retained: number }) => ({
    retained_share: shown(c.size, Math.round((c.retained / c.size) * 1000) / 1000),
  })

  return {
    generated_at: now.toISOString(),
    min_cohort: MIN_COHORT,
    definitions: METRIC_DEFINITIONS,
    digest_delivery: {
      scheduled,
      delivered,
      rate: scheduled === 0 ? null : Math.round((delivered / scheduled) * 1000) / 1000,
    },
    data_freshness: {
      mean_share_running: shown(
        shares.length,
        Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 1000) / 1000,
      ),
      families: shown(shares.length, shares.length),
    },
    digest_engagement: engagement,
    notification_health: {
      unsubscribes_per_100_digests: shown(sentAll, Math.round((unsubs / sentAll) * 1000) / 10),
      digest_only_share: shown(
        prefs.length,
        Math.round((prefs.filter((p) => p.digest_mode === true).length / prefs.length) * 1000) /
          1000,
      ),
      heartbeat_off_share: shown(
        prefs.length,
        Math.round(
          (prefs.filter((p) => p.heartbeat_cadence === 'off').length / prefs.length) * 1000,
        ) / 1000,
      ),
    },
    received_value_retention: { month_3: retained(m3), month_6: retained(m6) },
    perceived_protection: {
      quarter,
      mean: shown(
        answers.length,
        Math.round((answers.reduce((a, r) => a + r.score, 0) / answers.length) * 100) / 100,
      ),
      responses: shown(answers.length, answers.length),
    },
  }
}
