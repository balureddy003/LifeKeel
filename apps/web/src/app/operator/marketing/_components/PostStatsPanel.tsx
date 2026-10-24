'use client'

/**
 * Per-post attribution (PRD-218): the last 8 weeks of posts with the visits
 * and signups each one's tagged link earned, plus a group-by read (format /
 * hook / pillar / channel / hour bucket) so "which kind of post works" is a
 * glance, not a query. Groups under 5 posts show "not enough data" — a rank
 * on three visits is a lie.
 */

import { useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { fetchPostStats, type PostStatsView } from '@/lib/api'

const DIMENSIONS = [
  ['format', 'Format'],
  ['hook', 'Hook'],
  ['pillar', 'Pillar'],
  ['channel', 'Channel'],
  ['hour_bucket', 'Hour'],
] as const

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const pct = (x: { low: number; high: number } | null) =>
  x ? `${(x.low * 100).toFixed(1)}–${(x.high * 100).toFixed(1)}%` : '—'
const ivl = (x: { low: number; high: number } | null) =>
  x ? `${x.low.toFixed(1)}–${x.high.toFixed(1)}` : '—'
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'

export function PostStatsPanel() {
  const [data, setData] = useState<PostStatsView | null>(null)
  const [dim, setDim] = useState<(typeof DIMENSIONS)[number][0]>('format')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetchPostStats(8)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Could not load post stats'))
  }, [])

  if (err)
    return (
      <GlassCard className="p-4">
        <p role="alert" className="text-sm text-danger">
          {err}
        </p>
      </GlassCard>
    )
  if (!data) return <div className="shimmer h-24 rounded-2xl" />
  if (data.rows.length === 0)
    return (
      <GlassCard className="p-4">
        <p className="text-sm text-ink-secondary">
          No posts in the last 8 weeks. Once the plan runs, each post shows the visits and signups
          its tagged link earned.
        </p>
      </GlassCard>
    )

  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <h3 className="text-sm font-semibold text-ink-primary mb-2">Posts, last 8 weeks</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-tertiary">
                <th className="py-1 pr-2 font-medium">When</th>
                <th className="py-1 pr-2 font-medium">Channel</th>
                <th className="py-1 pr-2 font-medium">Format</th>
                <th className="py-1 pr-2 font-medium">Hook</th>
                <th className="py-1 pr-2 font-medium">Pillar</th>
                <th className="py-1 pr-2 font-medium text-right">Visits</th>
                <th className="py-1 pr-2 font-medium text-right">Signups</th>
                <th className="py-1 font-medium text-right">Engagement</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-tint/[0.06]">
                  <td className="py-1.5 pr-2 text-ink-secondary whitespace-nowrap">
                    {when(r.posted_at)}
                    {r.variant_of && (
                      <span
                        title="Hook variant — same brief, different hook"
                        className="ml-1 rounded-full bg-family-500/15 px-1.5 text-[10px] text-family-400"
                      >
                        A/B
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">{r.channel}</td>
                  <td className="py-1.5 pr-2">
                    {r.format ? (
                      <span className="rounded-full border border-family-500/25 px-1.5 py-0.5 text-[10px] text-family-400">
                        {r.format}
                      </span>
                    ) : (
                      <span className="text-ink-tertiary">{r.tagged ? '—' : 'untagged'}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {r.hook ? (
                      <span className="rounded-full border border-tint/15 px-1.5 py-0.5 text-[10px] text-ink-tertiary">
                        {r.hook}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-1.5 pr-2">{r.pillar ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.visits}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{r.signups}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-tertiary">
                    {r.engagement.likes + r.engagement.reposts + r.engagement.replies}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-xs font-semibold text-ink-secondary mr-1">Group by</span>
          {DIMENSIONS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDim(key)}
              aria-pressed={dim === key}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                dim === key
                  ? 'bg-family-500/20 text-family-300'
                  : 'bg-tint/[0.04] text-ink-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-ink-tertiary">
                <th className="py-1 pr-2 font-medium">Group</th>
                <th className="py-1 pr-2 font-medium text-right">Posts</th>
                <th className="py-1 pr-2 font-medium text-right">Visits</th>
                <th className="py-1 pr-2 font-medium text-right">Signups</th>
                <th className="py-1 pr-2 font-medium text-right">Visits/post</th>
                <th className="py-1 font-medium text-right">Signup rate</th>
              </tr>
            </thead>
            <tbody>
              {(data.groups[dim] ?? []).map((g) => (
                <tr key={g.key ?? 'none'} className="border-t border-tint/[0.06]">
                  <td className="py-1.5 pr-2">{g.key ?? 'none'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{g.posts}</td>
                  {g.insufficient ? (
                    <td colSpan={4} className="py-1.5 text-ink-tertiary">
                      not enough data
                    </td>
                  ) : (
                    <>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{g.visits}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{g.signups}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {fmt(g.visits_per_post)}{' '}
                        <span className="text-ink-tertiary">
                          ({ivl(g.visits_per_post_interval)})
                        </span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {pct(g.signup_rate_interval)}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-tertiary mt-2">
          Groups need at least 5 tagged posts before they rank. Pre-tag posts appear above but never
          in groups.
        </p>
      </GlassCard>
    </div>
  )
}
