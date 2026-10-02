'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, BellOff, Building2, Check, CheckCheck, ChevronRight, Megaphone, TrendingUp, UserPlus, Users, UserCheck } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchOperatorOverview, fetchOperatorFunnel, fetchOperatorOperations, fetchOperatorSecurity, fetchOperatorAlerts, setOperatorAlertState, fetchOperatorReferrals, type OperatorAlert, type OperatorFunnel, type OperatorOperations, type OperatorOverview, type OperatorReferrals, type OperatorSecurity } from '@/lib/api'
import { Sparkline, seriesFor, WowDelta } from './_components/Sparkline'

function Metric({ label, value, detail, delta, spark, icon: Icon }: {
  label: string
  value: number
  detail?: string
  delta?: React.ReactNode
  spark?: number[]
  icon: typeof Users
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-secondary">{label}</span>
        <Icon size={18} className="text-family-400" />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold">{value.toLocaleString()}</span>
        {delta}
      </div>
      {detail && <div className="mt-1 text-xs text-ink-tertiary">{detail}</div>}
      {spark && <div className="mt-2"><Sparkline points={spark} /></div>}
    </GlassCard>
  )
}

interface AttentionItem {
  severity: 'danger' | 'warning' | 'info'
  text: string
  href: string
  /** Stable identity for triage state — survives reloads and matches the
   *  runbooks.yaml keys on the operations page. */
  dedup_key: string
  /** The count driving this item — a resolved alert resurfaces when the
   *  number grows past what was resolved. */
  value: number
}

function collectAttention(overview: OperatorOverview, ops: OperatorOperations | null, security: OperatorSecurity | null): AttentionItem[] {
  const items: AttentionItem[] = []
  if (overview.marketing.publish_failed > 0) items.push({ severity: 'danger', text: `${overview.marketing.publish_failed} marketing post${overview.marketing.publish_failed === 1 ? '' : 's'} failed to publish`, href: '/operator/marketing', dedup_key: 'publish_failed', value: overview.marketing.publish_failed })
  if (ops?.queue.available && ops.queue.dead > 0) items.push({ severity: 'danger', text: `${ops.queue.dead} dead-lettered job${ops.queue.dead === 1 ? '' : 's'}`, href: '/operator/operations', dedup_key: 'dead_letters', value: ops.queue.dead })
  const locked = security?.locked_users.length ?? 0
  if (locked > 0) items.push({ severity: 'warning', text: `${locked} locked account${locked === 1 ? '' : 's'}`, href: '/operator/users', dedup_key: 'locked_accounts', value: locked })
  const expiring = ops?.connectors.expiring_tokens_7d ?? 0
  if (expiring > 0) items.push({ severity: 'warning', text: `${expiring} connector token${expiring === 1 ? '' : 's'} expiring within 7 days`, href: '/operator/operations', dedup_key: 'expiring_tokens', value: expiring })
  const failedReminders = ops?.failed_reminders.length ?? 0
  if (failedReminders > 0) items.push({ severity: 'warning', text: `${failedReminders} failed reminder deliver${failedReminders === 1 ? 'y' : 'ies'}`, href: '/operator/operations', dedup_key: 'failed_reminders', value: failedReminders })
  const staleCrons = ops?.cron_locks.filter((l) => l.stale).length ?? 0
  if (staleCrons > 0) items.push({ severity: 'warning', text: `${staleCrons} stale cron lock${staleCrons === 1 ? '' : 's'} — a job may have died mid-run`, href: '/operator/operations', dedup_key: 'stale_crons', value: staleCrons })
  const failedLogins = security?.logins_24h.failed ?? 0
  if (failedLogins > 0) items.push({ severity: 'info', text: `${failedLogins} failed login${failedLogins === 1 ? '' : 's'} in the last 24h`, href: '/operator/users', dedup_key: 'failed_logins', value: failedLogins })
  if (overview.users.suspended > 0) items.push({ severity: 'info', text: `${overview.users.suspended} suspended user${overview.users.suspended === 1 ? '' : 's'}`, href: '/operator/users', dedup_key: 'suspended_users', value: overview.users.suspended })
  const newLeads = overview.leads?.['new'] ?? 0
  if (newLeads > 0) items.push({ severity: 'info', text: `${newLeads} new lead${newLeads === 1 ? '' : 's'} awaiting triage`, href: '/operator/leads', dedup_key: 'new_leads', value: newLeads })
  const openCases = overview.support?.open ?? 0
  if (openCases > 0) items.push({ severity: 'warning', text: `${openCases} open support case${openCases === 1 ? '' : 's'} — Oak already triaged`, href: '/operator/support', dedup_key: 'open_support_cases', value: openCases })
  return items
}

