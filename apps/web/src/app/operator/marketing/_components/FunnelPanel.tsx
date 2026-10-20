'use client'

/**
 * The funnel from visit to first insight (PRD-210, phase 4), read from the daily rollups.
 * Visits and clicks are counted on the day they happen; signups, profiles and first insights are
 * signup cohorts, measured as they mature. Sources are networks; pillars are the plan's pillars.
 */

import { GlassCard } from '@/components/Glass'
import type { FunnelBreakdown, FunnelView } from '@/lib/api'

const STEP_LABEL: Record<string, string> = {
  visit: 'Visits',
  cta_click: 'Clicks on a signup button',
  signup: 'Accounts created',
  profile: 'Profile filled in',
  first_insight: 'First insight',
}

const pct = (n: number, of: number) => (of === 0 ? '' : ` (${Math.round((n / of) * 100)}%)`)

function Table({ title, rows, label }: { title: string; rows: FunnelBreakdown[]; label: (k: string) => string }) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="text-left text-xs font-semibold text-ink-secondary mb-1">{title}</caption>
        <thead>
          <tr className="text-ink-tertiary text-left">
            <th scope="col" className="font-normal pr-2 py-1">{title.replace('By ', '')}</th>
            <th scope="col" className="font-normal px-2 py-1 text-right">Visits</th>
            <th scope="col" className="font-normal px-2 py-1 text-right">Accounts</th>
            <th scope="col" className="font-normal px-2 py-1 text-right">Profiles</th>
            <th scope="col" className="font-normal pl-2 py-1 text-right">Insights</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-tint/[0.06]">
              <th scope="row" className="font-medium text-ink-primary pr-2 py-1 text-left">{label(r.key)}</th>
              <td className="px-2 py-1 text-right">{r.visit}</td>
              <td className="px-2 py-1 text-right">{r.signup}</td>
              <td className="px-2 py-1 text-right">{r.profile}</td>
              <td className="pl-2 py-1 text-right">{r.first_insight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function FunnelPanel({ funnel }: { funnel: FunnelView }) {
  const top = funnel.steps[0]?.count ?? 0
  const signups = funnel.steps.find((s) => s.step === 'signup')?.count ?? 0
  const pillar = (k: string) => (k.startsWith('pillar_') ? k.replace('pillar_', '').replace(/_/g, ' ') : k === 'none' ? 'no campaign' : k)
  return (
    <GlassCard className="p-4 mb-4">
      <h3 className="text-base font-semibold text-ink-primary mb-1">Funnel, last {funnel.window_days} days</h3>
      <ol className="mb-3 space-y-0.5">
        {funnel.steps.map((s) => (
          <li key={s.step} className="flex justify-between text-sm">
            <span className="text-ink-secondary">{STEP_LABEL[s.step] ?? s.step}</span>
            <span className="font-semibold text-ink-primary">
              {s.count}
              <span className="font-normal text-ink-tertiary">
                {s.step === 'profile' || s.step === 'first_insight' ? pct(s.count, signups) : s.step === 'signup' ? pct(s.count, top) : ''}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <div className="space-y-3">
        <Table title="By source" rows={funnel.by_source} label={(k) => k} />
        <Table title="By pillar" rows={funnel.by_campaign} label={pillar} />
      </div>
      <p className="text-xs text-ink-tertiary mt-2">
        Visits and clicks are counted on the day they happen. Accounts, profiles and insights are signup cohorts, measured as they mature, so
        recent days fill in over time.
      </p>
    </GlassCard>
  )
}
