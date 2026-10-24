'use client'

/**
 * Standing approvals: you approve a bank of exact post texts once and set the limits; the engine then
 * schedules and publishes from the bank on its own until the approval ends or a breaker trips.
 * Approving here never publishes anything by itself, and "Stop posting" rejects every unsent post.
 */

import { useCallback, useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  approveBankEntries,
  disableStanding,
  editBankEntry,
  fetchBank,
  fetchStanding,
  resumeStandingChannel,
  retireBankEntry,
  runStandingNow,
  saveStandingPolicy,
  type BankEntry,
  type StandingStatus,
} from '@/lib/api'

const NETWORKS = [
  ['bluesky', 'Bluesky'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
  ['threads', 'Threads'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
] as const

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const btn =
  'rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:text-ink-primary disabled:opacity-40'

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'bad' | 'ok' }) {
  const cls =
    tone === 'bad'
      ? 'bg-danger/15 text-danger'
      : tone === 'ok'
        ? 'bg-success/15 text-success'
        : 'bg-tint/[0.08] text-ink-tertiary'
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${cls}`}>{children}</span>
}

function CandidateRow({
  e,
  busy,
  onApprove,
  onRetire,
  onSave,
}: {
  e: BankEntry
  busy: boolean
  onApprove: (e: BankEntry) => void
  onRetire: (e: BankEntry) => void
  onSave: (e: BankEntry, text: string) => void
}) {
  const [text, setText] = useState(e.content)
  const changed = text !== e.content
  const blocked = !e.copy_check.ok || e.missing_image_for.length > 0 || changed
  return (
    <li className="rounded-xl border border-tint/[0.06] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {e.channels.map((c) => (
          <Chip key={c}>{c}</Chip>
        ))}
        {e.format && <Chip>{e.format.replace(/_/g, ' ')}</Chip>}
        {e.hook && <Chip>{e.hook.replace(/_/g, ' ')}</Chip>}
        {e.card && <Chip>card</Chip>}
        {!e.copy_check.ok && <Chip tone="bad">fails the copy guard</Chip>}
        {e.missing_image_for.length > 0 && <Chip tone="bad">needs an image</Chip>}
      </div>
      <textarea
        aria-label="Post text"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
        rows={4}
        className="w-full rounded-lg border border-tint/[0.1] bg-transparent p-2 text-sm"
      />
      {e.link_path && (
        <p className="mt-1 text-xs text-ink-tertiary">
          {'{{link}}'} becomes a tracked link to <code>{e.link_path}</code>, tagged per post.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {changed ? (
          <button className={btn} disabled={busy} onClick={() => onSave(e, text)}>
            Save edit
          </button>
        ) : null}
        <button className={btn} disabled={busy || blocked} onClick={() => onApprove(e)}>
          Approve this text
        </button>
        <button className={btn} disabled={busy} onClick={() => onRetire(e)}>
          Discard
        </button>
      </div>
    </li>
  )
}

export function AutonomyPanel() {
  const toast = useToast()
  const [status, setStatus] = useState<StandingStatus | null>(null)
  const [candidates, setCandidates] = useState<BankEntry[]>([])
  const [approved, setApproved] = useState<BankEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [reason, setReason] = useState('')
  const [days, setDays] = useState(30)
  const [perWeek, setPerWeek] = useState(3)
  const [picked, setPicked] = useState<string[]>(['bluesky'])

  const load = useCallback(async () => {
    try {
      const [s, c, a] = await Promise.all([
        fetchStanding(),
        fetchBank('candidate'),
        fetchBank('approved'),
      ])
      setStatus(s)
      setCandidates(c)
      setApproved(a)
      if (s.policy) {
        setPicked(s.policy.channels)
        setPerWeek(s.policy.max_per_channel_per_week)
      }
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : 'Could not load standing approvals',
        variant: 'error',
      })
    } finally {
      setLoaded(true)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await fn()
      toast({ message: done, variant: 'success' })
      await load()
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'That did not work', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function approve(items: BankEntry[]) {
    setBusy(true)
    try {
      const res = await approveBankEntries(
        items.map((e) => ({ id: e.id, content_hash: e.content_hash })),
      )
      const why = res.results.find((r) => !r.ok)?.error
      toast({
        message:
          res.refused > 0
            ? `${res.approved} approved, ${res.refused} refused${why ? `: ${why}` : ''}`
            : `${res.approved} approved`,
        variant: res.refused > 0 ? 'error' : 'success',
      })
      await load()
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Could not approve', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <GlassCard className="p-4 text-sm text-ink-tertiary">Loading…</GlassCard>

  const policy = status?.policy ?? null
  const active = status?.active === true
  const passing = candidates.filter((c) => c.copy_check.ok && c.missing_image_for.length === 0)

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Standing approval</h3>
            <p className="text-sm text-ink-secondary">
              {active && policy
                ? `Active until ${when(policy.expires_at)} on ${policy.channels.join(', ')}. The engine schedules and publishes from your approved bank within your limits.`
                : 'Not active. Nothing is scheduled automatically; every post still needs your approval one by one.'}
            </p>
          </div>
          {active && (
            <div className="flex gap-2">
              <button
                className={btn}
                disabled={busy}
                onClick={() => run(() => runStandingNow(), 'Scheduler run')}
              >
                Run now
              </button>
              <button
                className="rounded-lg border border-danger/40 px-3 py-1.5 text-xs font-semibold text-danger disabled:opacity-40"
                disabled={busy}
                onClick={() =>
                  run(
                    () => disableStanding(reason.trim() || 'Stopped by operator'),
                    'Stopped. Unsent posts were rejected.',
                  )
                }
              >
                Stop posting
              </button>
            </div>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-tertiary">Approved texts</dt>
            <dd className="font-semibold">{status?.bank.approved ?? 0}</dd>
          </div>
          <div>
            <dt className="text-ink-tertiary">Waiting for you</dt>
            <dd className="font-semibold">{status?.bank.candidate ?? 0}</dd>
          </div>
          <div>
            <dt className="text-ink-tertiary">Weeks before a repeat</dt>
            <dd className="font-semibold">{status?.weeks_of_posts_left ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-ink-tertiary">Scheduled</dt>
            <dd className="font-semibold">{status?.upcoming.length ?? 0}</dd>
          </div>
        </dl>
        {policy?.paused_channels.map((p) => (
          <div
            key={p.channel}
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger/10 p-2 text-sm"
          >
            <span>
              <strong>{p.channel}</strong> is paused: {p.reason}.
            </span>
            <button
              className={btn}
              disabled={busy}
              onClick={() => run(() => resumeStandingChannel(p.channel), `${p.channel} resumed`)}
            >
              Resume {p.channel}
            </button>
          </div>
        ))}
      </GlassCard>

      <GlassCard className="p-4">
        <h3 className="font-semibold">
          {active ? 'Renew or change the limits' : 'Turn on standing approval'}
        </h3>
        <p className="mb-3 text-sm text-ink-secondary">
          You are approving the limits below. Each text still has to be approved in the bank. This
          ends on its own after the days you choose, and you can stop it at any time.
        </p>
        <fieldset className="mb-3 flex flex-wrap gap-3">
          <legend className="mb-1 text-xs text-ink-tertiary">Networks</legend>
          {NETWORKS.map(([id, label]) => (
            <label key={id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(id)}
                onChange={(ev) =>
                  setPicked((p) => (ev.target.checked ? [...p, id] : p.filter((x) => x !== id)))
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            Ends after
            <select
              value={days}
              onChange={(ev) => setDays(Number(ev.target.value))}
              className="rounded border border-tint/[0.1] bg-transparent px-2 py-1"
            >
              {[7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Posts per network per week
            <select
              value={perWeek}
              onChange={(ev) => setPerWeek(Number(ev.target.value))}
              className="rounded border border-tint/[0.1] bg-transparent px-2 py-1"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input
          aria-label="Reason"
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          placeholder="Why you are turning this on (recorded)"
          className="mb-3 w-full rounded-lg border border-tint/[0.1] bg-transparent p-2 text-sm"
        />
        <button
          className={btn}
          disabled={busy || picked.length === 0 || reason.trim().length < 3}
          onClick={() =>
            run(
              () =>
                saveStandingPolicy({
                  reason: reason.trim(),
                  expires_in_days: days,
                  channels: picked,
                  max_per_channel_per_week: perWeek,
                }),
              'Standing approval is on',
            )
          }
        >
          {active ? 'Renew' : 'Turn on'}
        </button>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Drafted posts waiting for you ({candidates.length})</h3>
          {passing.length > 1 && (
            <button className={btn} disabled={busy} onClick={() => approve(passing)}>
              Approve all {passing.length} that pass
            </button>
          )}
        </div>
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-tertiary">
            Nothing waiting. Keel drafts a few each day while a standing approval is on.
          </p>
        ) : (
          <ul className="space-y-3">
            {candidates.map((e) => (
              <CandidateRow
                key={e.id + e.content_hash}
                e={e}
                busy={busy}
                onApprove={(x) => approve([x])}
                onRetire={(x) => run(() => retireBankEntry(x.id, 'discarded'), 'Discarded')}
                onSave={(x, text) => run(() => editBankEntry(x.id, text), 'Saved')}
              />
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard className="p-4">
        <h3 className="mb-2 font-semibold">Approved bank ({approved.length})</h3>
        {approved.length === 0 ? (
          <p className="text-sm text-ink-tertiary">No approved texts yet.</p>
        ) : (
          <ul className="space-y-2">
            {approved.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-tint/[0.06] p-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2">{e.content}</p>
                  <p className="mt-1 text-xs text-ink-tertiary">
                    {e.channels.join(', ')} · used {e.times_scheduled}× · approval ends{' '}
                    {e.expires_at ? when(e.expires_at) : '—'}
                  </p>
                </div>
                <button
                  className={btn}
                  disabled={busy}
                  onClick={() => run(() => retireBankEntry(e.id, 'retired by operator'), 'Retired')}
                >
                  Retire
                </button>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {status && status.upcoming.length > 0 && (
        <GlassCard className="p-4">
          <h3 className="mb-2 font-semibold">Scheduled by the engine</h3>
          <ul className="space-y-1 text-sm">
            {status.upcoming.map((u) => (
              <li key={u.id} className="flex justify-between gap-2">
                <span>{u.channel}</span>
                <span className="text-ink-tertiary">{when(u.scheduled_at)}</span>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  )
}
