'use client'

/**
 * /cashflow (PRD-131) — the family's declared income/expense ledger.
 * Entries are recurring items the family types in (a real transaction
 * feed is a connector problem, not this page's); the API computes the
 * monthly run-rate and runway against emergency savings.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, TrendingDown, TrendingUp, Wallet, Loader2 } from 'lucide-react'
import { PageHeader, GlassCard, Money, ListSection, ListRow } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { haptic } from '@/lib/haptics'
import { fetchFamilyCashflow, addCashflowEntry, deleteCashflowEntry, fetchFinancialProfile, type CashflowSummary } from '@/lib/api'

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
  // Salary already entered in the financial profile, offered as a ledger entry when the ledger has no income yet.
  const [profileSalaryMinor, setProfileSalaryMinor] = useState(0)

  const reload = () => fetchFamilyCashflow().then((d) => { setData(d); setLoaded(true) })
  useEffect(() => {
    void reload()
    fetchFinancialProfile()
      .then((p) => setProfileSalaryMinor(p?.household.monthly_salary_minor ?? 0))
      .catch(() => {})
  }, [])

  const hasIncomeEntry = data?.entries.some((e) => e.kind === 'income') ?? false
  const addProfileSalary = async () => {
    haptic('light')
    setBusy(true)
    const ok = await addCashflowEntry({ kind: 'income', label: 'Salary (from your profile)', amount_minor: profileSalaryMinor, recurrence: 'monthly' })
    setBusy(false)
    if (!ok) { haptic('warning'); toast({ message: "Couldn't save that entry — try again", variant: 'error' }); return }
    haptic('success')
    await reload()
  }

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

          {/* Proportional in/out bar — the visual "how much goes where" */}
          {s.monthly_inflow_minor > 0 || s.monthly_outflow_minor > 0 ? (
            <div className="space-y-1.5">
              <div className="flex h-3 rounded-full overflow-hidden bg-tint/[0.05]">
                <motion.div
                  className="bg-success rounded-l-full"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${s.monthly_inflow_minor + s.monthly_outflow_minor > 0
                      ? Math.max(2, (s.monthly_inflow_minor / (s.monthly_inflow_minor + s.monthly_outflow_minor)) * 100)
                      : 50}%`,
                  }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
                <motion.div
                  className="bg-danger/60 rounded-r-full"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${s.monthly_inflow_minor + s.monthly_outflow_minor > 0
                      ? Math.max(2, (s.monthly_outflow_minor / (s.monthly_inflow_minor + s.monthly_outflow_minor)) * 100)
                      : 50}%`,
                  }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-ink-tertiary">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-success inline-block" />
                  {Math.round((s.monthly_inflow_minor / (s.monthly_inflow_minor + s.monthly_outflow_minor)) * 100)}% in
                </span>
                <span className="flex items-center gap-1">
                  {Math.round((s.monthly_outflow_minor / (s.monthly_inflow_minor + s.monthly_outflow_minor)) * 100)}% out
                  <span className="w-2 h-2 rounded-full bg-danger/60 inline-block" />
                </span>
              </div>
            </div>
          ) : null}

          {s.runway_months !== null && (
            <div className="pt-1 border-t border-tint/10">
              <div className="flex items-center gap-2 mb-1.5">
                <Wallet size={12} className="text-ink-tertiary" />
                <span className="text-xs text-ink-secondary">
                  Emergency savings cover <strong>{s.runway_months} months</strong>
                </span>
              </div>
              {/* Runway gauge — 0–12 month scale */}
              <div className="h-2 rounded-full bg-tint/[0.05] overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${s.runway_months >= 6 ? 'bg-success' : s.runway_months >= 3 ? 'bg-warning' : 'bg-danger'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (s.runway_months / 12) * 100)}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut', delay: 0.3 }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-ink-tertiary mt-1">
                <span>0</span>
                <span>3 mo</span>
                <span>6 mo</span>
                <span>12+ mo</span>
              </div>
            </div>
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
            <p className="text-sm text-ink-tertiary">Nothing here yet — add the big recurring items (salary, rent, childcare) and Keel will keep the monthly picture current.</p>
          </ListRow>
        )}
      </ListSection>

      {loaded && profileSalaryMinor > 0 && !hasIncomeEntry && (
        <GlassCard className="p-4 flex items-center gap-3">
          <p className="flex-1 text-sm text-ink-secondary">
            Your financial profile lists <Money value={gbp(profileSalaryMinor)} /> a month of income. Add it here so this page includes it.
          </p>
          <button onClick={addProfileSalary} disabled={busy} className="text-xs font-semibold text-family-400 px-3 py-2 rounded-lg bg-family-500/10 flex-shrink-0 disabled:opacity-50">
            Add as income
          </button>
        </GlassCard>
      )}

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
          aria-label="What it is"
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
              placeholder="0" aria-label="Amount in pounds"
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
        Entries you add here feed Keel's monthly picture and runway checks, until a live bank connection lands. What-If scenarios use the figures in your financial profile.
      </p>
    </div>
  )
}
