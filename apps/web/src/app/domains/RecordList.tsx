'use client'

import { Trash2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import type { DomainView } from '@/lib/api'

/** Every record a pack holds, grouped by record type, for packs with no matrix. */
export function RecordList({
  view,
  onRemove,
}: {
  view: DomainView
  onRemove: (rowId: string) => void
}) {
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
                    {removable && (
                      <button
                        type="button"
                        onClick={() => onRemove(r.id)}
                        aria-label={`Remove ${rec.label}`}
                        className="inline-flex min-h-[40px] items-center rounded-full border border-haze px-3"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </GlassCard>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
