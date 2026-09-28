'use client'

import { useEffect, useState } from 'react'
import { Activity, BellRing, BookOpen, Bot, Database, FileText, Inbox, Layers, Lock, MailCheck, Plug, Radio, Send, Server } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import {
  fetchOperatorOperations, fetchInfrastructure, recordCostSnapshot,
  retryReminder, requeueDeadJob, revokeConnector,
  fetchOperatorAutopilot, updateOperatorAutopilot, resolveAutopilotProposal,
  fetchOperatorDigest, sendOperatorDigest,
  type AutopilotAction, type AutopilotRule, type CostSnapshot, type OperatorDigest, type OperatorOperations,
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

/** Runbook note — the "is it safe to click retry?" answer, inline next to
 *  the signal it describes. Sourced from runbooks.yaml via the ops API. */
function RunbookNote({ note }: { note: { what: string; safe_to_requeue: string; escalate: string } }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-family-400 hover:underline">
        <BookOpen size={11} /> Runbook
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 rounded-lg bg-tint/[0.04] p-2.5 text-xs text-ink-tertiary">
          <p>{note.what}</p>
          <p><span className="font-medium text-ink-secondary">Safe to retry:</span> {note.safe_to_requeue}</p>
          <p><span className="font-medium text-ink-secondary">Escalate:</span> {note.escalate}</p>
        </div>
      )}
    </div>
  )
}

