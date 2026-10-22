'use client'

import { useEffect, useState } from 'react'
import { Bot, Cpu, ShieldAlert, Zap } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchOperatorAiHealth, type OperatorAiHealth } from '@/lib/api'

function ms(v: number | null): string {
  if (v === null) return '—'
  if (v < 1000) return `${Math.round(v)}ms`
  return `${(v / 1000).toFixed(1)}s`
}

function cost(micro: number): string {
  const dollars = micro / 1_000_000
  if (dollars === 0) return '—'
  if (dollars < 0.01) return `${(dollars * 100).toFixed(3)}¢`
  return `$${dollars.toFixed(4)}`
}

const ROUTES = ['verified', 'clarified', 'generated', 'fallback', 'quarantined', 'emergency']

const STATUS_TONE: Record<string, string> = {
  approved: 'text-ok',
  self_hosted: 'text-family-accent',
  unreviewed: 'text-warning',
}

const BREAKER_TONE: Record<string, string> = {
  closed: 'text-ok',
  'half-open': 'text-warning',
  open: 'text-danger',
}

export default function OperatorAiPage() {
  const [health, setHealth] = useState<OperatorAiHealth | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchOperatorAiHealth()
      .then(setHealth)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load AI health'))
  }, [])

  if (error)
    return (
      <GlassCard className="p-5">
        <h1 className="text-xl font-semibold">AI health unavailable</h1>
        <p className="mt-2 text-sm text-danger">{error}</p>
      </GlassCard>
    )
  if (!health) return <div className="shimmer h-40 rounded-2xl" />

  const mix = health.assistant_answer_mix
  const escapePct =
    mix.generation_escape_rate === null ? null : Math.round(mix.generation_escape_rate * 100)

  return (
    <div>
      <h1 className="text-2xl font-semibold">AI Health</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        The model path for every governed task — outcomes, latency, cost and processor status over
        the last {health.window_days} days. Metadata only: prompts and completions never appear
        here.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-secondary">
            <Zap size={15} /> Ask Keel routes
          </div>
          {escapePct !== null ? (
            <p className="mt-3 text-3xl font-semibold">
              {escapePct}
              <span className="text-base font-normal text-ink-tertiary">% reach generation</span>
            </p>
          ) : (
            <p className="mt-3 text-3xl font-semibold">—</p>
          )}
          <p className="mt-1 text-xs text-ink-tertiary">
            Generation-escape rate — the verified-answer tier answers the rest with zero model
            calls. {mix.total} asks in window.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ROUTES.filter((r) => (mix[r] ?? 0) > 0).map((r) => (
              <span
                key={r}
                className="rounded-full border border-tint/[0.08] px-2.5 py-0.5 text-xs text-ink-secondary"
              >
                {r}: {mix[r]}
              </span>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-secondary">
            <Cpu size={15} /> Processors
          </div>
          <div className="mt-3 space-y-2">
            {health.processors.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-ink-tertiary">
                    {p.hosting === 'self_hosted' ? 'LifeKeel infra' : 'hosted'}
                  </span>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-medium ${STATUS_TONE[p.status] ?? ''}`}>
                    {p.review_lapsed ? 'review lapsed' : p.status.replace('_', ' ')}
                  </span>
                  <span className="ml-2 text-xs text-ink-tertiary">due {p.review_due}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-tertiary">
            Hosted processors stay unreviewed until terms are supplied — processor changes are
            registry edits, not console toggles.
          </p>
        </GlassCard>
      </div>

      <GlassCard className="mt-4 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-secondary">
          <Bot size={15} /> Tasks
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-tint/[0.08] text-xs text-ink-tertiary">
                <th className="pb-2 pr-4 font-medium">Task</th>
                <th className="pb-2 pr-4 font-medium">Boundary</th>
                <th className="pb-2 pr-4 font-medium">Processor</th>
                <th className="pb-2 pr-4 font-medium">Breaker</th>
                <th className="pb-2 pr-4 font-medium text-right">Calls</th>
                <th className="pb-2 pr-4 font-medium text-right">Fail %</th>
                <th className="pb-2 pr-4 font-medium text-right">p50</th>
                <th className="pb-2 pr-4 font-medium text-right">p95</th>
                <th className="pb-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {health.tasks.map((t) => (
                <tr key={t.task_id} className="border-b border-tint/[0.04]">
                  <td className="py-2 pr-4 font-mono text-xs">{t.task_id}</td>
                  <td className="py-2 pr-4 text-xs text-ink-tertiary">{t.data_boundary}</td>
                  <td className="py-2 pr-4 text-xs">{t.serving_processor ?? 'device'}</td>
                  <td className={`py-2 pr-4 text-xs ${BREAKER_TONE[t.breaker_state] ?? ''}`}>
                    {t.breaker_state}
                  </td>
                  <td className="py-2 pr-4 text-right text-xs">{t.calls}</td>
                  <td
                    className={`py-2 pr-4 text-right text-xs ${t.failure_rate > 0.1 ? 'text-danger' : ''}`}
                  >
                    {(t.failure_rate * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 pr-4 text-right text-xs">{ms(t.p50_ms)}</td>
                  <td className="py-2 pr-4 text-right text-xs">{ms(t.p95_ms)}</td>
                  <td className="py-2 text-right text-xs">{cost(t.cost_microdollars)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {health.guard_events.length > 0 && (
        <GlassCard className="mt-4 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-ink-secondary">
            <ShieldAlert size={15} /> Guard events
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {health.guard_events.map((g) => (
              <span
                key={`${g.type}-${g.action}`}
                className="rounded-full border border-tint/[0.08] px-2.5 py-0.5 text-xs text-ink-secondary"
              >
                {g.type} · {g.action}: {g.count}
              </span>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
