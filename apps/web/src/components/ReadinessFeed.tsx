'use client'

/**
 * "What changed" feed (PRD-136 §6, first placement) — the chronological
 * narration of what Keel's daily checks found: score moves, insight
 * lifecycle, milestones, quiet sweeps. Rendered on the signed-in home
 * page under the readiness sparkline.
 *
 * Every card carries its direction and a plain-language summary; money
 * amounts never reach youth mode (server-side redaction — pass
 * mode="youth").
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BarChart3, Bell, CheckCircle2, TrendingUp, TrendingDown, Clock,
  FileText, Eye, Siren, Sparkles, ChevronDown,
} from 'lucide-react'
import { GlassCard, Skeleton } from '@/components/Glass'
import { fetchFeed, fetchFeedSummary, submitFeedback, type FeedEvent, type FeedFeedbackValue, type FeedSummary } from '@/lib/api'

const TYPE_ICON: Record<FeedEvent['type'], typeof BarChart3> = {
  score_moved: BarChart3,
  insight_opened: Bell,
  insight_repeated: Bell,
  insight_resolved: Bell,
  action_attributed: CheckCircle2,
  scenario_moved: TrendingUp,
  renewal_approaching: Clock,
  document_processed: FileText,
  profile_changed: Eye,
  playbook_steps_pending: Siren,
  milestone: Sparkles,
  sweep_quiet: Eye,
}

function linkFor(link: FeedEvent['links'][number]): string | null {
  switch (link.kind) {
    case 'insight': return `/insights/${link.id}`
    case 'component': return `/health/${link.id}`
    case 'document': return '/documents'
    case 'scenario': return '/events'
    case 'member': return `/member/${link.id}`
    case 'profile_field': return '/financial-profile'
    default: return null
  }
}

export interface ReadinessFeedProps {
  /** Roster the page already loaded — resolves member chips to names. */
  members?: { id: string; name: string }[]
  /** 'youth' requests the server-redacted slice for child mode. */
  mode?: 'youth'
}

export function ReadinessFeed({ members = [], mode }: ReadinessFeedProps) {
  const router = useRouter()
  const [events, setEvents] = useState<FeedEvent[] | null>(null)
  const [summary, setSummary] = useState<FeedSummary | null>(null)
  const [failed, setFailed] = useState(false)
  // Feedback row collapses to a one-line confirmation after a response —
  // 'muted' keeps the undo affordance live until the next fetch.
  const [feedbackDone, setFeedbackDone] = useState<Record<string, 'noted' | 'muted'>>({})

  const sendFeedback = async (evt: FeedEvent, value: FeedFeedbackValue) => {
    if (value === 'data_wrong') {
      void submitFeedback(evt.id, value)
      router.push('/financial-profile')
      return
    }
    const res = await submitFeedback(evt.id, value)
    if (!res.ok) return
    setFeedbackDone((s) => ({ ...s, [evt.id]: value === 'not_relevant' ? 'muted' : 'noted' }))
  }

  const undoMute = async (evt: FeedEvent) => {
    const res = await submitFeedback(evt.id, 'useful')
    if (res.ok) setFeedbackDone((s) => ({ ...s, [evt.id]: 'noted' }))
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchFeed({ limit: 20, ...(mode ? { mode } : {}) }), fetchFeedSummary('7d')])
      .then(([evts, sum]) => {
        if (cancelled) return
        setEvents(evts)
        setSummary(sum)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [mode])

  const memberName = (id: string) => members.find((m) => m.id === id)?.name?.split(' ')[0] ?? null

  const summaryLine = summary && summary.total > 0
    ? `${summary.total} ${summary.total === 1 ? 'thing' : 'things'} moved this week` +
      (summary.composite_delta !== null && summary.composite_delta !== 0
        ? ` · score ${summary.composite_delta > 0 ? '+' : ''}${summary.composite_delta}`
        : '')
    : null

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-1 px-1">
        <ActivityIcon />
        What changed
      </div>
      {summaryLine && <p className="text-footnote text-ink-tertiary px-1 mb-3">{summaryLine}</p>}

      {events === null && !failed ? (
        <GlassCard className="p-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </GlassCard>
      ) : failed ? (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-tertiary">Couldn&apos;t load the latest changes — try again in a moment.</p>
        </GlassCard>
      ) : events === null || events.length === 0 ? (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-tertiary">Nothing has moved yet — Keel checks daily</p>
        </GlassCard>
      ) : (
        <div className="space-y-2">
          {events.map((evt) => {
            const Icon = TYPE_ICON[evt.type] ?? Bell
            const name = evt.member_id ? memberName(evt.member_id) : null
            const href = evt.links[0] ? linkFor(evt.links[0]) : null
            return (
              <GlassCard key={evt.id} className="p-3.5">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      evt.type === 'sweep_quiet'
                        ? 'bg-tint/5 border border-tint/10 text-ink-tertiary'
                        : 'bg-family-500/10 border border-family-500/20 text-family-400'
                    }`}
                  >
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {href ? (
                        <Link href={href} className="text-sm font-medium text-ink-primary truncate active:opacity-70">
                          {evt.title}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium text-ink-primary truncate">{evt.title}</span>
                      )}
                      {evt.direction === 'up' && <TrendingUp size={13} className="text-success flex-shrink-0" />}
                      {evt.direction === 'down' && <TrendingDown size={13} className="text-danger flex-shrink-0" />}
                    </div>
                    <p className="text-footnote text-ink-tertiary mt-0.5 leading-relaxed">{evt.summary}</p>
                    {name && (
                      <span className="inline-block mt-1.5 text-footnote font-medium text-family-400 bg-family-500/10 rounded-full px-2 py-0.5">
                        {name}
                      </span>
                    )}
                    {evt.evidence.length > 0 && (
                      <details className="mt-1.5 group">
                        <summary className="flex items-center gap-1 text-footnote text-ink-tertiary cursor-pointer list-none">
                          <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
                          Details
                        </summary>
                        <ul className="mt-1 space-y-0.5">
                          {evt.evidence.map((e, i) => (
                            <li key={i} className="text-footnote text-ink-tertiary">
                              {e.label}{e.value ? `: ${e.value}` : ''}
                              {e.value_minor !== undefined ? ` ${e.value_minor}` : ''}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {evt.next_check_at && (
                      <p className="text-footnote text-ink-tertiary/70 mt-1.5">Keel checks again tomorrow</p>
                    )}
                    {/* PRD-136 §3: per-user feedback — collapses to a
                        one-line ack after a response. Youth mode has no
                        muting (child accounts can't shape the feed). */}
                    {mode !== 'youth' && (
                      feedbackDone[evt.id] ? (
                        <p className="text-footnote text-ink-tertiary mt-2 pt-2 border-t border-tint/[0.06]">
                          {feedbackDone[evt.id] === 'muted' ? (
                            <>
                              Muted for 90 days ·{' '}
                              <button type="button" onClick={() => void undoMute(evt)} className="text-family-400 font-medium">
                                undo?
                              </button>
                            </>
                          ) : (
                            'Thanks — noted'
                          )}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-tint/[0.06]">
                          {(
                            [
                              ['useful', 'Useful'],
                              ['not_relevant', 'Not relevant'],
                              ['handled', 'Handled'],
                              ['remind_later', 'Later'],
                              ['data_wrong', 'Wrong data'],
                            ] as [FeedFeedbackValue, string][]
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => void sendFeedback(evt, value)}
                              className="text-footnote text-ink-tertiary hover:text-ink-secondary active:text-family-400"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActivityIcon() {
  return <Sparkles size={16} className="text-family-400" />
}
