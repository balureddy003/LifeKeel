'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Compass,
  OctagonAlert,
  RefreshCw,
} from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { batchMissionControl, fetchMissionControl, type MissionDecision } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

const KIND_LABEL: Record<MissionDecision['kind'], string> = {
  proposal: 'Autopilot proposal',
  alert: 'Alert',
  support_case: 'Support',
  post_draft: 'Post draft',
  post_failed: 'Post failed',
  campaign_draft: 'Campaign draft',
  dual_approval: 'Second approval',
  plan_week: 'Week to approve',
  plan_missing: 'Plan missing',
  channel_attention: 'Connection',
  profile_drift: 'Profile',
}

const SEVERITY_STYLE: Record<MissionDecision['severity'], string> = {
  danger: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-tint/[0.08] text-ink-secondary',
}

function DecisionCard({
  d,
  selected,
  onToggle,
}: {
  d: MissionDecision
  selected: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <GlassCard className="p-4">
      <div className="flex items-start gap-3">
        {d.batchable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${d.title}`}
            className="mt-1 h-4 w-4 shrink-0"
          />
        ) : (
          <span className="mt-1 h-4 w-4 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLE[d.severity]}`}
            >
              {d.severity}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-ink-tertiary">
              {KIND_LABEL[d.kind]}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-ink-primary">{d.title}</p>
          <p className="mt-0.5 text-xs text-ink-secondary">{d.why}</p>
          {open && (
            <dl className="mt-2 space-y-1 text-xs">
              <div>
                <dt className="inline font-semibold text-ink-tertiary">If you act: </dt>
                <dd className="inline text-ink-secondary">{d.effect}</dd>
              </div>
              <div>
                <dt className="inline font-semibold text-ink-tertiary">Undo: </dt>
                <dd className="inline text-ink-secondary">{d.undo}</dd>
              </div>
              <div className="text-ink-tertiary">
                Needs <code>{d.required_permission}</code>
                {!d.batchable && ' · opens its own page so you decide each one'}
              </div>
            </dl>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Link
            href={d.href}
            className="inline-flex items-center gap-1 rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary"
          >
            Open <ArrowUpRight size={12} />
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="text-[11px] text-ink-tertiary underline-offset-2 hover:underline"
          >
            {open ? 'Hide details' : 'Effect & undo'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}

export default function MissionControlPage() {
  const toast = useToast()
  const [decisions, setDecisions] = useState<MissionDecision[] | null>(null)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchMissionControl()
      setDecisions(data.decisions)
      setPaused(data.autopilot_paused)
      setError(null)
      // Drop selections for items that no longer exist.
      setSelected(
        (prev) => new Set([...prev].filter((id) => data.decisions.some((d) => d.id === id))),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Mission Control')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const chosen = useMemo(
    () => (decisions ?? []).filter((d) => selected.has(d.id)),
    [decisions, selected],
  )
  const proposals = chosen.filter((d) => d.kind === 'proposal')
  const alerts = chosen.filter((d) => d.kind === 'alert')
  const batchable = (decisions ?? []).filter((d) => d.batchable)

  async function runBatch(
    items: { id: string; action: 'approve' | 'reject' | 'ack' }[],
    reason: string,
  ) {
    const { results } = await batchMissionControl(items, reason)
    const failed = results.filter((r) => !r.ok)
    toast({
      message:
        failed.length === 0
          ? `${results.length} done`
          : `${results.length - failed.length} done, ${failed.length} failed: ${failed[0]?.error ?? 'see audit'}`,
      variant: failed.length === 0 ? 'success' : 'error',
    })
    setSelected(new Set())
    await load()
  }

  if (error)
    return (
      <GlassCard className="p-5">
        <h1 className="text-xl font-semibold">Mission Control unavailable</h1>
        <p className="mt-2 text-sm text-danger">{error}</p>
      </GlassCard>
    )
  if (!decisions) return <div className="shimmer h-40 rounded-2xl" />

  const counts = {
    danger: decisions.filter((d) => d.severity === 'danger').length,
    warning: decisions.filter((d) => d.severity === 'warning').length,
    info: decisions.filter((d) => d.severity === 'info').length,
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Compass size={22} className="text-family-400" /> Mission Control
          </h1>
          <p className="mt-1 text-sm text-ink-tertiary">
            Everything waiting on a decision from you, most urgent first. Keel prepares; you decide.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs text-ink-secondary disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {paused && (
        <GlassCard className="mt-4 border border-warning/30 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <OctagonAlert size={16} /> Autopilot kill switch is on
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            No rule is checking or acting. Turn it off in{' '}
            <Link href="/operator/configuration" className="underline">
              Configuration
            </Link>{' '}
            when you are ready.
          </p>
        </GlassCard>
      )}

      {decisions.length === 0 ? (
        <GlassCard className="mt-5 p-8 text-center">
          <CheckCircle2 size={28} className="mx-auto text-success" />
          <p className="mt-2 font-medium">Nothing is waiting on you.</p>
          <p className="mt-1 text-xs text-ink-tertiary">
            New proposals, alerts and drafts will appear here.
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-ink-secondary">
            <span className="inline-flex items-center gap-1">
              <AlertTriangle size={12} className="text-danger" /> {counts.danger} urgent
            </span>
            <span>{counts.warning} need review</span>
            <span>{counts.info} for later</span>
            {batchable.length > 0 && (
              <button
                onClick={() =>
                  setSelected(
                    selected.size === batchable.length
                      ? new Set()
                      : new Set(batchable.map((d) => d.id)),
                  )
                }
                className="ml-auto underline-offset-2 hover:underline"
              >
                {selected.size === batchable.length
                  ? 'Clear selection'
                  : `Select all batchable (${batchable.length})`}
              </button>
            )}
          </div>

          <div className="mt-3 space-y-3">
            {decisions.map((d) => (
              <DecisionCard
                key={d.id}
                d={d}
                selected={selected.has(d.id)}
                onToggle={() => {
                  const next = new Set(selected)
                  if (next.has(d.id)) next.delete(d.id)
                  else next.add(d.id)
                  setSelected(next)
                }}
              />
            ))}
          </div>
          <p className="mt-4 text-xs text-ink-tertiary">
            Posts, campaigns and second approvals are never batched — each opens its own page so a
            public or irreversible step is always a deliberate click.
          </p>
        </>
      )}

      {chosen.length > 0 && (
        <div className="sticky bottom-4 mt-5 rounded-2xl border border-tint/[0.12] bg-surface/90 p-3 shadow-lg backdrop-blur">
          <p className="text-xs font-medium text-ink-primary">
            {chosen.length} selected
            <span className="ml-2 font-normal text-ink-tertiary">
              {proposals.length} proposal{proposals.length === 1 ? '' : 's'} · {alerts.length} alert
              {alerts.length === 1 ? '' : 's'}
            </span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {proposals.length > 0 && (
              <>
                <ReasonAction
                  label={`Approve ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}`}
                  description="Each runs the prepared action once, exactly as if approved one by one. You need the permission each proposal names."
                  onConfirm={(reason) =>
                    runBatch(
                      proposals.map((d) => ({ id: d.id, action: 'approve' as const })),
                      reason,
                    )
                  }
                />
                <ReasonAction
                  label={`Reject ${proposals.length}`}
                  destructive
                  description="Rejected proposals will not be raised again for the same target."
                  onConfirm={(reason) =>
                    runBatch(
                      proposals.map((d) => ({ id: d.id, action: 'reject' as const })),
                      reason,
                    )
                  }
                />
              </>
            )}
            {alerts.length > 0 && (
              <ReasonAction
                label={`Acknowledge ${alerts.length} alert${alerts.length === 1 ? '' : 's'}`}
                description="Marks them seen. They resurface if the underlying signal grows."
                onConfirm={(reason) =>
                  runBatch(
                    alerts.map((d) => ({ id: d.id, action: 'ack' as const })),
                    reason,
                  )
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
