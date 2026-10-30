'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { GlassCard, PageHeader, Skeleton } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  createEmployerCover,
  deleteEmployerCover,
  listEmployerCover,
  type EmployerCoverFact,
} from '@/lib/api'
import { haptic } from '@/lib/haptics'

const inputCls =
  'mt-1 w-full min-h-[48px] rounded-xl border border-haze bg-surface-1 px-3 text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-family-500'
const labelCls = 'block text-sm font-medium text-ink-primary'
const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'
const ghostBtn =
  'inline-flex min-h-[40px] items-center gap-2 rounded-full border border-haze px-4 text-sm font-medium text-ink-primary'

const TYPE_LABELS: Record<string, string> = {
  death_in_service: 'Death-in-service',
  income_protection: 'Group income protection',
  health_cover: 'Health cover',
  other: 'Other',
}

const EMPTY = {
  member_label: '',
  type: 'death_in_service',
  name_as_printed: '',
  source: '',
  last_seen_at: '',
}

export default function EmployerCoverPage() {
  const [facts, setFacts] = useState<EmployerCoverFact[] | null>(null)
  const [f, setF] = useState(EMPTY)
  const [ends, setEnds] = useState(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void listEmployerCover().then(setFacts)
  }, [])

  async function save() {
    if (!f.member_label.trim() || !f.name_as_printed.trim()) return
    setBusy(true)
    const res = await createEmployerCover({
      member_label: f.member_label.trim(),
      type: f.type,
      name_as_printed: f.name_as_printed.trim(),
      ...(f.source.trim() ? { source: f.source.trim() } : {}),
      ...(f.last_seen_at ? { last_seen_at: f.last_seen_at } : {}),
      ends_with_employment: ends,
      confirmed: true,
    })
    setBusy(false)
    if (!res.ok) {
      toast({ message: 'Could not save. Try again.', variant: 'error' })
      return
    }
    haptic('success')
    setF(EMPTY)
    setOpen(false)
    setFacts(await listEmployerCover())
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <PageHeader
        title="Employer cover on file"
        subtitle="Cover a job provides that the household may not have recorded. It feeds the job-change brief."
      />

      {!facts && <Skeleton className="mt-6 h-24 w-full" />}

      {facts && (
        <>
          {facts.length === 0 ? (
            <GlassCard className="mt-6 p-5">
              <p className="text-ink-secondary">
                Nothing recorded yet. If a job provides cover — death-in-service, income protection,
                health cover — note it here as printed in the letter or portal.
              </p>
            </GlassCard>
          ) : (
            <div className="mt-6 space-y-3">
              {facts.map((c) => (
                <GlassCard key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink-primary">{c.name_as_printed}</p>
                      <p className="mt-1 text-sm text-ink-secondary">
                        {c.member_label} · {TYPE_LABELS[c.type] ?? c.type}
                        {c.source ? ` · ${c.source}` : ''}
                        {c.last_seen_at ? ` · seen ${c.last_seen_at}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-ink-tertiary">
                        {c.ends_with_employment
                          ? 'Recorded as ending with the employment.'
                          : 'No end with the employment recorded.'}
                        {!c.confirmed ? ' Not confirmed yet.' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteEmployerCover(c.id)
                        setFacts(await listEmployerCover())
                      }}
                      aria-label={`Remove ${c.name_as_printed}`}
                      className={ghostBtn}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}

          {!open ? (
            <button type="button" onClick={() => setOpen(true)} className={`${ghostBtn} mt-6`}>
              <Plus size={16} aria-hidden="true" /> Add cover on file
            </button>
          ) : (
            <GlassCard className="mt-6 space-y-4 p-5">
              <h2 className="font-medium text-ink-primary">Add cover on file</h2>
              <div>
                <label htmlFor="c-member" className={labelCls}>
                  Whose job provides it?
                </label>
                <input
                  id="c-member"
                  type="text"
                  value={f.member_label}
                  onChange={(e) => setF({ ...f, member_label: e.target.value })}
                  placeholder="e.g. Sam"
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="c-type" className={labelCls}>
                  Type of cover
                </label>
                <select
                  id="c-type"
                  value={f.type}
                  onChange={(e) => setF({ ...f, type: e.target.value })}
                  className={inputCls}
                >
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="c-name" className={labelCls}>
                  Name as printed
                </label>
                <input
                  id="c-name"
                  type="text"
                  value={f.name_as_printed}
                  onChange={(e) => setF({ ...f, name_as_printed: e.target.value })}
                  placeholder="e.g. Acme Group Life Assurance"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="c-source" className={labelCls}>
                    Source (optional)
                  </label>
                  <input
                    id="c-source"
                    type="text"
                    value={f.source}
                    onChange={(e) => setF({ ...f, source: e.target.value })}
                    placeholder="e.g. HR portal letter"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label htmlFor="c-seen" className={labelCls}>
                    Last seen (optional)
                  </label>
                  <input
                    id="c-seen"
                    type="date"
                    value={f.last_seen_at}
                    onChange={(e) => setF({ ...f, last_seen_at: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-primary">
                <input
                  type="checkbox"
                  checked={ends}
                  onChange={(e) => setEnds(e.target.checked)}
                  className="h-5 w-5"
                />
                Recorded as ending with the employment
              </label>
              <div className="flex gap-3">
                <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
                  {busy ? 'Saving…' : 'Save it'}
                </button>
                <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
                  Cancel
                </button>
              </div>
            </GlassCard>
          )}
        </>
      )}
    </main>
  )
}
