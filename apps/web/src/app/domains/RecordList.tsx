'use client'

import { useRef, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import type { DomainView } from '@/lib/api'
import { RecordFields, ghostBtn, inputCls, primaryBtn } from './AddRecordForm'

/** Every record a pack holds, grouped by record type, for packs with no matrix. */
export function RecordList({
  view,
  busy,
  onRemove,
  onEdit,
}: {
  view: DomainView
  busy: boolean
  onRemove: (rowId: string) => void
  onEdit: (rowId: string, holder: string | null, values: Record<string, string>) => Promise<boolean>
}) {
  const [confirming, setConfirming] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [draftHolder, setDraftHolder] = useState('')
  const removeButtons = useRef<Record<string, HTMLButtonElement | null>>({})
  return (
    <div className="mt-6 space-y-5">
      {view.pack.records.map((rec) => {
        const rows = view.rows.filter((r) => r.record === rec.key)
        if (rows.length === 0) return null
        const removable = view.can_edit && rec.source.kind === 'store'
        return (
          <section key={rec.key}>
            <h2 className="text-sm font-medium uppercase tracking-wide text-ink-tertiary">
              {rec.label}
            </h2>
            <div className="mt-2 space-y-3">
              {rows.map((r) => (
                <GlassCard key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <dl className="min-w-0 space-y-1 text-sm">
                      {rec.fields.map((f) => {
                        const raw = r.values[f.key]
                        if (!raw) return null
                        const shown =
                          f.kind === 'member'
                            ? (view.roster.find((m) => m.id === raw)?.name ?? raw)
                            : raw.replace(/_/g, ' ')
                        return (
                          <div key={f.key} className="flex gap-2">
                            <dt className="text-ink-tertiary">{f.label}</dt>
                            <dd className="break-normal text-ink-primary">{shown}</dd>
                          </div>
                        )
                      })}
                    </dl>
                    <div className="flex shrink-0 gap-2">
                      {removable && editing !== r.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({ ...r.values })
                            setDraftHolder(r.holder_member_id ?? '')
                            setEditing(r.id)
                          }}
                          aria-label={`Edit ${rec.label}`}
                          className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-haze px-3"
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </button>
                      )}
                      {removable && (
                        <button
                          type="button"
                          ref={(el) => {
                            removeButtons.current[r.id] = el
                          }}
                          onClick={() => setConfirming(r.id)}
                          aria-label={`Remove ${rec.label}`}
                          className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full border border-haze px-3"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  {removable && editing === r.id && (
                    <div className="mt-3 space-y-4 border-t border-haze pt-3">
                      {rec.person_attribution === 'holder' && (
                        <div>
                          <label
                            htmlFor={`e-${r.id}-holder`}
                            className="block text-sm font-medium text-ink-primary"
                          >
                            Whose is it? (optional)
                          </label>
                          <select
                            id={`e-${r.id}-holder`}
                            className={inputCls}
                            value={draftHolder}
                            onChange={(e) => setDraftHolder(e.target.value)}
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
                      <RecordFields
                        rec={rec}
                        view={view}
                        values={draft}
                        setValues={setDraft}
                        idPrefix={`e-${r.id}`}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy || Object.values(draft).every((v) => !v.trim())}
                          className={primaryBtn}
                          onClick={async () => {
                            const clean = Object.fromEntries(
                              Object.entries(draft).filter(([, v]) => v.trim()),
                            )
                            if (await onEdit(r.id, draftHolder || null, clean)) setEditing(null)
                          }}
                        >
                          Save changes
                        </button>
                        <button type="button" onClick={() => setEditing(null)} className={ghostBtn}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {removable && confirming === r.id && (
                    <div
                      role="group"
                      aria-label={`Remove this ${rec.label.toLowerCase()}?`}
                      className="mt-3 flex flex-wrap items-center gap-2 border-t border-haze pt-3"
                    >
                      <p className="w-full text-base text-ink-primary">
                        Remove this {rec.label.toLowerCase()} from the list?
                      </p>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => {
                          setConfirming(null)
                          // Back to the button that opened the question.
                          requestAnimationFrame(() => removeButtons.current[r.id]?.focus())
                        }}
                        className="inline-flex min-h-[48px] items-center rounded-full border border-haze px-4 text-base font-medium text-ink-primary"
                      >
                        Keep it
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirming(null)
                          onRemove(r.id)
                        }}
                        className="inline-flex min-h-[48px] items-center rounded-full bg-danger/10 px-4 text-base font-medium text-danger"
                      >
                        Yes, remove
                      </button>
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
