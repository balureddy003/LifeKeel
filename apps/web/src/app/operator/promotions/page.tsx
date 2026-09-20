'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchOperatorPromotions, createOperatorPromotion, deactivatePromotion, reactivatePromotion,
  type OperatorPromotion,
} from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

export default function OperatorPromotionsPage() {
  const toast = useToast()
  const [promotions, setPromotions] = useState<OperatorPromotion[]>([])
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ code: '', grant_credits: '', max_uses: '0', expires_at: '', reason: '' })
  const [createError, setCreateError] = useState<string | null>(null)

  async function load(q = '') {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorPromotions(q)
      setPromotions(result.promotions)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load promotions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function search(event: FormEvent) {
    event.preventDefault()
    void load(query.trim())
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await createOperatorPromotion({
        code: form.code.trim(),
        grant_credits: Number(form.grant_credits),
        max_uses: Number(form.max_uses) || 0,
        ...(form.expires_at ? { expires_at: new Date(form.expires_at).toISOString() } : {}),
      }, form.reason.trim())
      toast({ message: `Code ${form.code.trim().toUpperCase()} created` })
      setForm({ code: '', grant_credits: '', max_uses: '0', expires_at: '', reason: '' })
      await load(query.trim())
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create promotion')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Promotions</h1>
      <p className="mt-1 text-sm text-ink-tertiary">
        Credit-grant promo codes redeemable via the billing flow. Every change is audited.
      </p>

      <GlassCard className="mt-5 p-4">
        <h2 className="text-sm font-semibold">New code</h2>
        <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Code (e.g. LAUNCH50)" className="glass-input rounded-xl px-4 py-3 text-sm" required minLength={3} />
          <input value={form.grant_credits} onChange={(e) => setForm({ ...form, grant_credits: e.target.value })} placeholder="Credits granted" type="number" min={1} className="glass-input rounded-xl px-4 py-3 text-sm" required />
          <input value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} placeholder="Max uses (0 = unlimited)" type="number" min={0} className="glass-input rounded-xl px-4 py-3 text-sm" />
          <input value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} type="date" className="glass-input rounded-xl px-4 py-3 text-sm" aria-label="Expiry date" />
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason (required, audited)" className="glass-input rounded-xl px-4 py-3 text-sm sm:col-span-2" required minLength={5} />
          {createError && <p className="text-xs text-danger sm:col-span-2">{createError}</p>}
          <button disabled={creating || form.reason.trim().length < 5} className="rounded-xl bg-family-500 py-3 text-sm font-semibold text-white disabled:opacity-40 sm:col-span-2">
            {creating ? 'Creating…' : 'Create code'}
          </button>
        </form>
      </GlassCard>

      <form onSubmit={search} className="mt-5 flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by code" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search promotions"><Search size={18} /></button>
      </form>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? <div className="shimmer mt-5 h-32 rounded-2xl" /> : (
        <div className="mt-5 space-y-3">
          <p className="text-xs text-ink-tertiary">{total} codes</p>
          {promotions.map((promo) => (
            <GlassCard key={promo.code} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-mono font-medium">{promo.code}</div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${promo.active ? 'border-success/25 text-success' : 'border-danger/25 text-danger'}`}>
                  {promo.active ? 'active' : 'inactive'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
                <span>{promo.grant_credits} credits</span>
                <span>{promo.used_count}{promo.max_uses > 0 ? ` / ${promo.max_uses}` : ''} redeemed</span>
                {promo.expires_at && <span>Expires: {new Date(promo.expires_at).toLocaleDateString()}</span>}
                <span>Created: {new Date(promo.created_at).toLocaleDateString()}</span>
              </div>
              <div className="mt-3 flex gap-2">
                {promo.active ? (
                  <ReasonAction label="Deactivate" destructive onConfirm={async (r) => { await deactivatePromotion(promo.code, r); toast({ message: 'Code deactivated' }); await load(query.trim()) }} />
                ) : (
                  <ReasonAction label="Reactivate" onConfirm={async (r) => { await reactivatePromotion(promo.code, r); toast({ message: 'Code reactivated' }); await load(query.trim()) }} />
                )}
              </div>
            </GlassCard>
          ))}
          {promotions.length === 0 && (
            <GlassCard className="p-4"><p className="text-sm text-ink-secondary">No promo codes yet.</p></GlassCard>
          )}
        </div>
      )}
    </div>
  )
}
