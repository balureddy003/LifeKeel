'use client'

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Search, ShieldAlert, X } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { fetchOperatorUsers, fetchOperatorSecurity, suspendOperatorUser, reactivateOperatorUser, sendUserPasswordReset, revokeUserSessions, unlockUser, type OperatorSecurity, type OperatorUser } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'
import { Pager } from '../_components/Pager'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
]

function isLocked(user: OperatorUser): boolean {
  return user.locked_until !== undefined && new Date(user.locked_until).getTime() > Date.now()
}

export default function OperatorUsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<OperatorUser[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [security, setSecurity] = useState<OperatorSecurity | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inbound drill-down: /operator/users?tenant=<id> opens the list already
  // scoped to one workspace's members. `ready` gates the list effect so the
  // first fetch already carries the param rather than racing it.
  useEffect(() => {
    const tenant = new URLSearchParams(window.location.search).get('tenant')
    if (tenant) setTenantFilter(tenant)
    setReady(true)
  }, [])

  const load = useCallback(async (q: string, statusFilter: string, tenant: string, pageOffset: number) => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorUsers(q, { status: statusFilter || undefined, tenant: tenant || undefined }, { limit: PAGE_SIZE, offset: pageOffset })
      setUsers(result.users)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (ready) void load(query.trim(), status, tenantFilter, offset) }, [ready, load, offset, status, tenantFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchOperatorSecurity().then(setSecurity).catch(() => setSecurity(null))
  }, [])

  /** Debounced live search — keeps the server-roundtrip count sane while
   *  typing, without making operators hit Enter for every keystroke. */
  function onQueryChange(value: string) {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setOffset(0)
      void load(value.trim(), status, tenantFilter, 0)
    }, 350)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setOffset(0)
    void load(query.trim(), status, tenantFilter, 0)
  }

  function selectStatus(value: string) {
    setStatus(value)
    setOffset(0)
  }

  function clearTenantFilter() {
    setTenantFilter('')
    setOffset(0)
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Cross-tenant account visibility. Sensitive credentials are never returned.</p>
      <form onSubmit={search} className="mt-5 flex gap-2">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Email, name, user or tenant ID" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search users"><Search size={18} /></button>
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
        {tenantFilter && (
          <button
            onClick={clearTenantFilter}
            className="flex items-center gap-1 rounded-full border border-family-500/40 bg-family-500/15 px-3 py-1 text-xs text-family-300"
          >
            Tenant: {tenantFilter} <X size={12} />
          </button>
        )}
      </div>
      {security && (security.locked_users.length > 0 || security.users_with_failed_logins > 0 || security.logins_24h.failed > 0) && (
        <GlassCard className="mt-4 border-warning/25 p-4">
          <div className="flex items-center gap-2 text-warning"><ShieldAlert size={16} /><span className="text-sm font-semibold">Security</span></div>
          <p className="mt-1 text-xs text-ink-secondary">
            {security.locked_users.length} locked out · {security.users_with_failed_logins} with failed attempts · {security.sessions_revoked_7d} session revocations this week
          </p>
          <p className="mt-1 text-xs text-ink-secondary">
            Last 24h: {security.logins_24h.successful} successful · {security.logins_24h.failed} failed logins
          </p>
          {security.failed_by_ip_24h.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-ink-secondary">Failures by IP (24h)</p>
              {security.failed_by_ip_24h.map((row) => (
                <div key={row.ip} className="mt-1 flex items-center justify-between rounded-lg bg-warning/10 px-3 py-1.5 text-xs">
                  <code className="text-ink-secondary">{row.ip}</code>
                  <span className="text-warning">{row.count} failed</span>
                </div>
              ))}
            </div>
          )}
          {security.new_ip_logins_24h.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-ink-secondary">First-seen IPs (24h) — verify these are expected sign-ins</p>
              {security.new_ip_logins_24h.map((row) => (
                <div key={`${row.email}-${row.ip}`} className="mt-1 flex items-center justify-between rounded-lg bg-tint/[0.04] px-3 py-1.5 text-xs">
                  <span className="text-ink-secondary">{row.email}</span>
                  <code className="text-ink-tertiary">{row.ip}</code>
                </div>
              ))}
            </div>
          )}
          {security.locked_users.map((u) => (
            <div key={u.id} className="mt-2 flex items-center justify-between rounded-lg bg-warning/10 px-3 py-2 text-xs">
              <span className="text-ink-secondary">
                {u.email} · <code>{u.tenant_id}</code> · {u.failed_login_attempts} attempts
                {u.locked_until && <> · locked until {new Date(u.locked_until).toLocaleTimeString()}</>}
              </span>
              <ReasonAction
                label="Unlock"
                onConfirm={async (r) => {
                  await unlockUser(u.id, r)
                  toast({ message: 'Lockout cleared', variant: 'success' })
                  fetchOperatorSecurity().then(setSecurity).catch(() => {})
                }}
              />
            </div>
          ))}
        </GlassCard>
      )}
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <p className="mt-5 text-xs text-ink-tertiary">{total.toLocaleString()} users</p>
      {loading ? <div className="shimmer mt-2 h-32 rounded-2xl" /> : (
        <div className="mt-2 space-y-3">
          {users.map((user) => (
            <GlassCard key={user.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="font-medium">{user.name}</div><div className="text-sm text-ink-secondary">{user.email}</div></div>
                <div className="flex gap-2">
                  {user.attribution?.utm_source && (
                    <span className="rounded-full border border-family-500/25 px-2 py-0.5 text-xs text-family-400">{user.attribution.utm_source}</span>
                  )}
                  {isLocked(user) && <span className="rounded-full border border-warning/40 px-2 py-0.5 text-xs text-warning">locked</span>}
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${user.status === 'suspended' ? 'border-danger/25 text-danger' : 'border-success/25 text-success'}`}>{user.status ?? 'active'}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary">
                <span>
                  Tenant:{' '}
                  <Link href={`/operator/tenants?q=${encodeURIComponent(user.tenant_id)}`} className="text-family-400 hover:underline">{user.tenant_id}</Link>
                </span>
                <span>Roles: {user.roles.join(', ')}</span>
                <span>Joined: {new Date(user.created_at).toLocaleDateString()}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {user.status === 'suspended' ? (
                  <ReasonAction label="Reactivate" onConfirm={async (r) => { await reactivateOperatorUser(user.id, r); toast({ message: 'User reactivated' }); await load(query.trim(), status, tenantFilter, offset) }} />
                ) : (
                  <ReasonAction label="Suspend" destructive onConfirm={async (r) => { await suspendOperatorUser(user.id, r); toast({ message: 'User suspended' }); await load(query.trim(), status, tenantFilter, offset) }} />
                )}
                <ReasonAction label="Password reset" onConfirm={async (r) => { await sendUserPasswordReset(user.id, r); toast({ message: 'Reset email sent' }) }} />
                <ReasonAction label="Revoke sessions" destructive onConfirm={async (r) => { await revokeUserSessions(user.id, r); toast({ message: 'All sessions revoked — user must sign in again' }) }} />
              </div>
            </GlassCard>
          ))}
          {users.length === 0 && <p className="text-sm text-ink-tertiary">No users match this filter.</p>}
        </div>
      )}
      <Pager total={total} limit={PAGE_SIZE} offset={offset} onPage={setOffset} loading={loading} />
    </div>
  )
}
