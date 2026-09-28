'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Building2, ChevronRight, Megaphone, TrendingUp, UserPlus, Users, UserCheck } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchOperatorOverview, fetchOperatorFunnel, fetchOperatorOperations, fetchOperatorSecurity, type OperatorFunnel, type OperatorOperations, type OperatorOverview, type OperatorSecurity } from '@/lib/api'
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
}

function collectAttention(overview: OperatorOverview, ops: OperatorOperations | null, security: OperatorSecurity | null): AttentionItem[] {
  const items: AttentionItem[] = []
  if (overview.marketing.publish_failed > 0) items.push({ severity: 'danger', text: `${overview.marketing.publish_failed} marketing post${overview.marketing.publish_failed === 1 ? '' : 's'} failed to publish`, href: '/operator/marketing' })
  if (ops?.queue.available && ops.queue.dead > 0) items.push({ severity: 'danger', text: `${ops.queue.dead} dead-lettered job${ops.queue.dead === 1 ? '' : 's'}`, href: '/operator/operations' })
  if ((security?.locked_users.length ?? 0) > 0) items.push({ severity: 'warning', text: `${security!.locked_users.length} locked account${security!.locked_users.length === 1 ? '' : 's'}`, href: '/operator/users' })
  if ((ops?.connectors.expiring_tokens_7d ?? 0) > 0) items.push({ severity: 'warning', text: `${ops!.connectors.expiring_tokens_7d} connector token${ops!.connectors.expiring_tokens_7d === 1 ? '' : 's'} expiring within 7 days`, href: '/operator/operations' })
  if ((ops?.failed_reminders.length ?? 0) > 0) items.push({ severity: 'warning', text: `${ops!.failed_reminders.length} failed reminder deliver${ops!.failed_reminders.length === 1 ? 'y' : 'ies'}`, href: '/operator/operations' })
  const staleCrons = ops?.cron_locks.filter((l) => l.stale).length ?? 0
  if (staleCrons > 0) items.push({ severity: 'warning', text: `${staleCrons} stale cron lock${staleCrons === 1 ? '' : 's'} — a job may have died mid-run`, href: '/operator/operations' })
  if ((security?.logins_24h.failed ?? 0) > 0) items.push({ severity: 'info', text: `${security!.logins_24h.failed} failed login${security!.logins_24h.failed === 1 ? '' : 's'} in the last 24h`, href: '/operator/users' })
  if (overview.users.suspended > 0) items.push({ severity: 'info', text: `${overview.users.suspended} suspended user${overview.users.suspended === 1 ? '' : 's'}`, href: '/operator/users' })
  const newLeads = overview.leads?.['new'] ?? 0
  if (newLeads > 0) items.push({ severity: 'info', text: `${newLeads} new lead${newLeads === 1 ? '' : 's'} awaiting triage`, href: '/operator/leads' })
  return items
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchOperatorOverview().then(setOverview).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operator overview'))
    fetchOperatorFunnel().then(setFunnel).catch(() => setFunnel(null))
    fetchOperatorOperations().then(setOps).catch(() => setOps(null))
    fetchOperatorSecurity().then(setSecurity).catch(() => setSecurity(null))
  }, [])

  if (error) {
    return <GlassCard className="p-5"><h1 className="text-xl font-semibold">Operator access unavailable</h1><p className="mt-2 text-sm text-danger">{error}</p></GlassCard>
  }
  if (!overview) return <div className="shimmer h-40 rounded-2xl" />

  const activity = overview.activity_30d ?? []
  const attention = collectAttention(overview, ops, security)

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
              <Link key={item.text} href={item.href} className="flex items-center justify-between py-2 text-sm hover:bg-tint/[0.02] -mx-1 px-1 rounded">
                <span className={SEVERITY_STYLES[item.severity]}>{item.text}</span>
                <ChevronRight size={14} className="text-ink-tertiary" />
              </Link>
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
          {funnel.by_source.length > 0 && (
            <div className="mt-4 divide-y divide-tint/[0.06]">
              {funnel.by_source.map((row) => (
                <div key={row.source} className="flex justify-between py-2 text-sm">
                  <span className="text-ink-secondary">{row.source}</span>
                  <span className="text-ink-tertiary">{row.leads} leads · {row.signups} signups</span>
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
