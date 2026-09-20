'use client'

import { FormEvent, useEffect, useState } from 'react'
import { ShieldCheck, UserPlus } from 'lucide-react'
import { GlassCard, GlassButton } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { createOperator, fetchOperators, suspendOperator, reactivateOperator, type OperatorRecord } from '@/lib/api'
import { ReasonAction } from '../_components/ReasonAction'

const ROLE_CHOICES = ['support', 'marketing_operator', 'finance_operator', 'operations', 'platform_admin', 'super_admin']

export default function OperatorsPage() {
  const toast = useToast()
  const [operators, setOperators] = useState<OperatorRecord[]>([])
  const [bootstrap, setBootstrap] = useState<OperatorRecord[]>([])
  const [userId, setUserId] = useState('')
  const [roles, setRoles] = useState<string[]>(['support'])
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    try {
      const data = await fetchOperators()
      setOperators(data.operators)
      setBootstrap(data.bootstrap)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load operators')
    }
  }
  useEffect(() => { void load() }, [])

  async function add(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await createOperator(userId.trim(), roles, reason.trim())
      toast({ message: 'Operator granted' })
      setUserId(''); setReason('')
      await load()
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Could not add operator', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Operators</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Platform-level access, separate from tenant roles. super_admin only.</p>
      {error && <GlassCard className="mt-4 p-4"><p className="text-sm text-danger">{error}</p></GlassCard>}

      <GlassCard className="mt-5 p-4">
        <h2 className="flex items-center gap-2 font-semibold"><UserPlus size={16} className="text-family-400" /> Grant access</h2>
        <form onSubmit={add} className="mt-3 space-y-3">
          <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Agent Oak user ID" className="glass-input w-full rounded-xl px-3 py-2.5 text-sm" required />
          <div className="flex flex-wrap gap-2">
            {ROLE_CHOICES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoles((r) => r.includes(role) ? r.filter((x) => x !== role) : [...r, role])}
                className={`rounded-full border px-3 py-1 text-xs ${roles.includes(role) ? 'border-family-500/40 bg-family-500/15 text-family-400' : 'border-tint/[0.08] text-ink-tertiary'}`}
              >
                {role}
              </button>
            ))}
          </div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" className="glass-input w-full rounded-xl px-3 py-2.5 text-sm" required minLength={5} />
          <GlassButton disabled={busy || roles.length === 0 || reason.trim().length < 5}>{busy ? 'Granting…' : 'Grant operator access'}</GlassButton>
        </form>
      </GlassCard>

      <div className="mt-6 space-y-3">
        {operators.map((op) => (
          <GlassCard key={op.user_id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{op.user?.name ?? op.user_id}</div>
                <div className="text-sm text-ink-secondary">{op.user?.email ?? ''}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {op.roles.map((r) => <span key={r} className="rounded-full bg-family-500/10 px-2 py-0.5 text-xs text-family-400">{r}</span>)}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`rounded-full border px-2 py-0.5 text-xs ${op.status === 'suspended' ? 'border-danger/25 text-danger' : 'border-success/25 text-success'}`}>{op.status}</span>
                {op.status === 'suspended' ? (
                  <ReasonAction label="Reactivate" onConfirm={async (r) => { await reactivateOperator(op.user_id, r); toast({ message: 'Operator reactivated' }); await load() }} />
                ) : (
                  <ReasonAction label="Suspend" destructive onConfirm={async (r) => { await suspendOperator(op.user_id, r); toast({ message: 'Operator suspended' }); await load() }} />
                )}
              </div>
            </div>
          </GlassCard>
        ))}
        {bootstrap.map((op) => (
          <GlassCard key={`bootstrap-${op.user_id}`} className="p-4 opacity-70">
            <div className="flex items-center gap-2"><ShieldCheck size={15} className="text-family-400" /><span className="font-medium">{op.user?.name ?? op.user_id}</span><span className="text-xs text-ink-tertiary">env bootstrap · super_admin</span></div>
          </GlassCard>
        ))}
        {operators.length === 0 && bootstrap.length === 0 && !error && <p className="text-sm text-ink-tertiary">No operators configured.</p>}
      </div>
    </div>
  )
}
