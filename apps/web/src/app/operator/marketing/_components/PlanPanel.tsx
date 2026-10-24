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
  refineMarketingPost,
  skipPlanItem,
  updateMarketingPost,
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
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'

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
    setPicked(
      new Set(
        d.items
          .flatMap((i) => (i.status === 'planned' ? i.posts : []))
          .filter((p) => canApprove(p))
          .map((p) => p.id),
      ),
    )
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

  const allPosts = useMemo(
    () => (data?.items ?? []).filter((i) => i.status === 'planned').flatMap((i) => i.posts),
    [data],
  )
  const chosen = allPosts.filter((p) => picked.has(p.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          aria-label="Previous week"
          onClick={() => setWeek(shift(week, -1))}
          className="p-2 rounded-lg bg-tint/[0.04]"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-sm font-semibold text-ink-primary">Week of {week}</div>
        <button
          aria-label="Next week"
          onClick={() => setWeek(shift(week, 1))}
          className="p-2 rounded-lg bg-tint/[0.04]"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {!data && <div className="shimmer h-24 rounded-2xl" />}

      {data?.skipped_channels && data.skipped_channels.length > 0 && (
        <GlassCard className="p-3">
          <p role="status" className="text-xs text-warning">
            Left out of this plan:{' '}
            {data.skipped_channels.map((s) => `${s.channel} (${s.reason})`).join('; ')}. Reconnect
            in the Connections tab.
          </p>
        </GlassCard>
      )}

      {data && data.items.length === 0 && (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-secondary mb-3">
            Nothing planned for this week. Generating drafts three posts, one for each of Monday,
            Wednesday and Friday, with a draft per connected network (
            {data.available_channels.join(', ') || 'none connected yet'}). Nothing is published.
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
            {item.status === 'skipped' && (
              <span className="text-xs text-ink-tertiary">Skipped</span>
            )}
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
                  {(p.format || p.hook) && (
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      {p.format && (
                        <span className="rounded-full border border-family-500/25 px-1.5 py-0.5 text-[10px] text-family-400">
                          {p.format}
                        </span>
                      )}
                      {p.hook && (
                        <span className="rounded-full border border-tint/15 px-1.5 py-0.5 text-[10px] text-ink-tertiary">
                          {p.hook}
                        </span>
                      )}
                    </span>
                  )}
                  {p.media_url && (
                    // Signed card preview (PRD-219) — the same URL the platform will fetch.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.media_url}
                      alt={p.alt_text ?? 'Card preview'}
                      className="mt-1 h-20 rounded-lg border border-tint/[0.08]"
                    />
                  )}
                  <span className="block text-sm text-ink-primary whitespace-pre-wrap">
                    {p.content}
                  </span>
                  {p.state === 'draft' && (
                    <RefineField
                      onRefine={async (instruction) => {
                        await refineMarketingPost(p.id, instruction)
                        await load()
                      }}
                    />
                  )}
                  {p.needs_image && (
                    <ImageField
                      postId={p.id}
                      disabled={busy !== null}
                      onSaved={() => run('image', async () => {}, 'Image attached')}
                      attach={(url) => updateMarketingPost(p.id, { media_url: url })}
                    />
                  )}
                  {!p.copy_check.ok && (
                    <span role="alert" className="block text-xs text-danger mt-1">
                      Fails the copy guard:{' '}
                      {p.copy_check.violations.map((v) => `${v.rule} ("${v.match}")`).join('; ')}.
                      Edit it in the Queue tab.
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
            Approving schedules {chosen.length} of {allPosts.length} drafts to go out at their
            times. You are approving the text shown above. To change a draft, edit it in the Queue
            tab, then come back and review again.
          </p>
          <button
            onClick={() =>
              run(
                'approve',
                async () => {
                  const r = await approvePlanPosts(
                    chosen.map((p) => ({ post_id: p.id, content_hash: p.content_hash })),
                  )
                  if (r.refused > 0)
                    throw new Error(
                      `${r.approved} approved, ${r.refused} refused: ${r.results.find((x) => !x.ok)?.error ?? ''}`,
                    )
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
  return p.copy_check.ok && !p.needs_image && (p.state === 'draft' || p.state === 'publish_failed')
}

/** Instagram cannot post text alone: the draft stays unapprovable until it has an image. */
/** LLM-assisted draft edit — operator types an instruction, the API rewrites
 *  the draft and re-runs the copy guard (PRD-219). */
function RefineField({ onRefine }: { onRefine: (instruction: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <span className="block mt-1">
      <span className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Refine: shorter, one question, add urgency-free hook…"
          aria-label="Refine this draft with an instruction"
          className="glass-input flex-1 rounded-lg px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={busy || text.trim().length < 3}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await onRefine(text.trim())
              setText('')
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Refine failed')
            } finally {
              setBusy(false)
            }
          }}
          className="rounded-lg px-2 py-1 text-xs font-semibold bg-tint/[0.08] text-ink-secondary disabled:opacity-40"
        >
          {busy ? '…' : 'Refine'}
        </button>
      </span>
      {err && <span className="block text-xs text-danger mt-1">{err}</span>}
    </span>
  )
}

function ImageField({
  postId,
  disabled,
  attach,
  onSaved,
}: {
  postId: string
  disabled: boolean
  attach: (url: string) => Promise<unknown>
  onSaved: () => void
}) {
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const valid = /^https:\/\/\S+$/.test(url.trim())
  return (
    <span className="block mt-1">
      <span className="block text-xs text-warning">
        Instagram needs an image before this can be approved.
      </span>
      <span className="flex gap-2 mt-1">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… image URL"
          aria-label={`Image URL for post ${postId}`}
          className="glass-input flex-1 rounded-lg px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={disabled || !valid}
          onClick={async () => {
            setErr(null)
            try {
              await attach(url.trim())
              onSaved()
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Could not attach the image')
            }
          }}
          className="rounded-lg px-2.5 py-1 text-xs font-semibold bg-family-500/15 text-family-400 disabled:opacity-40"
        >
          Attach image
        </button>
      </span>
      {err && (
        <span role="alert" className="block text-xs text-danger mt-1">
          {err}
        </span>
      )}
    </span>
  )
}
