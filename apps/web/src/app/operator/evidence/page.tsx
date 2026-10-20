'use client'

/** PRD-208 evidence register: who owns each public claim and when it must be renewed. */
import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { fetchOperatorEvidence, saveOperatorEvidence, type EvidenceClaim } from '@/lib/api'

const STATE_TEXT: Record<EvidenceClaim['state'], string> = {
  published: 'Published',
  stale: 'Renewal date passed: not shown publicly',
  needs_owner: 'Needs an owner: not shown publicly',
  not_evidenced: 'No evidence yet: never shown',
}

export default function OperatorEvidencePage() {
  const toast = useToast()
  const [claims, setClaims] = useState<EvidenceClaim[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ owner: '', verified_at: '', renew_by: '', reason: '' })

  const load = () =>
    fetchOperatorEvidence()
      .then((d) => setClaims(d.claims))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load the register'))
  useEffect(() => {
    void load()
  }, [])

  if (error) return <GlassCard className="p-5 text-sm text-danger">{error}</GlassCard>
  if (!claims) return <div className="shimmer h-40 rounded-2xl" />

  async function save(id: string) {
    try {
      await saveOperatorEvidence(id, form)
      toast({ message: 'Evidence recorded' })
      setEditing(null)
      await load()
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Could not save', variant: 'error' })
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold text-ink-primary">Evidence register</h1>
      <p className="text-sm text-ink-secondary">
        A claim is public only while it has an owner and its renewal date has not passed.
      </p>
      {claims.map((c) => (
        <GlassCard key={c.id} className="p-4">
          <div className="text-sm text-ink-primary">{c.statement}</div>
          <div
            className={`text-xs mt-1 ${c.state === 'stale' || c.state === 'needs_owner' ? 'text-warning font-medium' : 'text-ink-tertiary'}`}
          >
            {STATE_TEXT[c.state]}
            {c.state === 'not_evidenced' && c.reason ? `. ${c.reason}` : ''}
          </div>
          {c.owner && (
            <div className="text-xs text-ink-tertiary mt-1">
              Owner {c.owner}, verified {c.verified_at?.slice(0, 10)}, renew by{' '}
              {c.renew_by?.slice(0, 10)}
            </div>
          )}
          {c.publishable &&
            (editing === c.id ? (
              <div className="mt-3 grid gap-2 max-w-sm">
                {(['owner', 'verified_at', 'renew_by', 'reason'] as const).map((k) => (
                  <input
                    key={k}
                    aria-label={k}
                    placeholder={
                      k.replace('_', ' ') +
                      (k.endsWith('_at') || k === 'renew_by' ? ' (YYYY-MM-DD)' : '')
                    }
                    value={form[k]}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className="glass-input rounded-lg px-3 py-2 text-sm text-ink-primary"
                  />
                ))}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => save(c.id)}
                    className="rounded-lg bg-family-500/20 border border-family-500/30 px-3 py-1.5 text-xs font-semibold text-family-300"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-lg bg-tint/[0.04] border border-tint/[0.08] px-3 py-1.5 text-xs text-ink-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditing(c.id)
                  setForm({ owner: c.owner ?? '', verified_at: '', renew_by: '', reason: '' })
                }}
                className="mt-2 text-xs font-semibold text-family-400"
              >
                {c.owner ? 'Renew or reassign' : 'Record owner and evidence'}
              </button>
            ))}
        </GlassCard>
      ))}
    </div>
  )
}
