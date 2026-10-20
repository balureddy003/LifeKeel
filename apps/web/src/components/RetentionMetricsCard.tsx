'use client'

/**
 * PRD-141 operator view: retention and trust metrics, aggregated. A figure
 * whose cohort is below the API's minimum arrives as null and renders as "not
 * enough families yet", never as zero. Definitions sit under each figure so a
 * number cannot be read without its meaning.
 */
import { GlassCard } from '@/components/Glass'
import type { RetentionMetrics } from '@/lib/api'

const pct = (n: number | null) => (n === null ? null : `${Math.round(n * 1000) / 10}%`)
const NOT_ENOUGH = 'Not enough families yet'

function Row({ label, value, note }: { label: string; value: string | null; note: string }) {
  return (
    <div className="py-2 border-b border-tint/[0.06] last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink-secondary">{label}</span>
        <span className={`text-sm font-semibold ${value === null ? 'text-ink-tertiary' : ''}`}>
          {value ?? NOT_ENOUGH}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-ink-tertiary leading-relaxed">{note}</p>
    </div>
  )
}

export function RetentionMetricsCard({ metrics: m }: { metrics: RetentionMetrics }) {
  const d = m.definitions
  const eng = m.digest_engagement
  const click = (v: string) => {
    const n = eng[v]?.clicks_per_100 ?? null
    return n === null ? null : `${n} per 100`
  }
  return (
    <GlassCard className="p-4 mt-5">
      <h2 className="text-base font-semibold">Retention and trust</h2>
      <p className="mt-1 text-xs text-ink-tertiary">
        Aggregated across families. Anything under {m.min_cohort} families is hidden. Free tier only
        until billing cutover; the retention figure is descriptive, not causal.
      </p>
      <div className="mt-2">
        <Row
          label="Digests delivered"
          value={
            m.digest_delivery.scheduled === 0
              ? null
              : `${m.digest_delivery.delivered} of ${m.digest_delivery.scheduled} (${pct(m.digest_delivery.rate)})`
          }
          note={d['digest_delivery'] ?? ''}
        />
        <Row
          label="Checks running on current details"
          value={pct(m.data_freshness.mean_share_running)}
          note={d['data_freshness'] ?? ''}
        />
        <Row
          label="Clicks: all clear / has a note / couldn’t check"
          value={
            click('all_clear') === null && click('note') === null && click('missed') === null
              ? null
              : [click('all_clear') ?? '—', click('note') ?? '—', click('missed') ?? '—'].join(
                  ' / ',
                )
          }
          note={d['digest_engagement'] ?? ''}
        />
        <Row
          label="Unsubscribes per 100 digests"
          value={
            m.notification_health.unsubscribes_per_100_digests === null
              ? null
              : String(m.notification_health.unsubscribes_per_100_digests)
          }
          note={d['notification_health'] ?? ''}
        />
        <Row
          label="Received value, month 3 / month 6"
          value={
            m.received_value_retention.month_3.retained_share === null &&
            m.received_value_retention.month_6.retained_share === null
              ? null
              : `${pct(m.received_value_retention.month_3.retained_share) ?? '—'} / ${pct(m.received_value_retention.month_6.retained_share) ?? '—'}`
          }
          note={d['received_value_retention'] ?? ''}
        />
        <Row
          label={`Perceived protection, ${m.perceived_protection.quarter}`}
          value={
            m.perceived_protection.mean === null
              ? null
              : `${m.perceived_protection.mean} of 5 (${m.perceived_protection.responses} answers)`
          }
          note={d['perceived_protection'] ?? ''}
        />
      </div>
    </GlassCard>
  )
}
