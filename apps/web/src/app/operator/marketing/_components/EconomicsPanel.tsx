'use client'

/**
 * Channel economics — which sources, pillars and content bring paying families,
 * what they cost, and how far to trust each number. Everything is aggregate:
 * counts by source / campaign / content item with a plausible range, never a
 * person. Thin rows say so instead of showing a confident-looking rate.
 */

import { useCallback, useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  addSpendEntry,
  deleteSpendEntry,
  fetchEconomics,
  fetchSpend,
  syncRevenueNow,
  type EconomicsConfidence,
  type EconomicsRate,
  type EconomicsRow,
  type EconomicsView,
  type SpendEntry,
} from '@/lib/api'
import { ReasonAction } from '../../_components/ReasonAction'

const gbp = (pence: number | null) =>
  pence === null
    ? '—'
    : `£${(pence / 100).toLocaleString('en-GB', {
        minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      })}`

/** The rollup's bucket for "no campaign tag" reads badly as a raw key. */
const keyLabel = (key: string) => (key === 'none' ? '(no campaign)' : key)

const pct = (r: number) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`

const BADGE: Record<EconomicsConfidence, { label: string; cls: string; title: string }> = {
  insufficient: {
    label: 'too early',
    cls: 'bg-tint/[0.06] text-ink-tertiary',
    title: 'Not enough visits or signups to compare this with anything.',
  },
  directional: {
    label: 'directional',
    cls: 'bg-warning/15 text-warning',
    title: 'Enough to notice, not enough to act on alone.',
  },
  solid: {
    label: 'solid',
    cls: 'bg-success/15 text-success',
    title: 'Enough signups and paid families to trust.',
  },
}

function RateCell({ r }: { r: EconomicsRate | null }) {
  if (!r || r.rate === null) return <span className="text-ink-tertiary">—</span>
  return (
    <span
      title={
        r.low !== null && r.high !== null
          ? `Plausible range ${pct(r.low)}–${pct(r.high)}`
          : undefined
      }
    >
      {pct(r.rate)}
      {r.low !== null && r.high !== null && (
        <span className="ml-1 text-[10px] text-ink-tertiary">
          {pct(r.low)}–{pct(r.high)}
        </span>
      )}
    </span>
  )
}

function Table({
  title,
  rows,
  showSpend,
}: {
  title: string
  rows: EconomicsRow[]
  showSpend: boolean
}) {
  if (rows.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="mb-1 text-left text-xs font-semibold text-ink-secondary">
          {title}
        </caption>
        <thead>
          <tr className="text-left text-ink-tertiary">
            <th scope="col" className="py-1 pr-2 font-normal">
              {title.replace('By ', '')}
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Visits
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Signups
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Visit → signup
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Activated
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Paid
            </th>
            <th scope="col" className="px-2 py-1 text-right font-normal">
              Revenue
            </th>
            {showSpend && (
              <th scope="col" className="px-2 py-1 text-right font-normal">
                Spend
              </th>
            )}
            {showSpend && (
              <th scope="col" className="px-2 py-1 text-right font-normal">
                CAC
              </th>
            )}
            <th scope="col" className="py-1 pl-2 text-right font-normal">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-tint/[0.06]">
              <th scope="row" className="py-1 pr-2 text-left font-medium text-ink-primary">
                {keyLabel(r.key)}
              </th>
              <td className="px-2 py-1 text-right">{r.visits ?? '—'}</td>
              <td className="px-2 py-1 text-right">{r.signups}</td>
              <td className="px-2 py-1 text-right">
                <RateCell r={r.visit_to_signup} />
              </td>
              <td className="px-2 py-1 text-right">{r.activated}</td>
              <td className="px-2 py-1 text-right">{r.paid}</td>
              <td className="px-2 py-1 text-right">{gbp(r.revenue_pence)}</td>
              {showSpend && <td className="px-2 py-1 text-right">{gbp(r.spend_pence)}</td>}
              {showSpend && <td className="px-2 py-1 text-right">{gbp(r.cac_pence)}</td>}
              <td className="py-1 pl-2 text-right">
                <span
                  title={BADGE[r.confidence].title}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[r.confidence].cls}`}
                >
                  {BADGE[r.confidence].label}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SpendForm({ onAdded }: { onAdded: () => void }) {
  const toast = useToast()
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [channel, setChannel] = useState('')
  const [pounds, setPounds] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = Math.round(Number(pounds) * 100)
  const valid =
    /^\d{4}-\d{2}$/.test(month) && channel.trim() !== '' && amount > 0 && reason.trim().length >= 5

  return (
    <form
      className="mt-2 grid gap-2 sm:grid-cols-6"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setError(null)
        try {
          await addSpendEntry(
            { month, channel: channel.trim(), amount_pence: amount, ...(note ? { note } : {}) },
            reason.trim(),
          )
          toast({ message: 'Spend recorded', variant: 'success' })
          setChannel('')
          setPounds('')
          setNote('')
          setReason('')
          onAdded()
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not record spend')
        } finally {
          setBusy(false)
        }
      }}
    >
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        aria-label="Month"
        className="glass-input rounded-lg px-2 py-1.5 text-xs"
      />
      <input
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        placeholder="Channel (bluesky)"
        aria-label="Channel"
        className="glass-input rounded-lg px-2 py-1.5 text-xs"
      />
      <input
        value={pounds}
        onChange={(e) => setPounds(e.target.value)}
        inputMode="decimal"
        placeholder="Amount £"
        aria-label="Amount in pounds"
        className="glass-input rounded-lg px-2 py-1.5 text-xs"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note"
        className="glass-input rounded-lg px-2 py-1.5 text-xs"
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (audited)"
        aria-label="Reason"
        className="glass-input rounded-lg px-2 py-1.5 text-xs"
      />
      <button
        disabled={!valid || busy}
        className="rounded-lg bg-family-500/15 px-3 py-1.5 text-xs font-semibold text-family-400 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Add spend'}
      </button>
      {error && <p className="text-xs text-danger sm:col-span-6">{error}</p>}
    </form>
  )
}

