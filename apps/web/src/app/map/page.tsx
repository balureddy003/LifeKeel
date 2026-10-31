'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { GlassCard, PageHeader, Skeleton } from '@/components/Glass'
import {
  confirmObligation,
  createObligation,
  deleteObligation,
  getObligationsMap,
  updateObligation,
  type Obligation,
  type ObligationsMap,
} from '@/lib/api'
import { haptic } from '@/lib/haptics'
import { useToast } from '@/components/Toast'
import {
  buildObligationInput,
  groupByPerson,
  validateMapForm,
  type MapFormValues,
} from './map-form'

const inputCls =
  'mt-1 w-full min-h-[48px] rounded-xl border border-haze bg-surface-1 px-3 text-ink-primary placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-family-500'
const labelCls = 'block text-sm font-medium text-ink-primary'
const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'
const ghostBtn =
  'inline-flex min-h-[40px] items-center gap-2 rounded-full border border-haze px-4 text-sm font-medium text-ink-primary'

const due = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

const EMPTY: MapFormValues = {
  label: '',
  named_person: '',
  pays_from: '',
  notices_to: '',
  next_due_date: '',
  recurrence: '',
  if_unavailable: '',
}

export default function ObligationsMapPage() {
  const [data, setData] = useState<ObligationsMap | null>(null)
  const [f, setF] = useState<MapFormValues>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formOpen, setFormOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    void getObligationsMap().then(setData)
  }, [])

  function startEdit(o: Obligation) {
    setEditing(o.id)
    setFormOpen(true)
    setErrors({})
    setF({
      label: o.label,
      named_person: o.named_person,
      pays_from: o.pays_from ?? '',
      notices_to: o.notices_to ?? '',
      next_due_date: o.next_due_date,
      recurrence: o.recurrence ?? '',
      if_unavailable: o.if_unavailable ?? '',
    })
  }

  async function save() {
    const found = validateMapForm(f)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    const res = editing
      ? await updateObligation(editing, buildObligationInput(f))
      : await createObligation(buildObligationInput(f))
    setBusy(false)
    if (!res.ok) {
      toast({
        message:
          (res.data as { error?: string } | undefined)?.error ?? 'Could not save. Try again.',
        variant: 'error',
      })
      return
    }
    haptic('success')
    setF(EMPTY)
    setEditing(null)
    setFormOpen(false)
    setData(await getObligationsMap())
  }

  async function confirm(o: Obligation) {
    const res = await confirmObligation(o.id)
    if (!res.ok) {
      toast({
        message:
          (res.data as { error?: string } | undefined)?.error ?? 'Could not confirm. Try again.',
        variant: 'error',
      })
      return
    }
    haptic('success')
    toast({ message: 'Confirmed' })
    setData(await getObligationsMap())
  }

  async function remove(o: Obligation) {
    const res = await deleteObligation(o.id)
    if (!res.ok) {
      toast({
        message:
          (res.data as { error?: string } | undefined)?.error ?? 'Could not remove. Try again.',
        variant: 'error',
      })
      return
    }
    haptic('warning')
    setData(await getObligationsMap())
  }

  const groups = data ? groupByPerson(data.obligations) : new Map<string, Obligation[]>()
  const s = data?.summary
  const canEdit = data?.can_edit !== false

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <PageHeader
        title="What stops if one of you is out"
        subtitle="One row per recurring thing: who it depends on and when it is next due."
      />

      {!data && (
        <div className="mt-6 space-y-3" role="status" aria-label="Loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {data && (
        <>
          <GlassCard className="mt-6 p-5">
            {s!.dependent_count === 0 ? (
              <p className="text-ink-secondary">
                {canEdit
                  ? 'Nothing entered yet. Add the first recurring bill, policy or account below.'
                  : 'Nothing entered yet. A household editor can add the first recurring bill, policy or account.'}
              </p>
            ) : (
              <p className="text-lg font-medium text-ink-primary">
                {s!.top_person && s!.top_person_count
                  ? `${s!.top_person_count} ${s!.top_person_count === 1 ? 'thing depends' : 'things depend'} on ${s!.top_person}`
                  : `${s!.dependent_count} ${s!.dependent_count === 1 ? 'thing depends' : 'things depend'} on one named person`}
                {s!.earliest_due_date &&
                  ` — the next one, “${s!.earliest_due_label}”, is due ${due(s!.earliest_due_date)}.`}
              </p>
            )}
          </GlassCard>

          {[...groups.entries()].map(([person, rows]) => (
            <section key={person} className="mt-6">
              <h2 className="text-sm font-medium uppercase tracking-wide text-ink-tertiary">
                {person}
              </h2>
              <div className="mt-2 space-y-3">
                {rows.map((o) => (
                  <GlassCard key={o.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-ink-primary">{o.label}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-secondary">
                          <CalendarClock size={14} aria-hidden="true" />
                          Next due {due(o.next_due_date)}
                          {o.recurrence ? ` · ${o.recurrence}` : ''}
                        </p>
                        <p className="mt-1 text-sm text-ink-secondary">
                          {[
                            o.pays_from && `Paid from ${o.pays_from}`,
                            o.notices_to && `Notices to ${o.notices_to}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {o.if_unavailable && (
                          <p className="mt-1 text-sm text-ink-secondary">
                            If out: {o.if_unavailable}
                          </p>
                        )}
                        {o.pending_confirmation && (
                          <p className="mt-1 text-xs text-ink-tertiary">
                            {o.named_person} has not confirmed this yet
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {o.can_confirm && (
                          <button type="button" onClick={() => confirm(o)} className={ghostBtn}>
                            Confirm
                          </button>
                        )}
                        {canEdit && (
                          <button type="button" onClick={() => startEdit(o)} className={ghostBtn}>
                            Edit
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => remove(o)}
                            aria-label={`Remove ${o.label}`}
                            className={ghostBtn}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </section>
          ))}

          {!canEdit ? null : !formOpen ? (
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setF(EMPTY)
                setErrors({})
                setFormOpen(true)
              }}
              className={`${ghostBtn} mt-6`}
            >
              <Plus size={16} aria-hidden="true" /> Add an obligation
            </button>
          ) : (
            <GlassCard className="mt-6 space-y-4 p-5">
              <h2 className="font-medium text-ink-primary">
                {editing ? 'Edit this row' : 'Add an obligation'}
              </h2>
              {(
                [
                  ['label', 'What is it?', 'e.g. Mortgage payment'],
                  ['named_person', 'Who does it depend on?', 'e.g. Sam'],
                  ['pays_from', 'Paid from (optional)', 'e.g. Sam’s card'],
                  ['notices_to', 'Notices go to (optional)', 'e.g. Alex’s phone'],
                  [
                    'if_unavailable',
                    'If they are out (optional)',
                    'e.g. paid from the joint account',
                  ],
                ] as const
              ).map(([k, label, ph]) => (
                <div key={k}>
                  <label htmlFor={`m-${k}`} className={labelCls}>
                    {label}
                  </label>
                  <input
                    id={`m-${k}`}
                    type="text"
                    value={f[k] ?? ''}
                    onChange={(e) => setF({ ...f, [k]: e.target.value })}
                    placeholder={ph}
                    className={inputCls}
                  />
                  {errors[k] && (
                    <p role="alert" className="mt-1 text-sm text-red-500">
                      {errors[k]}
                    </p>
                  )}
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="m-next_due_date" className={labelCls}>
                    Next due date
                  </label>
                  <input
                    id="m-next_due_date"
                    type="date"
                    value={f['next_due_date'] ?? ''}
                    onChange={(e) => setF({ ...f, next_due_date: e.target.value })}
                    className={inputCls}
                  />
                  {errors['next_due_date'] && (
                    <p role="alert" className="mt-1 text-sm text-red-500">
                      {errors['next_due_date']}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="m-recurrence" className={labelCls}>
                    Repeats
                  </label>
                  <select
                    id="m-recurrence"
                    value={f['recurrence'] ?? ''}
                    onChange={(e) => setF({ ...f, recurrence: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Choose</option>
                    {(['monthly', 'quarterly', 'annual', 'one-off'] as const).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={save} disabled={busy} className={primaryBtn}>
                  {busy ? 'Saving…' : editing ? 'Save' : 'Add it'}
                </button>
                <button type="button" onClick={() => setFormOpen(false)} className={ghostBtn}>
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
