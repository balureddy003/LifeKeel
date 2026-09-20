'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { fetchOperatorUsers, suspendOperatorUser, reactivateOperatorUser, sendUserPasswordReset, revokeUserSessions, type OperatorUser } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

export default function OperatorUsersPage() {
  const toast = useToast()
  const [users, setUsers] = useState<OperatorUser[]>([])
  const [query, setQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load(value = '') {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchOperatorUsers(value)
      setUsers(result.users)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load users')
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
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Cross-tenant account visibility. Sensitive credentials are never returned.</p>
      <form onSubmit={search} className="mt-5 flex gap-2">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, name, user or tenant ID" className="glass-input min-w-0 flex-1 rounded-xl px-4 py-3 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-white" aria-label="Search users"><Search size={18} /></button>
      </form>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {loading ? <div className="shimmer mt-5 h-32 rounded-2xl" /> : (
        <div className="mt-5 space-y-3">
          <p className="text-xs text-ink-tertiary">{total} users</p>
          {users.map((user) => (
            <GlassCard key={user.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><div className="font-medium">{user.name}</div><div className="text-sm text-ink-secondary">{user.email}</div></div>
                <div className="flex gap-2">
                  {user.attribution?.utm_source && (
                    <span className="rounded-full border border-family-500/25 px-2 py-0.5 text-xs text-family-400">{user.attribution.utm_source}</span>
                  )}
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${user.status === 'suspended' ? 'border-danger/25 text-danger' : 'border-success/25 text-success'}`}>{user.status ?? 'active'}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-tertiary"><span>Tenant: {user.tenant_id}</span><span>Roles: {user.roles.join(', ')}</span><span>Joined: {new Date(user.created_at).toLocaleDateString()}</span></div>
              <div className="mt-3 flex flex-wrap gap-2">
                {user.status === 'suspended' ? (
                  <ReasonAction label="Reactivate" onConfirm={async (r) => { await reactivateOperatorUser(user.id, r); toast({ message: 'User reactivated' }); await load(query.trim()) }} />
                ) : (
                  <ReasonAction label="Suspend" destructive onConfirm={async (r) => { await suspendOperatorUser(user.id, r); toast({ message: 'User suspended' }); await load(query.trim()) }} />
                )}
                <ReasonAction label="Password reset" onConfirm={async (r) => { await sendUserPasswordReset(user.id, r); toast({ message: 'Reset email sent' }) }} />
                <ReasonAction label="Revoke sessions" destructive onConfirm={async (r) => { await revokeUserSessions(user.id, r); toast({ message: 'All sessions revoked — user must sign in again' }) }} />
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}
