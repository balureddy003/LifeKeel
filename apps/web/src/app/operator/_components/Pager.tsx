'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Server-side pagination footer for operator list pages. Keeps the DOM to
 *  one page of results so the console stays usable at thousands of rows. */
export function Pager({ total, limit, offset, onPage, loading }: {
  total: number
  limit: number
  offset: number
  onPage: (offset: number) => void
  loading?: boolean
}) {
  if (total === 0) return null
  const from = offset + 1
  const to = Math.min(offset + limit, total)
  const hasPrev = offset > 0
  const hasNext = offset + limit < total
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-ink-tertiary">
      <span>Showing {from}–{to} of {total.toLocaleString()}</span>
      <div className="flex gap-2">
        <button
          disabled={!hasPrev || loading}
          onClick={() => onPage(Math.max(0, offset - limit))}
          className="flex items-center gap-1 rounded-lg border border-tint/[0.08] px-3 py-1.5 disabled:opacity-40"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <button
          disabled={!hasNext || loading}
          onClick={() => onPage(offset + limit)}
          className="flex items-center gap-1 rounded-lg border border-tint/[0.08] px-3 py-1.5 disabled:opacity-40"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
