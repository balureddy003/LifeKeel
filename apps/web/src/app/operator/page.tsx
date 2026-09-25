'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Building2, Megaphone, TrendingUp, UserPlus, Users, UserCheck } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchOperatorOverview, fetchOperatorFunnel, type OperatorFunnel, type OperatorOverview } from '@/lib/api'

function Metric({ label, value, detail, icon: Icon }: { label: string; value: number; detail?: string; icon: typeof Users }) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-secondary">{label}</span>
        <Icon size={18} className="text-family-400" />
      </div>
      <div className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</div>
      {detail && <div className="mt-1 text-xs text-ink-tertiary">{detail}</div>}
    </GlassCard>
  )
}

export default function OperatorOverviewPage() {
  const [overview, setOverview] = useState<OperatorOverview | null>(null)
  const [funnel, setFunnel] = useState<OperatorFunnel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchOperatorOverview().then(setOverview).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operator overview'))
    fetchOperatorFunnel().then(setFunnel).catch(() => setFunnel(null))
  }, [])

  if (error) {
    return <GlassCard className="p-5"><h1 className="text-xl font-semibold">Operator access unavailable</h1><p className="mt-2 text-sm text-danger">{error}</p></GlassCard>
  }
  if (!overview) return <div className="shimmer h-40 rounded-2xl" />

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Command center</h1>
        <p className="mt-1 text-sm text-ink-tertiary">Platform health and growth signals across Agent Oak.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Users" value={overview.users.total} detail={`${overview.users.active} active`} icon={Users} />
        <Metric label="Signups this week" value={overview.users.signups_week} detail={`${overview.users.signups_today} today`} icon={UserPlus} />
        <Metric label="Active tenants" value={overview.tenants.active} detail={`${overview.tenants.total} total`} icon={Building2} />
        <Metric label="Marketing queue" value={overview.marketing.queued} detail={`${overview.marketing.publish_failed} failed`} icon={Megaphone} />
        <Metric label="Leads" value={Object.values(overview.leads ?? {}).reduce((a, b) => a + b, 0)} detail={`${overview.leads?.['new'] ?? 0} new`} icon={UserCheck} />
      </div>
      {(overview.users.suspended > 0 || overview.marketing.publish_failed > 0) && (
        <GlassCard className="mt-5 p-4 border-warning/25">
          <div className="flex items-center gap-2 text-warning"><AlertTriangle size={18} /><span className="font-semibold">Attention required</span></div>
          <p className="mt-2 text-sm text-ink-secondary">{overview.users.suspended} suspended users and {overview.marketing.publish_failed} failed publications.</p>
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
