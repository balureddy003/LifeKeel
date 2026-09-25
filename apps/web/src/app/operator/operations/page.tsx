'use client'

import { useEffect, useState } from 'react'
import { Activity, BellRing, Database, FileText, Layers, Lock, Plug, Radio, Send, Server } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import {
  fetchOperatorOperations, fetchInfrastructure, recordCostSnapshot,
  retryReminder, requeueDeadJob, revokeConnector,
  type CostSnapshot, type OperatorOperations,
} from '@/lib/api'
import { useToast } from '@/components/Toast'
import { ReasonAction } from '../_components/ReasonAction'

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function StateRows({ states, empty }: { states: Record<string, number>; empty: string }) {
  const entries = Object.entries(states)
  if (entries.length === 0) return <p className="mt-2 text-sm text-ink-tertiary">{empty}</p>
  return <>{entries.map(([s, c]) => (
    <div key={s} className="mt-2 flex justify-between text-sm"><span className="text-ink-secondary">{s}</span><span>{c}</span></div>
  ))}</>
}

export default function OperationsPage() {
  const [ops, setOps] = useState<OperatorOperations | null>(null)
  const [infra, setInfra] = useState<{ services: CostSnapshot[]; total_monthly_usd: number; history: CostSnapshot[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [costService, setCostService] = useState('')
  const [costUsd, setCostUsd] = useState('')
  const [costReason, setCostReason] = useState('')
  const [costBusy, setCostBusy] = useState(false)
  const [costError, setCostError] = useState<string | null>(null)
  const toast = useToast()

  const load = () => fetchOperatorOperations().then(setOps).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operations'))
  const loadInfra = () => fetchInfrastructure().then(setInfra).catch(() => setInfra(null))
  useEffect(() => {
    fetchOperatorOperations().then(setOps).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operations'))
    fetchInfrastructure().then(setInfra).catch(() => setInfra(null))
  }, [])

  if (error) return <GlassCard className="p-5"><h1 className="text-xl font-semibold">Operations unavailable</h1><p className="mt-2 text-sm text-danger">{error}</p></GlassCard>
  if (!ops) return <div className="shimmer h-40 rounded-2xl" />

  const queueAvailable = ops.queue.available
  const connectorEntries = Object.entries(ops.connectors.by_connector)

  return (
    <div>
      <h1 className="text-2xl font-semibold">Operations</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Health of the process, datastore, queues, jobs, reminders, and connectors. Mutations are audited.</p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-ink-secondary">API uptime</span><Activity size={16} className="text-family-400" /></div><div className="mt-2 text-xl font-semibold">{formatUptime(ops.process.uptime_seconds)}</div><div className="mt-1 text-xs text-ink-tertiary">{(ops.process.rss_bytes / 1024 / 1024).toFixed(0)} MB RSS</div></GlassCard>
        <GlassCard className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-ink-secondary">MongoDB</span><Database size={16} className={ops.mongo.ok ? 'text-success' : 'text-danger'} /></div><div className="mt-2 text-xl font-semibold">{ops.mongo.ok ? `${ops.mongo.ping_ms} ms` : 'DOWN'}</div><div className="mt-1 text-xs text-ink-tertiary">ping latency</div></GlassCard>
        <GlassCard className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-ink-secondary">Growth events</span><Radio size={16} className="text-family-400" /></div><div className="mt-2 text-xl font-semibold">{ops.growth_events_24h}</div><div className="mt-1 text-xs text-ink-tertiary">last 24 hours</div></GlassCard>
        <GlassCard className="p-4"><div className="flex items-center justify-between"><span className="text-sm text-ink-secondary">Documents pending</span><FileText size={16} className="text-family-400" /></div><div className="mt-2 text-xl font-semibold">{ops.documents_pending}</div><div className="mt-1 text-xs text-ink-tertiary">extraction backlog</div></GlassCard>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <GlassCard className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Layers size={15} className="text-family-400" /> Webhook queue</h2>
          {queueAvailable ? (
            <>
              <div className="mt-2 flex justify-between text-sm"><span className="text-ink-secondary">Pending</span><span>{ops.queue.pending}</span></div>
              <div className="mt-1 flex justify-between text-sm"><span className="text-ink-secondary">Processing</span><span>{ops.queue.processing}</span></div>
              <div className="mt-1 flex justify-between text-sm"><span className="text-ink-secondary">Delayed</span><span>{ops.queue.delayed}</span></div>
              <div className="mt-1 flex justify-between text-sm"><span className={ops.queue.dead > 0 ? 'text-danger' : 'text-ink-secondary'}>Dead-lettered</span><span className={ops.queue.dead > 0 ? 'font-semibold text-danger' : ''}>{ops.queue.dead}</span></div>
              {ops.queue.dead_jobs.length > 0 && (
                <div className="mt-3 space-y-1">
                  {ops.queue.dead_jobs.map((j) => (
                    <div key={j.id} className="rounded-lg bg-danger/[0.06] px-3 py-1.5 text-xs text-ink-secondary">
                      <div className="flex items-center justify-between gap-2">
                        <span><code>{j.id}</code> · {j.attempts ?? 0} attempts · {new Date(j.enqueuedAt).toLocaleString()}</span>
                        <ReasonAction
                          label="Requeue"
                          onConfirm={async (reason) => {
                            await requeueDeadJob('webhook.ingest', j.id, reason)
                            toast({ message: 'Job re-queued', variant: 'success' })
                            await load()
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-tertiary">Redis unavailable — jobs run inline with no durable backlog.</p>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="font-semibold">Insights by state</h2>
          <StateRows states={ops.insights_by_state} empty="No insights." />
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="font-semibold">Marketing posts by state</h2>
          <StateRows states={ops.marketing_posts_by_state} empty="No posts." />
          {ops.failed_posts.length > 0 && (
            <div className="mt-3 space-y-1">
              {ops.failed_posts.map((p) => (
                <div key={p.id} className="rounded-lg bg-danger/[0.06] px-3 py-1.5 text-xs text-ink-secondary">
                  <span className="text-danger">{p.channel}</span> · {p.publish_error ?? 'publish failed'}
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <GlassCard className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><BellRing size={15} className="text-family-400" /> Policy reminders</h2>
          <StateRows states={ops.reminders_by_state} empty="No reminders." />
          {ops.stale_reminder_claims > 0 && (
            <p className="mt-2 rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning">
              {ops.stale_reminder_claims} stale &quot;sending&quot; claim{ops.stale_reminder_claims === 1 ? '' : 's'} — a worker likely crashed mid-dispatch; the next run recovers it.
            </p>
          )}
          {ops.failed_reminders.length > 0 && (
            <div className="mt-3 space-y-2">
              {ops.failed_reminders.map((r) => (
                <div key={r.id} className="rounded-lg bg-tint/[0.04] px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-secondary">{r.policy?.provider ?? 'Unknown'} · {r.policy?.type ?? 'policy'}</span>
                    <ReasonAction
                      label="Retry"
                      onConfirm={async (reason) => {
                        await retryReminder(r.id, reason)
                        toast({ message: 'Reminder re-queued for delivery', variant: 'success' })
                        await load()
                      }}
                    />
                  </div>
                  <div className="mt-1 text-ink-tertiary">
                    tenant <code>{r.tenant_id}</code> · {r.attempts} attempts · due {r.due_at ? new Date(r.due_at).toLocaleDateString() : '—'}
                  </div>
                  {r.last_error && <div className="mt-1 text-danger/80">{r.last_error}</div>}
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Send size={15} className="text-family-400" /> Delivery pipeline</h2>
          <StateRows states={ops.delivery_by_state} empty="No delivery activity." />
          {ops.failed_deliveries.length > 0 && (
            <div className="mt-3 space-y-1">
              {ops.failed_deliveries.map((d, i) => (
                <div key={i} className="rounded-lg bg-danger/[0.06] px-3 py-1.5 text-xs text-ink-secondary">
                  <span className="text-danger">{d.channel}</span> · tenant <code>{d.tenant_id}</code> · {d.error ?? 'failed'}
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Plug size={15} className="text-family-400" /> Connectors</h2>
          <StateRows states={ops.connectors.by_connector} empty="No connectors connected." />
          {ops.connectors.expiring_tokens_7d > 0 && (
            <p className="mt-2 rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning">
              {ops.connectors.expiring_tokens_7d} token{ops.connectors.expiring_tokens_7d === 1 ? '' : 's'} expiring within 7 days — expect reconnects.
            </p>
          )}
          {ops.connectors.list.length > 0 && (
            <div className="mt-3 space-y-1">
              {ops.connectors.list.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-tint/[0.04] px-3 py-1.5 text-xs">
                  <span className="text-ink-secondary">
                    {c.connector_id} · <code>{c.tenant_id}</code>
                    {c.token_expires_at && <> · expires {new Date(c.token_expires_at).toLocaleDateString()}</>}
                  </span>
                  <ReasonAction
                    label="Revoke"
                    destructive
                    onConfirm={async (reason) => {
                      await revokeConnector(c.connector_id, c.tenant_id, reason)
                      toast({ message: 'Credential revoked — tenant must re-authorize', variant: 'success' })
                      await load()
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-ink-tertiary">Credential values are never exposed — this shows metadata only.</p>
        </GlassCard>
      </div>

      <GlassCard className="mt-5 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Lock size={15} className="text-family-400" /> Cron leases</h2>
        {ops.cron_locks.length === 0 ? <p className="mt-2 text-sm text-ink-tertiary">No active leases — workers idle between ticks.</p> : (
          <div className="mt-2 space-y-1">
            {ops.cron_locks.map((lock, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg bg-tint/[0.04] px-3 py-2 text-xs">
                <span className="font-medium text-ink-secondary">{lock.name}</span>
                <span className="text-ink-tertiary">
                  owner <code>{lock.owner}</code>
                  {lock.expires_at && <> · expires {new Date(lock.expires_at).toLocaleTimeString()}</>}
                </span>
                <span className={`rounded-full px-2 py-0.5 ${lock.stale ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success'}`}>
                  {lock.stale ? 'stale — holder died' : 'live'}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="mt-5 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Server size={15} className="text-family-400" /> Infrastructure cost</h2>
        <p className="mt-1 text-xs text-ink-tertiary">Operator-recorded monthly estimates — not a live provider feed.</p>
        {infra && infra.services.length > 0 ? (
          <>
            <div className="mt-3 text-xl font-semibold">${infra.total_monthly_usd.toLocaleString()}<span className="text-sm font-normal text-ink-tertiary"> / month estimated</span></div>
            <div className="mt-2 divide-y divide-tint/[0.06]">
              {infra.services.map((s) => (
                <div key={s.service} className="flex justify-between py-2 text-sm">
                  <span className="text-ink-secondary">{s.service}{s.note ? <span className="text-ink-tertiary"> · {s.note}</span> : ''}</span>
                  <span>${s.monthly_usd}/mo · {new Date(s.recorded_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-tertiary">No snapshots recorded yet.</p>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <input value={costService} onChange={(e) => setCostService(e.target.value)} placeholder="Service (e.g. MongoDB Atlas)" className="glass-input rounded-lg px-3 py-2 text-xs sm:col-span-2" />
          <input value={costUsd} onChange={(e) => setCostUsd(e.target.value)} placeholder="$/month" inputMode="decimal" className="glass-input rounded-lg px-3 py-2 text-xs" />
          <input value={costReason} onChange={(e) => setCostReason(e.target.value)} placeholder="Reason (required, audited)" className="glass-input rounded-lg px-3 py-2 text-xs" />
        </div>
        {costError && <p className="mt-2 text-xs text-danger">{costError}</p>}
        <button
          disabled={costBusy || !costService.trim() || !Number(costUsd) || costReason.trim().length < 5}
          onClick={async () => {
            setCostBusy(true)
            setCostError(null)
            try {
              await recordCostSnapshot(costService.trim(), Number(costUsd), costReason.trim())
              toast({ message: 'Cost snapshot recorded', variant: 'success' })
              setCostService('')
              setCostUsd('')
              setCostReason('')
              await loadInfra()
            } catch (err) {
              setCostError(err instanceof Error ? err.message : 'Could not record snapshot')
            } finally {
              setCostBusy(false)
            }
          }}
          className="mt-2 rounded-lg bg-family-500/15 px-3 py-1.5 text-xs font-semibold text-family-400 disabled:opacity-40"
        >
          {costBusy ? 'Recording…' : 'Record snapshot'}
        </button>
      </GlassCard>
    </div>
  )
}
