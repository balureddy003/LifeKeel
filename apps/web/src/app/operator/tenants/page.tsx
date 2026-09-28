'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Search, Users } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { fetchOperatorTenants, fetchOperatorTenant, suspendOperatorTenant, reactivateOperatorTenant, type OperatorTenant, type OperatorTenantMember } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'
import { Pager } from '../_components/Pager'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
]

export default function OperatorTenantsPage() {
  const toast = useToast()
  const [tenants, setTenants] = useState<OperatorTenant[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [cursors, setCursors] = useState<string[]>([])
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [members, setMembers] = useState<Record<string, OperatorTenantMember[]>>({})
  const [membersLoading, setMembersLoading] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inbound link: /operator/tenants?q=<id> pre-fills the search — how a user
  // card's tenant chip lands here. `ready` gates the list effect so the
  // first fetch already carries the param rather than racing it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setQuery(q)
    setReady(true)
  }, [])

  const load = useCallback(async (q: string, statusFilter: string, cursor?: string) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorTenants(q, { status: statusFilter || undefined }, { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) })
      setTenants(result.tenants)
      setTotal(result.total)
      setNextCursor(result.next_cursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load tenants')
    } finally {
      setLoading(false)
    }
  }, [])

  const currentCursor = cursors[cursors.length - 1]
  useEffect(() => { if (ready) void load(query.trim(), status, currentCursor) }, [ready, load, cursors, status]) // eslint-disable-line react-hooks/exhaustive-deps

  function onQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setCursors([])
      void load(value.trim(), status)
    }, 350)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setCursors([])
    void load(query.trim(), status)
  }

  function selectStatus(value: string) {
    setStatus(value)
    setCursors([])
  }

  function goNext() {
    if (nextCursor) setCursors((prev) => [...prev, nextCursor])
  }

  function goPrev() {
    setCursors((prev) => prev.slice(0, -1))
  }

  async function toggleMembers(tenantId: string) {
    if (expanded === tenantId) {
      setExpanded(null)
      return
    }
    setExpanded(tenantId)
    if (members[tenantId]) return
    setMembersLoading(tenantId)
    try {
      const detail = await fetchOperatorTenant(tenantId)
      setMembers((prev) => ({ ...prev, [tenantId]: detail.members }))
    } catch {
      toast({ message: 'Could not load members', variant: 'error' })
      setExpanded(null)
    } finally {
      setMembersLoading(null)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Family workspaces, plans, membership and lifecycle state.</p>
      <form onSubmit={search} className="mt-5 flex gap-2">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Tenant name or ID" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search tenants"><Search size={18} /></button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => selectStatus(option.value)}
            className={`rounded-full border px-3 py-1 text-xs ${status === option.value ? 'border-family-500/40 bg-family-500/15 text-family-300' : 'border-tint/[0.08] text-ink-tertiary'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <p className="mt-5 text-xs text-ink-tertiary">{total !== undefined ? `${total.toLocaleString()} tenants` : `${tenants.length} shown`}</p>
      {loading ? <div className="shimmer mt-2 h-32 rounded-2xl" /> : (
        <div className="mt-2 space-y-3">
          {tenants.map((tenant) => (
            <GlassCard key={tenant.tenant_id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{tenant.name ?? tenant.tenant_id}</div>
                  <div className="text-xs text-ink-tertiary">{tenant.tenant_id}</div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${tenant.status === 'suspended' ? 'border-danger/25 text-danger' : 'border-tint/[0.08]'}`}>{tenant.status ?? 'unknown'}</span>
              </div>
              <div className="mt-3 flex gap-4 text-sm text-ink-secondary">
                <button
                  onClick={() => void toggleMembers(tenant.tenant_id)}
                  className="flex items-center gap-1 text-family-400 hover:underline"
                >
                  <Users size={14} /> {tenant.user_count} {tenant.user_count === 1 ? 'user' : 'users'}
                  {expanded === tenant.tenant_id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                <span>{tenant.plan ?? 'free'} plan</span>
                {tenant.country && <span>{tenant.country}</span>}
              </div>
              {expanded === tenant.tenant_id && (
                <div className="mt-3 rounded-xl bg-tint/[0.04] p-3">
                  {membersLoading === tenant.tenant_id ? (
                    <div className="shimmer h-12 rounded-lg" />
                  ) : (
                    <>
                      {(members[tenant.tenant_id] ?? []).map((member) => (
                        <div key={member.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                          <div className="min-w-0">
                            <span className="font-medium text-ink-secondary">{member.name}</span>{' '}
                            <span className="text-ink-tertiary">{member.email}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-ink-tertiary">
                            <span>{member.roles.join(', ')}</span>
                            <span className={member.status === 'suspended' ? 'text-danger' : 'text-success'}>{member.status ?? 'active'}</span>
                          </div>
                        </div>
                      ))}
                      {(members[tenant.tenant_id] ?? []).length === 0 && <p className="text-xs text-ink-tertiary">No members.</p>}
                      <Link href={`/operator/users?tenant=${encodeURIComponent(tenant.tenant_id)}`} className="mt-2 inline-block text-xs text-family-400 hover:underline">
                        Manage members in Users →
                      </Link>
                    </>
                  )}
                </div>
              )}
              <div className="mt-3">
                {tenant.status === 'suspended' ? (
                  <ReasonAction label="Reactivate tenant" onConfirm={async (r) => { await reactivateOperatorTenant(tenant.tenant_id, r); toast({ message: 'Tenant reactivated' }); await load(query.trim(), status, currentCursor) }} />
                ) : (
                  <ReasonAction label="Suspend tenant" destructive onConfirm={async (r) => { await suspendOperatorTenant(tenant.tenant_id, r); toast({ message: 'Tenant suspended' }); await load(query.trim(), status, currentCursor) }} />
                )}
              </div>
            </GlassCard>
          ))}
          {tenants.length === 0 && <p className="text-sm text-ink-tertiary">No tenants match this filter.</p>}
        </div>
      )}
      <Pager page={cursors.length} count={tenants.length} total={total} hasNext={nextCursor !== undefined} onPrev={goPrev} onNext={goNext} loading={loading} />
    </div>
  )
}
