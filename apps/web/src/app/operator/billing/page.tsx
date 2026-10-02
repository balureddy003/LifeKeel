'use client'

import { FormEvent, useEffect, useState } from 'react'
import { CreditCard, Search } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchOperatorBilling, fetchBillingTenant, adjustTenantCredits,
  type BillingTenant, type LedgerEntry, type OperatorBillingOverview,
} from '@/lib/api'

export default function OperatorBillingPage() {
  const toast = useToast()
  const [overview, setOverview] = useState<OperatorBillingOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState('')
  const [tenant, setTenant] = useState<BillingTenant | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [tenantError, setTenantError] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)

  useEffect(() => {
    fetchOperatorBilling()
      .then(setOverview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load billing overview'))
  }, [])

  async function searchTenant(event: FormEvent) {
    event.preventDefault()
    setTenantError(null)
    setTenant(null)
    setLedger([])
    try {
      const result = await fetchBillingTenant(tenantId.trim())
      setTenant(result.tenant)
      setLedger(result.ledger)
    } catch (err) {
      setTenantError(err instanceof Error ? err.message : 'Tenant not found')
    }
  }

  async function adjust(event: FormEvent) {
    event.preventDefault()
    if (!tenant) return
    setAdjusting(true)
    setAdjustError(null)
    try {
      const balance = await adjustTenantCredits(tenant.tenant_id, Number(amount), reason.trim())
      toast({ message: `Balance is now ${balance}` })
      setAmount('')
      setReason('')
      const result = await fetchBillingTenant(tenant.tenant_id)
      setTenant(result.tenant)
      setLedger(result.ledger)
    } catch (err) {
      setAdjustError(err instanceof Error ? err.message : 'Adjustment failed')
    } finally {
      setAdjusting(false)
    }
  }

  const input = 'glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40'

  return (
    <div>
      <h1 className="text-2xl font-semibold">Billing</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        Plan distribution, credit exposure, and Stripe webhook intake. Stripe remains the source of truth for subscriptions.
      </p>

      {error && <GlassCard className="mt-4 p-4"><p className="text-sm text-danger">{error}</p></GlassCard>}

      {overview && (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <GlassCard className="p-4">
              <div className="flex items-center justify-between"><span className="text-sm text-ink-secondary">Credits outstanding</span><CreditCard size={18} className="text-family-400" /></div>
              <div className="mt-2 text-2xl font-semibold">{overview.credits_outstanding.toLocaleString()}</div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="text-sm text-ink-secondary">Stripe-linked tenants</div>
              <div className="mt-2 text-2xl font-semibold">{overview.stripe_linked_tenants}</div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="text-sm text-ink-secondary">Low-credit tenants</div>
              <div className="mt-2 text-2xl font-semibold">{overview.low_credit_tenants}</div>
              <div className="mt-1 text-xs text-ink-tertiary">Balance ≤ 3</div>
            </GlassCard>
            <GlassCard className="p-4">
              <div className="text-sm text-ink-secondary">Tenants by plan</div>
              <div className="mt-2 space-y-0.5 text-sm">
                {Object.entries(overview.tenants_by_plan).map(([plan, count]) => (
                  <div key={plan} className="flex justify-between"><span className="text-ink-secondary">{plan}</span><span>{count}</span></div>
                ))}
              </div>
            </GlassCard>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <GlassCard className="p-4">
              <h2 className="font-semibold">Recent Stripe webhooks</h2>
              <div className="mt-3 divide-y divide-tint/[0.06]">
                {overview.recent_webhooks.length === 0 && <p className="text-sm text-ink-tertiary">No webhook events processed.</p>}
                {overview.recent_webhooks.map((event) => (
                  <div key={event.event_id} className="flex justify-between gap-2 py-2 text-sm">
                    <span className="text-ink-secondary truncate">{event.event_type}</span>
                    <span className="text-xs text-ink-tertiary flex-shrink-0">{new Date(event.processed_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
            <GlassCard className="p-4">
              <h2 className="font-semibold">Recent manual adjustments</h2>
              <div className="mt-3 divide-y divide-tint/[0.06]">
                {overview.recent_adjustments.length === 0 && <p className="text-sm text-ink-tertiary">No manual adjustments.</p>}
                {overview.recent_adjustments.map((entry, i) => (
                  <div key={i} className="py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-ink-secondary">{entry.tenant_id}</span>
                      <span className={entry.amount >= 0 ? 'text-success' : 'text-danger'}>{entry.amount >= 0 ? '+' : ''}{entry.amount}</span>
                    </div>
                    <p className="text-xs text-ink-tertiary mt-0.5">{entry.reason} — {entry.actor}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>

          <GlassCard className="mt-5 p-4">
            <h2 className="font-semibold">Churn</h2>
            {Object.keys(overview.churn_by_reason ?? {}).length === 0 && overview.recent_churned?.length === 0 && (
              <p className="mt-2 text-sm text-ink-tertiary">
                No churned tenants. Stripe portal cancellation reasons land here once subscription cancellation
                collection is enabled in the Stripe Dashboard.
              </p>
            )}
            {Object.keys(overview.churn_by_reason ?? {}).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(overview.churn_by_reason).map(([reason, count]) => (
                  <span key={reason} className="rounded-full border border-tint/[0.1] px-2.5 py-1 text-xs text-ink-secondary">
                    {reason.replaceAll('_', ' ')} · {count}
                  </span>
                ))}
              </div>
            )}
            {(overview.recent_churned ?? []).length > 0 && (
              <div className="mt-3 divide-y divide-tint/[0.06]">
                {overview.recent_churned.map((c) => (
                  <div key={c.tenant_id} className="py-2 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-ink-secondary">{c.name ?? c.tenant_id}</span>
                      <span className="text-xs text-ink-tertiary">{c.churned_at ? new Date(c.churned_at).toLocaleDateString() : ''}</span>
                    </div>
                    <p className="text-xs text-ink-tertiary mt-0.5">
                      {(c.reason ?? 'unstated').replaceAll('_', ' ')}{c.feedback ? ` — "${c.feedback}"` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">Tenant billing</h2>
      <form onSubmit={searchTenant} className="mt-3 flex gap-2">
        <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Tenant ID" className={input + ' flex-1'} />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Find tenant"><Search size={18} /></button>
      </form>
      {tenantError && <p className="mt-3 text-sm text-danger">{tenantError}</p>}

      {tenant && (
        <GlassCard className="mt-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-medium">{tenant.name ?? tenant.tenant_id}</div>
              <div className="text-xs text-ink-tertiary">{tenant.tenant_id}</div>
            </div>
            <span className="rounded-full border border-family-500/25 px-2 py-0.5 text-xs text-family-400">{tenant.plan ?? 'free'}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
            <span>Balance: {tenant.billing?.credits_balance ?? 0} credits</span>
            <span>Status: {tenant.status ?? 'active'}</span>
            {tenant.stripe_customer_id && <span>Stripe: {tenant.stripe_customer_id}</span>}
          </div>

          <form onSubmit={adjust} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] border-t border-tint/[0.06] pt-4">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="± credits" className={input} required />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" className={input} required minLength={5} />
            <button disabled={adjusting || !amount || Number(amount) === 0 || reason.trim().length < 5} className="rounded-xl bg-family-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
              {adjusting ? 'Applying…' : 'Adjust'}
            </button>
            {adjustError && <p className="text-xs text-danger sm:col-span-3">{adjustError}</p>}
          </form>

          <div className="mt-4 divide-y divide-tint/[0.06] border-t border-tint/[0.06] pt-2">
            {ledger.length === 0 && <p className="py-2 text-sm text-ink-tertiary">No ledger entries.</p>}
            {ledger.map((entry) => (
              <div key={entry.id} className="py-2 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-ink-secondary">{entry.type.replaceAll('_', ' ')}</span>
                  <span className={entry.amount >= 0 ? 'text-success' : 'text-danger'}>{entry.amount >= 0 ? '+' : ''}{entry.amount} → {entry.balance_after}</span>
                </div>
                <p className="text-xs text-ink-tertiary mt-0.5">
                  {entry.reason} — {entry.actor} — {new Date(entry.timestamp).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
