'use client'

/**
 * Month grid of scheduled and published posts — the Buffer-style calendar
 * view. Days show a status dot per post; tapping a day lists its posts.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import type { MarketingPost } from '@/lib/api'

const DOT: Record<MarketingPost['state'], string> = {
  draft: 'bg-warning',
  approved: 'bg-family-400',
  awaiting_manual: 'bg-family-400',
  published: 'bg-success',
  publish_failed: 'bg-danger',
  rejected: 'bg-tint/20',
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function PostCalendar({ posts }: { posts: MarketingPost[] }) {
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState<string | null>(null)

  const byDay = useMemo(() => {
    const map = new Map<string, MarketingPost[]>()
    for (const p of posts) {
      const when = p.state === 'published' ? p.published_at : p.scheduled_at
      if (!when) continue
      const key = dayKey(new Date(when))
      map.set(key, [...(map.get(key) ?? []), p])
    }
    return map
  }, [posts])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  // Monday-first: getDay() returns 0=Sun → shift to 0=Mon.
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => dayKey(new Date(year, month, i + 1))),
  ]

  const selectedPosts = selected ? (byDay.get(selected) ?? []) : []

  return (
    <div>
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-ink-primary">
            {cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setCursor(new Date(year, month - 1, 1))}
              className="w-8 h-8 rounded-lg bg-tint/[0.04] border border-tint/[0.08] flex items-center justify-center text-ink-secondary"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={() => setCursor(new Date(year, month + 1, 1))}
              className="w-8 h-8 rounded-lg bg-tint/[0.04] border border-tint/[0.08] flex items-center justify-center text-ink-secondary"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-caption text-ink-tertiary py-1">
              {d}
            </div>
          ))}
          {cells.map((key, i) =>
            key === null ? (
              <div key={`e${i}`} />
            ) : (
              <button
                key={key}
                onClick={() => setSelected(selected === key ? null : key)}
                className={`rounded-lg py-1.5 flex flex-col items-center gap-0.5 border ${
                  selected === key
                    ? 'border-family-500/40 bg-family-500/10'
                    : 'border-transparent hover:bg-tint/[0.04]'
                }`}
              >
                <span
                  className={`text-xs ${key === dayKey(new Date()) ? 'font-bold text-family-400' : 'text-ink-secondary'}`}
                >
                  {Number(key.slice(8))}
                </span>
                <span className="flex gap-0.5 h-1.5">
                  {(byDay.get(key) ?? []).slice(0, 4).map((p) => (
                    <span key={p.id} className={`w-1.5 h-1.5 rounded-full ${DOT[p.state]}`} />
                  ))}
                </span>
              </button>
            ),
          )}
        </div>
      </GlassCard>

      {selected && (
        <div className="mt-3 space-y-2">
          {selectedPosts.length === 0 && (
            <GlassCard className="p-4">
              <p className="text-sm text-ink-tertiary">
                Nothing scheduled or published on{' '}
                {new Date(`${selected}T12:00`).toLocaleDateString()}.
              </p>
            </GlassCard>
          )}
          {selectedPosts.map((p) => (
            <GlassCard key={p.id} className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2 h-2 rounded-full ${DOT[p.state]}`} />
                <span className="text-caption font-semibold text-ink-secondary uppercase">
                  {p.state.replace('_', ' ')}
                </span>
                <span className="text-caption text-ink-tertiary">{p.channel}</span>
                <span className="text-caption text-ink-tertiary ml-auto">
                  {new Date(
                    (p.state === 'published' ? p.published_at : p.scheduled_at)!,
                  ).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-xs text-ink-secondary leading-relaxed line-clamp-2">{p.content}</p>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  )
}
