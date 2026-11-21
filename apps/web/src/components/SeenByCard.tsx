'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { confirmDomain, getDomains, getDomainView } from '@/lib/api'
import { seenStatus, type SeenInput, type SeenRow } from '@/lib/seen-status'
import { haptic } from '@/lib/haptics'

/**
 * Home, at a glance: has each adult looked at the shared list, and when.
 * One row per list that has something on file; every list the API reports
 * appears here, so a new service needs no edit. The viewer confirms in one
 * tap on the row; the other adult's date shows as soon as they have.
 */
export function SeenByCard() {
  const [lists, setLists] = useState<SeenInput[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const { domains } = await getDomains()
        const views = await Promise.all(
          domains.map(async (d) => {
            const v = await getDomainView(d.id)
            return v
              ? ({
                  id: d.id,
                  title: d.title,
                  records: v.rows.length,
                  result_version: v.result_version,
                  confirmation: v.confirmation,
                } satisfies SeenInput)
              : null
          }),
        )
        if (live) setLists(views.filter((v): v is SeenInput => v !== null))
      } catch {
        if (live) setLists([])
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const rows = seenStatus(lists ?? [])
  if (rows.length === 0) return null

  async function confirm(row: SeenRow) {
    setBusy(row.id)
    setFailed(null)
    haptic('light')
    try {
      const res = await confirmDomain(row.id, row.resultVersion)
      const v = res.data
      if (!res.ok || !v?.confirmation) {
        setFailed(row.id)
        return
      }
      setLists((prev) =>
        (prev ?? []).map((l) =>
          l.id === row.id
            ? { ...l, result_version: v.result_version, confirmation: v.confirmation }
            : l,
        ),
      )
    } catch {
      setFailed(row.id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Who has looked" className="space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">
        Who has looked
      </h2>
      <GlassCard className="p-0 divide-y divide-white/10">
        {rows.map((row) => (
          <div key={row.id} data-testid={`seen-${row.id}`}>
            <Link href={row.href} className="flex min-h-[48px] items-center gap-3 px-4 py-3">
              {row.state === 'all' ? (
                <CheckCircle2 size={20} className="flex-shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Clock size={20} className="flex-shrink-0 text-ink-tertiary" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink-primary">{row.title}</div>
                <div className="text-xs text-ink-tertiary">{row.line}</div>
              </div>
              <ChevronRight
                size={18}
                className="flex-shrink-0 text-ink-tertiary"
                aria-hidden="true"
              />
            </Link>
            {row.canConfirm && (
              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => confirm(row)}
                  disabled={busy === row.id}
                  className="min-h-[48px] w-full rounded-xl bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy === row.id ? 'Saving…' : "I've seen this"}
                </button>
                {failed === row.id && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    That did not save. Open the list to check it, then try again.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </GlassCard>
    </section>
  )
}
