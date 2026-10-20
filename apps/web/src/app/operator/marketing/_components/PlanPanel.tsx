'use client'

/**
 * The weekly content plan (PRD-210, phase 3): three items a week, each with a draft per network.
 * The reviewer reads the drafts here and approves the week in one action; each post is approved
 * by the hash of the exact text on screen, and anything that fails the copy guard cannot be
 * selected. Approving schedules; the publisher sends at each post's time.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  approvePlanPosts,
  fetchPlanWeek,
  generatePlanWeek,
  skipPlanItem,
  type PlanPostView,
  type PlanWeekView,
} from '@/lib/api'

const PILLAR_LABEL: Record<string, string> = {
  chart: 'The chart',
  hard_day: 'A hard day',
  cover_on_file: 'Cover on file',
  your_data: 'Your data',
  guides: 'Guides',
}

function nextMonday(from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7))
  return d.toISOString().slice(0, 10)
}

function shift(week: string, weeks: number): string {
  const d = new Date(`${week}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'

export function PlanPanel() {
  const toast = useToast()
  const [week, setWeek] = useState(nextMonday())
  const [data, setData] = useState<PlanWeekView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const d = await fetchPlanWeek(week)
    setData(d)
    // Everything that can be approved starts ticked; the reviewer unticks what they do not want.
    setPicked(new Set(d.items.flatMap((i) => (i.status === 'planned' ? i.posts : [])).filter((p) => canApprove(p)).map((p) => p.id)))
  }, [week])

  useEffect(() => {
    setData(null)
    load()
  }, [load])

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label)
    try {
      await fn()
      toast({ message: done })
      await load()
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'That did not work', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const allPosts = useMemo(() => (data?.items ?? []).filter((i) => i.status === 'planned').flatMap((i) => i.posts), [data])
  const chosen = allPosts.filter((p) => picked.has(p.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button aria-label="Previous week" onClick={() => setWeek(shift(week, -1))} className="p-2 rounded-lg bg-tint/[0.04]">
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-semibold text-ink-primary">Week of {week}</div>
        <button aria-label="Next week" onClick={() => setWeek(shift(week, 1))} className="p-2 rounded-lg bg-tint/[0.04]">
          <ChevronRight size={16} />
        </button>
      </div>

      {!data && <div className="shimmer h-24 rounded-2xl" />}

      {data && data.items.length === 0 && (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-secondary mb-3">
            Nothing planned for this week. Generating drafts three posts, one for each of Monday, Wednesday and Friday, with a
            draft per connected network ({data.available_channels.join(', ') || 'none connected yet'}). Nothing is published.
          </p>
          <button
            onClick={() => run('generate', () => generatePlanWeek(week), 'Week drafted')}
            disabled={busy !== null || data.available_channels.length === 0}
            className="rounded-xl px-3 py-2 text-sm font-semibold bg-family-500/15 border border-family-500/25 text-family-400 disabled:opacity-40"
          >
            {busy === 'generate' ? 'Drafting…' : 'Draft this week'}
          </button>
        </GlassCard>
      )}

      {data?.items.map((item) => (
        <GlassCard key={item.id} className={`p-4 ${item.status === 'skipped' ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <span className="text-footnote font-semibold uppercase tracking-wide text-family-400">
                {PILLAR_LABEL[item.pillar] ?? item.pillar}
              </span>
              <div className="text-base font-semibold text-ink-primary">{item.title}</div>
              <div className="text-xs text-ink-tertiary">{when(item.scheduled_at)}</div>
            </div>
            {item.status === 'planned' && (
              <button
                onClick={() => run(`skip:${item.id}`, () => skipPlanItem(item.id), 'Item skipped')}
                disabled={busy !== null}
                className="text-xs font-semibold text-ink-secondary px-2 py-1 rounded-lg bg-tint/[0.04] disabled:opacity-40"
              >
                Skip
              </button>
            )}
            {item.status === 'skipped' && <span className="text-xs text-ink-tertiary">Skipped</span>}
          </div>
          {item.posts.map((p) => (
            <div key={p.id} className="border-t border-tint/[0.06] pt-2 mt-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  aria-label={`Approve the ${p.channel} draft for ${item.title}`}
                  checked={picked.has(p.id)}
                  disabled={!canApprove(p) || item.status !== 'planned'}
                  onChange={(e) => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(p.id)
                    else next.delete(p.id)
                    setPicked(next)
                  }}
                />
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-ink-secondary">
                    {p.channel} · {p.state}
                  </span>
                  <span className="block text-sm text-ink-primary whitespace-pre-wrap">{p.content}</span>
                  {!p.copy_check.ok && (
                    <span role="alert" className="block text-xs text-danger mt-1">
                      Fails the copy guard: {p.copy_check.violations.map((v) => `${v.rule} ("${v.match}")`).join('; ')}. Edit it in the Queue tab.
                    </span>
                  )}
                </span>
              </label>
            </div>
          ))}
        </GlassCard>
      ))}

      {data && allPosts.length > 0 && (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-secondary mb-3">
            Approving schedules {chosen.length} of {allPosts.length} drafts to go out at their times. You are approving the text shown above.
            To change a draft, edit it in the Queue tab, then come back and review again.
          </p>
          <button
            onClick={() =>
              run(
                'approve',
                async () => {
                  const r = await approvePlanPosts(chosen.map((p) => ({ post_id: p.id, content_hash: p.content_hash })))
                  if (r.refused > 0) throw new Error(`${r.approved} approved, ${r.refused} refused: ${r.results.find((x) => !x.ok)?.error ?? ''}`)
                },
                `${chosen.length} scheduled`,
              )
            }
            disabled={busy !== null || chosen.length === 0}
            className="w-full rounded-xl py-2.5 text-sm font-semibold bg-family-500 text-white disabled:opacity-40"
          >
            {busy === 'approve' ? 'Approving…' : `Approve ${chosen.length} for the week`}
          </button>
        </GlassCard>
      )}
    </div>
  )
}

function canApprove(p: PlanPostView): boolean {
  return p.copy_check.ok && (p.state === 'draft' || p.state === 'publish_failed')
}