/** Triage state joined onto a live attention item: resolved items hide
 *  until the underlying count grows past what was resolved (the signal
 *  genuinely worsened), snoozed hide until their 24h window lapses, and
 *  acked items stay visible but dimmed — "someone's on it". */
function applyAlertState(items: AttentionItem[], alerts: OperatorAlert[]): (AttentionItem & { acked: boolean })[] {
  const byKey = new Map(alerts.map((a) => [a.dedup_key, a]))
  return items.flatMap((item) => {
    const alert = byKey.get(item.dedup_key)
    if (alert?.status === 'resolved' && item.value <= (alert.resolved_signal_value ?? 0)) return []
    if (alert?.status === 'snoozed' && alert.snoozed_until && new Date(alert.snoozed_until) > new Date()) return []
    return [{ ...item, acked: alert?.status === 'ack' }]
  })
}

const SEVERITY_STYLES: Record<AttentionItem['severity'], string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-ink-tertiary',
}

export default function OperatorOverviewPage() {
  const [overview, setOverview] = useState<OperatorOverview | null>(null)
  const [funnel, setFunnel] = useState<OperatorFunnel | null>(null)
  const [ops, setOps] = useState<OperatorOperations | null>(null)
  const [security, setSecurity] = useState<OperatorSecurity | null>(null)
  const [alerts, setAlerts] = useState<OperatorAlert[]>([])
  const [referrals, setReferrals] = useState<OperatorReferrals | null>(null)
  const [busyAlert, setBusyAlert] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadAlerts = useCallback(() => {
    fetchOperatorAlerts().then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]))
  }, [])

  useEffect(() => {
    fetchOperatorOverview().then(setOverview).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operator overview'))
    fetchOperatorFunnel().then(setFunnel).catch(() => setFunnel(null))
    fetchOperatorOperations().then(setOps).catch(() => setOps(null))
    fetchOperatorSecurity().then(setSecurity).catch(() => setSecurity(null))
    fetchOperatorReferrals().then(setReferrals).catch(() => setReferrals(null))
    loadAlerts()
  }, [loadAlerts])

  async function triage(item: AttentionItem, action: 'ack' | 'snooze' | 'resolve') {
    setBusyAlert(item.dedup_key)
    try {
      await setOperatorAlertState(item.dedup_key, action, {
        title: item.text, severity: item.severity, href: item.href, signal_value: item.value,
      })
      loadAlerts()
    } finally {
      setBusyAlert(null)
    }
  }

  if (error) {
    return <GlassCard className="p-5"><h1 className="text-xl font-semibold">Operator access unavailable</h1><p className="mt-2 text-sm text-danger">{error}</p></GlassCard>
  }
  if (!overview) return <div className="shimmer h-40 rounded-2xl" />

  const activity = overview.activity_30d ?? []
  const attention = applyAlertState(collectAttention(overview, ops, security), alerts)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Command center</h1>
        <p className="mt-1 text-sm text-ink-tertiary">Platform health and growth signals across Agent Oak.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Users" value={overview.users.total} detail={`${overview.users.active} active`} icon={Users}
          spark={seriesFor(activity, 'signup_completed')}
        />
        <Metric
          label="Signups this week" value={overview.users.signups_week} detail={`${overview.users.signups_today} today`} icon={UserPlus}
          delta={<WowDelta current={overview.users.signups_week} previous={overview.users.signups_prev_week} />}
          spark={seriesFor(activity, 'signup_completed')}
        />
        <Metric
          label="Leads this week" value={overview.leads_7d ?? 0} detail={`${Object.values(overview.leads ?? {}).reduce((a, b) => a + b, 0)} total`} icon={UserCheck}
          delta={<WowDelta current={overview.leads_7d ?? 0} previous={overview.leads_prev_7d} />}
          spark={seriesFor(activity, 'lead_captured')}
        />
        <Metric label="Active tenants" value={overview.tenants.active} detail={`${overview.tenants.total} total`} icon={Building2} />
        <Metric
          label="Landing views · 30d" value={seriesFor(activity, 'landing_view').reduce((a, b) => a + b, 0)} icon={TrendingUp}
          spark={seriesFor(activity, 'landing_view')}
        />
        <Metric label="Marketing queue" value={overview.marketing.queued} detail={`${overview.marketing.publish_failed} failed`} icon={Megaphone} />
      </div>
      {attention.length > 0 && (
        <GlassCard className="mt-5 p-4 border-warning/25">
          <div className="flex items-center gap-2 text-warning"><AlertTriangle size={18} /><span className="font-semibold">Needs attention</span></div>
          <div className="mt-2 divide-y divide-tint/[0.06]">
            {attention.map((item) => (
              <div key={item.dedup_key} className={`flex items-center justify-between gap-2 py-2 -mx-1 px-1 rounded hover:bg-tint/[0.02] ${item.acked ? 'opacity-50' : ''}`}>
                <Link href={item.href} className="flex min-w-0 items-center gap-2 text-sm">
                  <span className={SEVERITY_STYLES[item.severity]}>{item.text}</span>
                  {item.acked && <span className="rounded-full border border-tint/[0.12] px-1.5 text-[10px] text-ink-tertiary">ack&apos;d</span>}
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  {item.acked ? (
                    <>
                      <button title="Snooze 24h" aria-label="Snooze 24h" disabled={busyAlert === item.dedup_key} onClick={() => void triage(item, 'snooze')} className="rounded p-1 text-ink-tertiary hover:text-ink-secondary disabled:opacity-40"><BellOff size={13} /></button>
                      <button title="Resolve" aria-label="Resolve" disabled={busyAlert === item.dedup_key} onClick={() => void triage(item, 'resolve')} className="rounded p-1 text-ink-tertiary hover:text-success disabled:opacity-40"><CheckCheck size={13} /></button>
                    </>
                  ) : (
                    <>
                      <button title="Acknowledge" aria-label="Acknowledge" disabled={busyAlert === item.dedup_key} onClick={() => void triage(item, 'ack')} className="rounded p-1 text-ink-tertiary hover:text-ink-secondary disabled:opacity-40"><Check size={13} /></button>
                      <button title="Snooze 24h" aria-label="Snooze 24h" disabled={busyAlert === item.dedup_key} onClick={() => void triage(item, 'snooze')} className="rounded p-1 text-ink-tertiary hover:text-ink-secondary disabled:opacity-40"><BellOff size={13} /></button>
                      <button title="Resolve" aria-label="Resolve" disabled={busyAlert === item.dedup_key} onClick={() => void triage(item, 'resolve')} className="rounded p-1 text-ink-tertiary hover:text-success disabled:opacity-40"><CheckCheck size={13} /></button>
                    </>
                  )}
                  <ChevronRight size={14} className="text-ink-tertiary" />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
      {funnel && (
        <GlassCard className="mt-5 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><TrendingUp size={16} className="text-family-400" /> Growth funnel · 30 days</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div><div className="text-xl font-semibold">{funnel.totals.leads_30d}</div><div className="text-xs text-ink-tertiary">leads captured</div></div>
            <div><div className="text-xl font-semibold">{funnel.totals.signups_30d}</div><div className="text-xs text-ink-tertiary">signups</div></div>
            <div><div className="text-xl font-semibold">{funnel.totals.activated_tenants}</div><div className="text-xs text-ink-tertiary">activated tenants</div></div>
            <div><div className="text-xl font-semibold">{funnel.totals.paying_tenants}</div><div className="text-xs text-ink-tertiary">paying tenants</div></div>
          </div>
          {funnel.activation && funnel.activation.steps.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Activation — where new signups stall</h3>
              <div className="mt-2 space-y-1.5">
                {funnel.activation.steps.map((step) => (
                  <div key={step.key} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 text-xs text-ink-secondary">{step.label}</span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-tint/[0.06]">
                      <div className="h-full rounded-full bg-family-500/60" style={{ width: `${step.pct}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs text-ink-tertiary">{step.count} · {step.pct}%</span>
                  </div>
                ))}
              </div>
              {funnel.activation.median_time_to_first_insight_hours !== null && (
                <p className="mt-2 text-xs text-ink-tertiary">
                  Median time to first insight: {funnel.activation.median_time_to_first_insight_hours}h
                </p>
              )}
            </div>
          )}
          {funnel.revenue && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Revenue</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-4">
                <div><div className="text-xl font-semibold">£{(funnel.revenue.mrr_pence / 100).toFixed(2)}</div><div className="text-xs text-ink-tertiary">MRR</div></div>
                <div><div className="text-xl font-semibold">{funnel.revenue.paying_30d}</div><div className="text-xs text-ink-tertiary">new payers · 30d</div></div>
                <div><div className="text-xl font-semibold">{funnel.revenue.trialing_tenants}</div><div className="text-xs text-ink-tertiary">in trial</div></div>
                <div>
                  <div className="text-xl font-semibold">{funnel.revenue.median_days_to_paid !== null ? `${funnel.revenue.median_days_to_paid}d` : '—'}</div>
                  <div className="text-xs text-ink-tertiary">median signup→paid</div>
                </div>
              </div>
            </div>
          )}
          {funnel.by_source.length > 0 && (
            <div className="mt-4 divide-y divide-tint/[0.06]">
              {funnel.by_source.map((row) => (
                <div key={row.source} className="flex justify-between py-2 text-sm">
                  <span className="text-ink-secondary">{row.source}</span>
                  <span className="text-ink-tertiary">
                    {row.leads} leads · {row.signups} signups
                    {row.trialing > 0 && ` · ${row.trialing} trialing`}
                    {row.paying > 0 && ` · ${row.paying} paying`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      )}
      {referrals && (referrals.totals.codes_issued > 0 || referrals.totals.referrals > 0) && (
        <GlassCard className="mt-5 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><TrendingUp size={16} className="text-family-400" /> Referrals</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <div><div className="text-xl font-semibold">{referrals.totals.codes_issued}</div><div className="text-xs text-ink-tertiary">codes issued</div></div>
            <div><div className="text-xl font-semibold">{referrals.totals.referrals}</div><div className="text-xs text-ink-tertiary">signups referred</div></div>
            <div><div className="text-xl font-semibold text-success">{referrals.totals.rewarded}</div><div className="text-xs text-ink-tertiary">converted (rewarded)</div></div>
            <div><div className="text-xl font-semibold">{referrals.totals.credits_granted}</div><div className="text-xs text-ink-tertiary">credits granted</div></div>
          </div>
          {referrals.leaderboard.filter((r) => r.referrals > 0).length > 0 && (
            <div className="mt-4 divide-y divide-tint/[0.06]">
              {referrals.leaderboard
                .filter((r) => r.referrals > 0)
                .slice(0, 10)
                .map((r) => (
                  <div key={r.tenant_id} className="flex justify-between py-2 text-sm">
                    <span className="text-ink-secondary">
                      {r.tenant_name} <span className="text-ink-tertiary">· {r.code}</span>
                    </span>
                    <span className="text-ink-tertiary">
                      {r.referrals} referred · <span className="text-success">{r.rewarded} converted</span>
                    </span>
                  </div>
                ))}
            </div>
          )}
        </GlassCard>
      )}
      {Object.keys(overview.signups_by_source_7d ?? {}).length > 0 && (
        <GlassCard className="mt-5 p-4">
          <h2 className="font-semibold">Signups by source · 7 days</h2>
          <div className="mt-3 divide-y divide-tint/[0.06]">
            {Object.entries(overview.signups_by_source_7d).map(([source, count]) => (
              <div key={source} className="flex justify-between py-2 text-sm"><span className="text-ink-secondary">{source}</span><span>{count}</span></div>
            ))}
          </div>
        </GlassCard>
      )}
      <GlassCard className="mt-5 p-4">
        <h2 className="font-semibold">Growth events · 7 days</h2>
        <div className="mt-3 divide-y divide-tint/[0.06]">
          {overview.growth_events_7d.length === 0 && <p className="text-sm text-ink-tertiary">No growth events recorded.</p>}
          {overview.growth_events_7d.map((event) => (
            <div key={event.event} className="flex justify-between py-2 text-sm"><span className="text-ink-secondary">{event.event.replaceAll('_', ' ')}</span><span>{event.count}</span></div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}
