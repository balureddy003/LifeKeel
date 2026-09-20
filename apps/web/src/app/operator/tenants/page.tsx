'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { fetchOperatorTenants, suspendOperatorTenant, reactivateOperatorTenant, type OperatorTenant } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

export default function OperatorTenantsPage() {
  const toast = useToast()
  const [tenants, setTenants] = useState<OperatorTenant[]>([])
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(value = '') {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorTenants(value)
      setTenants(result.tenants)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load tenants')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  function search(event: FormEvent) {
    event.preventDefault()
    void load(query.trim())
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Family workspaces, plans, membership and lifecycle state.</p>
      <form onSubmit={search} className="mt-5 flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tenant name or ID" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search tenants"><Search size={18} /></button>
      </form>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? <div className="shimmer mt-5 h-32 rounded-2xl" /> : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <p className="text-xs text-ink-tertiary md:col-span-2">{total} tenants</p>
          {tenants.map((tenant) => (
            <GlassCard key={tenant.tenant_id} className="p-4">
              <div className="flex items-start justify-between gap-2"><div><div className="font-medium">{tenant.name ?? tenant.tenant_id}</div><div className="text-xs text-ink-tertiary">{tenant.tenant_id}</div></div><span className="rounded-full border border-tint/[0.08] px-2 py-0.5 text-xs">{tenant.status ?? 'unknown'}</span></div>
              <div className="mt-3 flex gap-4 text-sm text-ink-secondary"><span>{tenant.user_count} users</span><span>{tenant.plan ?? 'free'} plan</span>{tenant.country && <span>{tenant.country}</span>}</div>
              <div className="mt-3">
                {tenant.status === 'suspended' ? (
                  <ReasonAction label="Reactivate tenant" onConfirm={async (r) => { await reactivateOperatorTenant(tenant.tenant_id, r); toast({ message: 'Tenant reactivated' }); await load(query.trim()) }} />
                ) : (
                  <ReasonAction label="Suspend tenant" destructive onConfirm={async (r) => { await suspendOperatorTenant(tenant.tenant_id, r); toast({ message: 'Tenant suspended' }); await load(query.trim()) }} />
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}