export function EconomicsPanel() {
  const toast = useToast()
  const [days, setDays] = useState(90)
  const [model, setModel] = useState<'first' | 'last'>('first')
  const [view, setView] = useState<EconomicsView | null>(null)
  const [spend, setSpend] = useState<SpendEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([fetchEconomics(days, model), fetchSpend()])
      setView(v)
      setSpend(s.entries)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load economics')
    }
  }, [days, model])

  useEffect(() => {
    void load()
  }, [load])

  if (error)
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-danger">{error}</p>
      </GlassCard>
    )
  if (!view) return <div className="shimmer h-40 rounded-2xl" />

  const t = view.totals
  const findings = [...view.by_source, ...view.by_campaign].filter(
    (r) => r.signups > 0 || (r.visits ?? 0) > 0,
  )

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Channel economics</h2>
            <p className="text-xs text-ink-tertiary">
              Which channels and content bring paying families. Aggregate counts only, with a
              plausible range — a thin row says so instead of guessing.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div
              role="group"
              aria-label="Attribution model"
              className="flex rounded-lg border border-tint/[0.1] p-0.5"
            >
              {(['first', 'last'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  aria-pressed={model === m}
                  className={`rounded-md px-2.5 py-1 ${model === m ? 'bg-family-500/20 text-family-300' : 'text-ink-tertiary'}`}
                >
                  {m === 'first' ? 'First touch' : 'Last touch'}
                </button>
              ))}
            </div>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Window"
              className="glass-input rounded-lg px-2 py-1.5"
            >
              {[30, 90, 180].map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-6">
          {[
            ['Visits', t.visits ?? 0],
            ['Signups', t.signups],
            ['Paid', t.paid],
            ['Revenue', gbp(t.revenue_pence)],
            ['Spend', gbp(t.spend_pence)],
            ['CAC', gbp(t.cac_pence)],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-tint/[0.04] p-2">
              <div className="text-[10px] uppercase tracking-wide text-ink-tertiary">{label}</div>
              <div className="text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
          <span>
            Revenue:{' '}
            {view.revenue.synced
              ? `from Stripe, synced ${view.revenue.last_sync_at ? new Date(view.revenue.last_sync_at).toLocaleString() : ''}${view.revenue.livemode === false ? ' (test mode)' : ''}`
              : 'not synced — Stripe read-only key not connected yet'}
          </span>
          <ReasonAction
            label="Sync revenue now"
            description="Reads paid invoices, refunds and subscriptions from Stripe with the read-only key. Nothing is changed in Stripe."
            onConfirm={async (reason) => {
              const r = await syncRevenueNow(reason)
              toast({
                message: `Synced ${r.invoices} invoices, ${r.subscriptions} subscriptions`,
                variant: 'success',
              })
              await load()
            }}
          />
        </div>
      </GlassCard>

      {view.notes.length > 0 && (
        <GlassCard className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
            Read this first
          </h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-ink-secondary">
            {view.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </GlassCard>
      )}

      <GlassCard className="space-y-5 p-4">
        {findings.length === 0 ? (
          <p className="text-sm text-ink-secondary">
            No visits or signups in this window yet. Numbers appear after the daily rollup runs.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5 text-xs text-ink-secondary">
              {findings.map((r) => (
                <li key={`f-${r.key}`}>{r.finding}</li>
              ))}
            </ul>
            <Table title="By source" rows={view.by_source} showSpend />
            <Table title="By pillar" rows={view.by_campaign} showSpend={false} />
            <Table title="By content item" rows={view.by_content} showSpend={false} />
          </>
        )}
      </GlassCard>

      <GlassCard className="p-4">
        <h3 className="font-semibold">Spend</h3>
        <p className="text-xs text-ink-tertiary">
          Typed in by you, per channel and month. It is spread across days to match the window
          above.
        </p>
        <SpendForm onAdded={() => void load()} />
        {spend.length > 0 && (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="text-left text-ink-tertiary">
                <th scope="col" className="py-1 font-normal">
                  Month
                </th>
                <th scope="col" className="py-1 font-normal">
                  Channel
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Amount
                </th>
                <th scope="col" className="py-1 pl-3 font-normal">
                  Note
                </th>
                <th scope="col" className="py-1" />
              </tr>
            </thead>
            <tbody>
              {spend.map((e) => (
                <tr key={e.id} className="border-t border-tint/[0.06]">
                  <td className="py-1">{e.month}</td>
                  <td className="py-1">{e.channel}</td>
                  <td className="py-1 text-right">{gbp(e.amount_pence)}</td>
                  <td className="py-1 pl-3 text-ink-tertiary">{e.note ?? ''}</td>
                  <td className="py-1 text-right">
                    <ReasonAction
                      label="Remove"
                      destructive
                      description={`Remove ${gbp(e.amount_pence)} for ${e.channel} in ${e.month}.`}
                      onConfirm={async (reason) => {
                        await deleteSpendEntry(e.id, reason)
                        toast({ message: 'Spend removed', variant: 'success' })
                        await load()
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GlassCard>
    </div>
  )
}
