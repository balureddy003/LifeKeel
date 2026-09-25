'use client'

import { useEffect, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { fetchOperatorConfiguration, updateOperatorConfiguration, type PlatformConfig } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

const FLAGS: Array<{ key: keyof PlatformConfig; label: string; description: string; whenOn: string }> = [
  {
    key: 'maintenance_mode',
    label: 'Maintenance mode',
    description: 'Rejects all non-operator API requests with 503. Operator routes stay reachable.',
    whenOn: 'All tenant traffic is blocked right now',
  },
  {
    key: 'signups_enabled',
    label: 'Signups',
    description: 'When off, POST /auth/signup returns 503 — existing users unaffected.',
    whenOn: 'New accounts cannot be created',
  },
  {
    key: 'marketing_paused',
    label: 'Marketing publishing paused',
    description: 'Approvals and auto-publish stop dispatching to channels; posts stay approved for retry.',
    whenOn: 'No posts are being dispatched',
  },
]

export default function OperatorConfigurationPage() {
  const toast = useToast()
  const [data, setData] = useState<{ config: PlatformConfig; history: Array<{ changes: Partial<PlatformConfig>; changed_by?: string; reason: string; created_at: string }> } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => fetchOperatorConfiguration().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Could not load configuration'))
  useEffect(() => {
    fetchOperatorConfiguration().then(setData).catch((err) => setError(err instanceof Error ? err.message : 'Could not load configuration'))
  }, [])

  if (error) return <GlassCard className="p-5"><h1 className="text-xl font-semibold">Configuration unavailable</h1><p className="mt-2 text-sm text-danger">{error}</p></GlassCard>
  if (!data) return <div className="shimmer h-40 rounded-2xl" />

  return (
    <div>
      <h1 className="text-2xl font-semibold">Configuration</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Global platform switches. Every change requires a reason and lands in the audit trail and config history.</p>

      <div className="mt-5 space-y-3">
        {FLAGS.map((flag) => {
          const on = data.config[flag.key]
          return (
            <GlassCard key={flag.key} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    <Settings2 size={15} className="text-family-400" />
                    {flag.label}
                    <span className={`rounded-full px-2 py-0.5 text-xs ${on ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>{on ? 'on' : 'off'}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-tertiary">{flag.description}</p>
                  {on && <p className="mt-1 text-xs text-warning">{flag.whenOn}.</p>}
                </div>
                <ReasonAction
                  label={on ? 'Turn off' : 'Turn on'}
                  destructive={!on && flag.key !== 'signups_enabled'}
                  onConfirm={async (reason) => {
                    const next = await updateOperatorConfiguration({ [flag.key]: !on }, reason)
                    setData({ ...data, config: next })
                    toast({ message: `${flag.label} ${next[flag.key] ? 'enabled' : 'disabled'}`, variant: 'success' })
                    await load()
                  }}
                />
              </div>
            </GlassCard>
          )
        })}
      </div>

      <GlassCard className="mt-5 p-4">
        <h2 className="font-semibold">Change history</h2>
        {data.history.length === 0 ? <p className="mt-2 text-sm text-ink-tertiary">No changes recorded.</p> : (
          <div className="mt-3 divide-y divide-tint/[0.06]">
            {data.history.map((h, i) => (
              <div key={i} className="py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-secondary">{Object.entries(h.changes).map(([k, v]) => `${k} → ${v}`).join(', ')}</span>
                  <span className="text-ink-tertiary">{new Date(h.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-0.5 text-ink-tertiary">{h.changed_by ?? 'operator'} — {h.reason}</div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  )
}
