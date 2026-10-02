'use client'

/**
 * /cashflow (PRD-131) — the family's declared income/expense ledger.
 * Entries are recurring items the family types in (a real transaction
 * feed is a connector problem, not this page's); the API computes the
 * monthly run-rate and runway against emergency savings.
 */

import { useEffect, useState } from 'react'
import { Plus, Trash2, TrendingDown, TrendingUp, Wallet, Loader2 } from 'lucide-react'
import { PageHeader, GlassCard, Money, ListSection, ListRow } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { haptic } from '@/lib/haptics'
import { fetchFamilyCashflow, addCashflowEntry, deleteCashflowEntry, type CashflowSummary } from '@/lib/api'

function gbp(minor: number): string {
  return `£${Math.round(minor / 100).toLocaleString('en-GB')}`
}

const RECURRENCE_LABELS: Record<string, string> = { weekly: '/wk', monthly: '/mo', yearly: '/yr', once: 'one-off' }

export default function CashflowPage() {
  const toast = useToast()
  const [data, setData] = useState<CashflowSummary | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [kind, setKind] = useState<'income' | 'expense'>('expense')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [recurrence, setRecurrence] = useState('monthly')
  const [busy, setBusy] = useState(false)

  const reload = () => fetchFamilyCashflow().then((d) => { setData(d); setLoaded(true) })
  useEffect(() => { void reload() }, [])

  const add = async () => {
    const pounds = Number(amount)
    if (!label.trim() || !Number.isFinite(pounds) || pounds <= 0) return
    haptic('light')
    setBusy(true)
    const ok = await addCashflowEntry({ kind, label: label.trim(), amount_minor: Math.round(pounds * 100), recurrence })
    setBusy(false)
    if (!ok) {
      haptic('warning')
      toast({ message: "Couldn't save that entry — try again", variant: 'error' })
      return
    }
    setLabel('')
    setAmount('')
    haptic('success')
    await reload()
  }

  const remove = async (id: string) => {
    haptic('light')
    const ok = await deleteCashflowEntry(id)
    if (ok) await reload()
  }

  const s = data?.summary

  return (
    <div className="px-5 pt-2 pb-10 space-y-5">
      <PageHeader title="Cash flow" backHref="/" subtitle="The money moving through your household each month" />

      {loaded && s && (
        <GlassCard className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-xs text-ink-tertiary">In</div>
              <Money value={gbp(s.monthly_inflow_minor)} className="text-base font-semibold text-success" />
            </div>
            <div>
              <div className="text-xs text-ink-tertiary">Out</div>
              <Money value={gbp(s.monthly_outflow_minor)} className="text-base font-semibold text-ink-primary" />
            </div>
            <div>
              <div className="text-xs text-ink-tertiary">Net</div>
              <Money
                value={`${s.net_minor < 0 ? '−' : '+'}${gbp(Math.abs(s.net_minor))}`}
                className={`text-base font-semibold ${s.net_minor < 0 ? 'text-danger' : 'text-success'}`}
              />
            </div>
          </div>
          {s.runway_months !== null && (
            <p className="text-xs text-ink-secondary text-center pt-1 border-t border-tint/10">
              At this burn, your emergency savings cover about <strong>{s.runway_months} months</strong>.
            </p>
          )}
          {s.net_minor >= 0 && data!.entries.length > 0 && (
            <p className="text-xs text-ink-tertiary text-center pt-1 border-t border-tint/10">
              More coming in than going out — that surplus is what funds the goals elsewhere in the app.
            </p>
          )}
        </GlassCard>
      )}

      <ListSection title="Recurring items">
        {data?.entries.map((e) => (
          <ListRow key={e.id} icon={e.kind === 'income' ? TrendingUp : TrendingDown}>
            <div className="flex items-center justify-between w-full gap-3">
              <div className="min-w-0 text-left">
                <div className="text-base font-medium truncate">{e.label}</div>
                <div className="text-xs text-ink-tertiary">
                  <Money value={gbp(e.amount_minor)} />
                  {RECURRENCE_LABELS[e.recurrence]}
                  {e.recurrence !== 'monthly' && e.recurrence !== 'once' && e.monthly_minor > 0 && (
                    <span> · <Money value={gbp(e.monthly_minor)} />/mo</span>
                  )}
                </div>
              </div>
              <button
                onClick={(ev) => { ev.stopPropagation(); void remove(e.id) }}
                aria-label={`Remove ${e.label}`}
                className="p-2 rounded-lg text-ink-tertiary hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </ListRow>
        ))}
        {loaded && data?.entries.length === 0 && (
          <ListRow>
            <p className="text-sm text-ink-tertiary">Nothing here yet — add the big recurring items (salary, rent, childcare) and Oak will keep the monthly picture current.</p>
          </ListRow>
        )}
      </ListSection>

      <GlassCard className="p-4 space-y-3">
        <div className="flex gap-2">
          {(['expense', 'income'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { haptic('light'); setKind(k) }}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-colors ${kind === k ? 'bg-family-500/20 text-family-300 border border-family-500/30' : 'bg-tint/[0.03] text-ink-tertiary border border-transparent'}`}
            >
              {k === 'expense' ? 'Money out' : 'Money in'}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder={kind === 'expense' ? 'e.g. Rent, childcare, groceries' : 'e.g. Salary, rental income'}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="glass-input w-full rounded-xl px-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 transition-all"
        />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-tertiary text-sm">£</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              className="glass-input w-full rounded-xl pl-8 pr-4 py-3 text-base text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 transition-all"
            />
          </div>
          <select
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
            className="glass-input rounded-xl px-3 py-3 text-sm text-ink-primary outline-none"
            aria-label="How often"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="once">One-off</option>
          </select>
        </div>
        <button
          type="button"
          onClick={add}
          disabled={busy || !label.trim() || !amount}
          className="w-full glass rounded-2xl py-3 text-sm font-semibold text-family-400 flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add {kind === 'expense' ? 'expense' : 'income'}
        </button>
      </GlassCard>

      <p className="text-xs text-ink-tertiary text-center px-4">
        Entries you add here are what your scenarios and runway figures reason about — until a live bank connection lands, this ledger is the source.
      </p>
    </div>
  )
}