export default function OperationsPage() {
  const [ops, setOps] = useState<OperatorOperations | null>(null)
  const [infra, setInfra] = useState<{ services: CostSnapshot[]; total_monthly_usd: number; history: CostSnapshot[] } | null>(null)
  const [autopilot, setAutopilot] = useState<{ rules: AutopilotRule[]; recent_actions: AutopilotAction[]; never_autonomous: string[] } | null>(null)
  const [digest, setDigest] = useState<OperatorDigest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [costService, setCostService] = useState('')
  const [costUsd, setCostUsd] = useState('')
  const [costReason, setCostReason] = useState('')
  const [costBusy, setCostBusy] = useState(false)
  const [costError, setCostError] = useState<string | null>(null)
  const toast = useToast()

  const load = () => fetchOperatorOperations().then(setOps).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operations'))
  const loadInfra = () => fetchInfrastructure().then(setInfra).catch(() => setInfra(null))
  const loadAutopilot = () => fetchOperatorAutopilot().then(setAutopilot).catch(() => setAutopilot(null))
  const loadDigest = () => fetchOperatorDigest().then((d) => setDigest(d.digest)).catch(() => setDigest(null))
  useEffect(() => {
    fetchOperatorOperations().then(setOps).catch((err) => setError(err instanceof Error ? err.message : 'Could not load operations'))
    fetchInfrastructure().then(setInfra).catch(() => setInfra(null))
    loadAutopilot()
    loadDigest()
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
              {ops.queue.dead_jobs.length > 0 && ops.runbooks?.dead_letters && <RunbookNote note={ops.runbooks.dead_letters} />}
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
          {ops.failed_posts.length > 0 && ops.runbooks?.publish_failed && <RunbookNote note={ops.runbooks.publish_failed} />}
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
          {ops.failed_reminders.length > 0 && ops.runbooks?.failed_reminders && <RunbookNote note={ops.runbooks.failed_reminders} />}
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
          {ops.connectors.expiring_tokens_7d > 0 && ops.runbooks?.expiring_tokens && <RunbookNote note={ops.runbooks.expiring_tokens} />}
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

      {autopilot && (
        <GlassCard className="mt-5 p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Bot size={15} className="text-family-400" /> Autopilot</h2>
          <p className="mt-1 text-xs text-ink-tertiary">
            Tier 0/1 rules — reversible, bounded, ledgered. Every act is written to the action ledger before it runs
            and can only touch a given target once. All off by default; enable one at a time as trust builds.
          </p>
          <div className="mt-3 divide-y divide-tint/[0.06]">
            {autopilot.rules.map((r) => (
              <div key={r.rule} className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-sm font-medium text-ink-primary">{r.label}</span>
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.enabled ? 'bg-success/15 text-success' : 'bg-tint/[0.06] text-ink-tertiary'}`}>
                      {r.enabled ? 'enabled' : 'off'}
                    </span>
                  </div>
                  <ReasonAction
                    label={r.enabled ? 'Disable' : 'Enable'}
                    description={r.enabled
                      ? `Stop ${r.label}. In-flight ledger rows stand; the rule simply stops acting.`
                      : `Enable ${r.label}. Acts on at most ${r.max_blast_radius} targets per sweep, no more than once every ${r.cooldown_minutes}m.`}
                    onConfirm={async (reason) => {
                      await updateOperatorAutopilot(r.rule, { enabled: !r.enabled }, reason)
                      toast({ message: `${r.label} ${r.enabled ? 'disabled' : 'enabled'}`, variant: 'success' })
                      await loadAutopilot()
                    }}
                  />
                </div>
                <p className="mt-0.5 text-xs text-ink-tertiary">{r.description}</p>
                <p className="mt-0.5 text-[10px] text-ink-tertiary">
                  ≤{r.max_blast_radius}/sweep · cooldown {r.cooldown_minutes}m
                  {r.last_run_at && <> · last ran {new Date(r.last_run_at).toLocaleString()}</>}
                  {r.updated_by && <> · set by {r.updated_by}</>}
                </p>
              </div>
            ))}
          </div>
          {autopilot.recent_actions.some((a) => a.status === 'proposed' || a.status === 'approved') && (
            <div className="mt-4">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
                <Inbox size={12} /> Pending proposals
              </h3>
              <p className="mt-1 text-[10px] text-ink-tertiary">
                Tier-2 — autopilot spotted the situation; the action only happens if a human approves. Approving runs the same mutation as the manual endpoint.
              </p>
              <div className="mt-2 space-y-2">
                {autopilot.recent_actions.filter((a) => a.status === 'proposed' || a.status === 'approved').map((a) => (
                  <div key={a.id} className="rounded-lg border border-warning/20 bg-warning/[0.04] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-primary">{a.proposal?.summary ?? a.reason}</p>
                        <p className="mt-0.5 text-xs text-ink-tertiary">{a.reason} · requires <code>{a.proposal?.required_permission}</code></p>
                      </div>
                      {a.status === 'proposed' ? (
                        <div className="flex shrink-0 gap-1.5">
                          <ReasonAction
                            label="Approve"
                            description={`Execute: ${a.proposal?.summary ?? a.reason}`}
                            onConfirm={async (reason) => {
                              await resolveAutopilotProposal(a.id, 'approve', reason)
                              toast({ message: 'Proposal approved and executed', variant: 'success' })
                              await loadAutopilot()
                            }}
                          />
                          <ReasonAction
                            label="Reject"
                            destructive
                            description="Decline this proposal. The reason is recorded on the ledger row."
                            onConfirm={async (reason) => {
                              await resolveAutopilotProposal(a.id, 'reject', reason)
                              toast({ message: 'Proposal rejected', variant: 'success' })
                              await loadAutopilot()
                            }}
                          />
                        </div>
                      ) : (
                        <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold text-warning">executing…</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {autopilot.recent_actions.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Recent actions</h3>
              <div className="mt-2 divide-y divide-tint/[0.06]">
                {autopilot.recent_actions.filter((a) => a.status !== 'proposed' && a.status !== 'approved').slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <span className="min-w-0 truncate text-ink-secondary">
                      <span className="font-medium">{a.rule}</span> · {a.target_id} — {a.result ?? a.reason}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 ${
                      a.status === 'executed' ? 'bg-success/15 text-success'
                      : a.status === 'rejected' ? 'bg-tint/[0.08] text-ink-tertiary'
                      : 'bg-danger/15 text-danger'
                    }`}>
                      {a.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="mt-3 text-[10px] text-ink-tertiary">
            Never autonomous — enforced in code, not config: {autopilot.never_autonomous.slice(0, 6).join(', ')}, …
          </p>
        </GlassCard>
      )}

      <GlassCard className="mt-5 p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold"><MailCheck size={15} className="text-family-400" /> Weekly digest</h2>
          <ReasonAction
            label="Send now"
            description="Generate and post this week's operator digest to the ops Slack channel immediately (the cron also runs it Mondays 08:30)."
            onConfirm={async () => {
              const res = await sendOperatorDigest()
              setDigest(res.digest)
              toast({ message: 'Digest generated and posted to ops channel', variant: 'success' })
            }}
          />
        </div>
        {digest ? (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm md:grid-cols-3">
            <div className="flex justify-between"><span className="text-ink-tertiary">Signups (7d)</span><span className="font-medium">{digest.signups_7d} <span className="text-xs text-ink-tertiary">vs {digest.signups_prev_7d}</span></span></div>
            <div className="flex justify-between"><span className="text-ink-tertiary">Leads new / in &quot;new&quot;</span><span className="font-medium">{digest.leads_total_7d} / {digest.leads_new}</span></div>
            <div className="flex justify-between"><span className="text-ink-tertiary">Open alerts</span><span className="font-medium">{digest.open_alerts}</span></div>
            <div className="flex justify-between"><span className="text-ink-tertiary">Autopilot acts (7d)</span><span className="font-medium">{digest.autopilot_executed_7d}</span></div>
            <div className="flex justify-between"><span className="text-ink-tertiary">Pending proposals</span><span className="font-medium">{digest.autopilot_pending_proposals}</span></div>
            <div className="flex justify-between"><span className="text-ink-tertiary">Posts published (7d)</span><span className="font-medium">{digest.marketing_published_7d}</span></div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-tertiary">No digest yet — the Monday cron creates the first, or send one now.</p>
        )}
        {digest?.top_content && (
          <p className="mt-2 text-xs text-ink-tertiary">
            Top content this week: <span className="font-medium text-ink-secondary">{digest.top_content.slug}</span> → {digest.top_content.signups} signups
          </p>
        )}
        {digest && <p className="mt-2 text-[10px] text-ink-tertiary">Generated {new Date(digest.created_at).toLocaleString()} · posted to ops Slack when configured</p>}
      </GlassCard>

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
        {ops.cron_locks.some((l) => l.stale) && ops.runbooks?.stale_crons && <RunbookNote note={ops.runbooks.stale_crons} />}
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
