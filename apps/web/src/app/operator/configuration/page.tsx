'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Settings2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchOperatorConfiguration,
  updateOperatorConfiguration,
  type LlmProviderId,
  type PlatformConfig,
} from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

type BooleanFlagKey = 'maintenance_mode' | 'signups_enabled' | 'marketing_paused'

const FLAGS: Array<{ key: BooleanFlagKey; label: string; description: string; whenOn: string }> = [
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
    description:
      'Approvals and auto-publish stop dispatching to channels; posts stay approved for retry.',
    whenOn: 'No posts are being dispatched',
  },
]

const PROVIDER_OPTIONS: Array<{ value: LlmProviderId | 'auto'; label: string; disabled?: string }> =
  [
    { value: 'auto', label: 'Auto — router decides (model name, then configured credentials)' },
    { value: 'azure', label: 'Azure OpenAI (approved)' },
    { value: 'vertex', label: 'Vertex AI Gemini (approved)' },
    { value: 'ollama', label: 'Ollama — self-hosted only' },
    {
      value: 'anthropic',
      label: 'Anthropic (unreviewed — processor gate will refuse)',
      disabled: 'Processor terms not reviewed',
    },
    {
      value: 'openai',
      label: 'OpenAI (unreviewed — processor gate will refuse)',
      disabled: 'Processor terms not reviewed',
    },
    { value: 'groq', label: 'Groq (approved — enable ZDR in Data Controls for zero retention)' },
  ]

export default function OperatorConfigurationPage() {
  const toast = useToast()
  const [data, setData] = useState<{
    config: PlatformConfig
    history: Array<{
      changes: Partial<PlatformConfig>
      changed_by?: string
      reason: string
      created_at: string
    }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [winStart, setWinStart] = useState('')
  const [winEnd, setWinEnd] = useState('')
  const [winMessage, setWinMessage] = useState('')
  const [provider, setProvider] = useState<LlmProviderId | 'auto'>('auto')

  const load = () =>
    fetchOperatorConfiguration()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load configuration'))
  useEffect(() => {
    fetchOperatorConfiguration()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load configuration'))
  }, [])
  useEffect(() => {
    if (data) setProvider(data.config.llm_provider_override ?? 'auto')
  }, [data])

  if (error)
    return (
      <GlassCard className="p-5">
        <h1 className="text-xl font-semibold">Configuration unavailable</h1>
        <p className="mt-2 text-sm text-danger">{error}</p>
      </GlassCard>
    )
  if (!data) return <div className="shimmer h-40 rounded-2xl" />

  return (
    <div>
      <h1 className="text-2xl font-semibold">Configuration</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        Global platform switches. Every change requires a reason and lands in the audit trail and
        config history.
      </p>

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
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${on ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}
                    >
                      {on ? 'on' : 'off'}
                    </span>
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
                    toast({
                      message: `${flag.label} ${next[flag.key] ? 'enabled' : 'disabled'}`,
                      variant: 'success',
                    })
                    await load()
                  }}
                />
              </div>
            </GlassCard>
          )
        })}
      </div>

      <GlassCard className="mt-5 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <Settings2 size={15} className="text-family-400" /> LLM provider
        </h2>
        <p className="mt-1 text-xs text-ink-tertiary">
          Runtime pick for every governed model call — applies within ~10s, no redeploy. The
          processor registry still gates it: a provider the task&apos;s{' '}
          <code>allowed_processors</code> doesn&apos;t approve is refused, not silently rerouted.
          Sensitive/local-only tasks stay local regardless.
        </p>
        <p className="mt-2 text-xs text-ink-secondary">
          Active override:{' '}
          <span className="font-medium text-ink-primary">
            {data.config.llm_provider_override ?? 'none — router auto-detection'}
          </span>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProviderId | 'auto')}
            className="glass-input rounded-xl px-3 py-2 text-sm"
          >
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} disabled={!!o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <ReasonAction
            label="Apply provider"
            onConfirm={async (reason) => {
              const next = await updateOperatorConfiguration(
                { llm_provider_override: provider },
                reason,
              )
              setData({ ...data, config: next })
              toast({
                message: `LLM provider → ${next.llm_provider_override ?? 'auto'}`,
                variant: 'success',
              })
              await load()
            }}
          />
        </div>
      </GlassCard>

      <GlassCard className="mt-5 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarClock size={15} className="text-family-400" /> Scheduled maintenance window
        </h2>
        <p className="mt-1 text-xs text-ink-tertiary">
          Announced to users via the app banner ahead of time — it does not engage maintenance mode;
          flip that separately when the window starts.
        </p>
        {data.config.maintenance_window && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs">
            <span className="text-warning">
              {new Date(data.config.maintenance_window.starts_at).toLocaleString()} →{' '}
              {new Date(data.config.maintenance_window.ends_at).toLocaleString()} ·{' '}
              {data.config.maintenance_window.message}
            </span>
            <ReasonAction
              label="Clear window"
              onConfirm={async (reason) => {
                const next = await updateOperatorConfiguration({ maintenance_window: null }, reason)
                setData({ ...data, config: next })
                toast({ message: 'Maintenance window cleared', variant: 'success' })
                await load()
              }}
            />
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink-tertiary">
            Starts
            <input
              type="datetime-local"
              value={winStart}
              onChange={(e) => setWinStart(e.target.value)}
              className="glass-input mt-1 w-full rounded-xl px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-ink-tertiary">
            Ends
            <input
              type="datetime-local"
              value={winEnd}
              onChange={(e) => setWinEnd(e.target.value)}
              className="glass-input mt-1 w-full rounded-xl px-3 py-2 text-sm"
            />
          </label>
        </div>
        <input
          value={winMessage}
          onChange={(e) => setWinMessage(e.target.value)}
          placeholder="Banner message, e.g. “Scheduled maintenance Sunday 02:00–03:00 UTC — expect brief read-only periods.”"
          className="glass-input mt-2 w-full rounded-xl px-3 py-2 text-sm"
        />
        <div className="mt-3">
          <ReasonAction
            label="Schedule window"
            onConfirm={async (reason) => {
              if (!winStart || !winEnd || !winMessage.trim())
                throw new Error('Start, end and message are required')
              const next = await updateOperatorConfiguration(
                {
                  maintenance_window: {
                    starts_at: new Date(winStart).toISOString(),
                    ends_at: new Date(winEnd).toISOString(),
                    message: winMessage.trim(),
                  },
                },
                reason,
              )
              setData({ ...data, config: next })
              setWinStart('')
              setWinEnd('')
              setWinMessage('')
              toast({ message: 'Maintenance window scheduled', variant: 'success' })
              await load()
            }}
          />
        </div>
      </GlassCard>

      <GlassCard className="mt-5 p-4">
        <h2 className="font-semibold">Change history</h2>
        {data.history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-tertiary">No changes recorded.</p>
        ) : (
          <div className="mt-3 divide-y divide-tint/[0.06]">
            {data.history.map((h, i) => (
              <div key={i} className="py-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-ink-secondary">
                    {Object.entries(h.changes)
                      .map(([k, v]) => `${k} → ${v}`)
                      .join(', ')}
                  </span>
                  <span className="text-ink-tertiary">
                    {new Date(h.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-0.5 text-ink-tertiary">
                  {h.changed_by ?? 'operator'} — {h.reason}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  )
}
