'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import type { DomainView } from '@/lib/api'
import { DICTATION_TIP } from './domain-copy'

export const inputCls =
  'mt-1 w-full min-h-[48px] rounded-xl border border-haze bg-surface-1 px-3 text-ink-primary focus:outline-none focus:ring-2 focus:ring-family-500'
export const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'
export const ghostBtn =
  'inline-flex min-h-[48px] items-center gap-2 rounded-full border border-haze px-4 text-base font-medium text-ink-primary'

type Rec = DomainView['pack']['records'][number]

/** The inputs for one record type, shared by adding and editing. */
export function RecordFields({
  rec,
  view,
  values,
  setValues,
  idPrefix,
}: {
  rec: Rec
  view: DomainView
  values: Record<string, string>
  setValues: (v: Record<string, string>) => void
  idPrefix: string
}) {
  return (
    <>
      {rec.fields.map((f) => (
        <div key={f.key}>
          <label
            htmlFor={`${idPrefix}-${f.key}`}
            className="block text-sm font-medium text-ink-primary"
          >
            {f.label} (optional)
          </label>
          {f.kind === 'choice' || f.kind === 'member' ? (
            <select
              id={`${idPrefix}-${f.key}`}
              className={inputCls}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            >
              <option value="">Not stated</option>
              {(f.kind === 'member'
                ? view.roster.map((m) => ({ v: m.id, l: m.name }))
                : (f.choices ?? []).map((c) => ({ v: c, l: c.replace(/_/g, ' ') }))
              ).map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${idPrefix}-${f.key}`}
              type={f.kind === 'date' ? 'date' : 'text'}
              autoComplete="off"
              autoCapitalize={f.kind === 'text' ? 'sentences' : 'none'}
              enterKeyHint="next"
              className={inputCls}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            />
          )}
        </div>
      ))}
    </>
  )
}

/** One form drawn from a pack's store-backed record type. */
export function AddRecordForm({
  view,
  busy,
  onAdd,
}: {
  view: DomainView
  busy: boolean
  onAdd: (record: string, holder: string | null, values: Record<string, string>) => Promise<boolean>
}) {
  const stores = view.pack.records.filter((r) => r.source.kind === 'store')
  const [open, setOpen] = useState(false)
  const [recKey, setRecKey] = useState(stores[0]?.key ?? '')
  const [holder, setHolder] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const rec = stores.find((r) => r.key === recKey)
  if (!view.can_edit || !rec) return null

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${ghostBtn} mt-6`}>
        <Plus size={16} aria-hidden="true" /> Add a {rec.label.toLowerCase()}
      </button>
    )

  return (
    <GlassCard className="mt-6 space-y-4 p-5">
      <h2 className="font-medium text-ink-primary">Add a {rec.label.toLowerCase()}</h2>
      {rec.fields.some((f) => f.kind === 'text') && (
        <p className="text-sm text-ink-secondary">{DICTATION_TIP}</p>
      )}
      {rec.person_attribution === 'holder' && (
        <div>
          <label htmlFor="d-holder" className="block text-sm font-medium text-ink-primary">
            Whose is it? (optional)
          </label>
          <select
            id="d-holder"
            className={inputCls}
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
          >
            <option value="">Not stated</option>
            {view.roster.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <RecordFields rec={rec} view={view} values={values} setValues={setValues} idPrefix="d" />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || Object.values(values).every((v) => !v.trim())}
          className={primaryBtn}
          onClick={async () => {
            const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
            if (await onAdd(rec.key, holder || null, clean)) {
              setValues({})
              setHolder('')
              setRecKey(stores[0]!.key)
              setOpen(false)
            }
          }}
        >
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className={ghostBtn}>
          Cancel
        </button>
      </div>
    </GlassCard>
  )
}
