'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Keyset-cursor pager for operator list pages. The cursor stack lives in
 *  the page (one entry per visited page, current on top); Prev pops, Next
 *  pushes the last `next_cursor`. Unlike offset paging this never scans
 *  skipped rows server-side — constant work at any depth. `total` only
 *  exists on the first page, where the backend still runs the count. */
export function Pager({ page, count, total, hasNext, onPrev, onNext, loading }: {
  page: number
  count: number
  total?: number | undefined
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  loading?: boolean
}) {
  if (page === 0 && count === 0) return null
  const hasPrev = page > 0
  const summary = total !== undefined
    ? `Page ${page + 1} · ${total.toLocaleString()} total`
    : `Page ${page + 1} · ${count} shown`
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-ink-tertiary">
      <span>{summary}</span>
      <div className="flex gap-2">
        <button
          disabled={!hasPrev || loading}
          onClick={onPrev}
          className="flex items-center gap-1 rounded-lg border border-tint/[0.08] px-3 py-1.5 disabled:opacity-40"
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <button
          disabled={!hasNext || loading}
          onClick={onNext}
          className="flex items-center gap-1 rounded-lg border border-tint/[0.08] px-3 py-1.5 disabled:opacity-40"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
