'use client'

import { FormEvent, useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { fetchOperatorAudit, type OperatorAuditEntry } from '@/lib/api'

export default function OperatorAuditPage() {
  const [entries, setEntries] = useState<OperatorAuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [action, setAction] = useState('')
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load(filter: { action?: string | undefined; target_id?: string | undefined } = {}) {
    try {
      const data = await fetchOperatorAudit(filter)
      setEntries(data.entries)
      setTotal(data.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit trail')
    }
  }
  useEffect(() => { void load() }, [])

  function search(e: FormEvent) {
    e.preventDefault()
    void load({ action: action || undefined, target_id: targetId || undefined })
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Operator audit</h1>
      <p className="mt-1 text-sm text-ink-tertiary">Every privileged action, with actor, reason, and request context.</p>
      <form onSubmit={search} className="mt-4 flex flex-wrap gap-2">
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action (e.g. operator.user.suspend)" className="glass-input rounded-xl px-3 py-2 text-sm" />
        <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Target ID" className="glass-input rounded-xl px-3 py-2 text-sm" />
        <button className="rounded-xl bg-family-500 px-4 text-sm text-white">Filter</button>
      </form>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <p className="mt-4 text-xs text-ink-tertiary">{total} entries</p>
      <div className="mt-3 space-y-2">
        {entries.map((e, i) => (
          <GlassCard key={`${e.request_id}-${i}`} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ScrollText size={15} className="text-family-400" />
                <span className="text-sm font-medium">{e.action}</span>
              </div>
              <span className="text-xs text-ink-tertiary">{new Date(e.created_at).toLocaleString()}</span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-ink-secondary sm:grid-cols-2">
              <span>Operator: {e.operator_user_id} ({e.operator_roles.join(', ')})</span>
              <span>Target: {e.target_type} · {e.target_id}</span>
            </div>
            <p className="mt-2 rounded-lg bg-tint/[0.04] px-3 py-2 text-xs text-ink-secondary">“{e.reason}”</p>
          </GlassCard>
        ))}
        {entries.length === 0 && !error && <p className="text-sm text-ink-tertiary">No audit entries yet.</p>}
      </div>
    </div>
  )
}
