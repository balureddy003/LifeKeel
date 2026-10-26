'use client'

/**
 * How people find LifeKeel in search, read-only from Google Search Console and GA4 (intent 47).
 * Nothing here writes to Google, and the topic ideas are only a list: picking one still goes through the
 * normal drafting, copy guard and approval.
 */

import { useCallback, useEffect, useState } from 'react'
import { GlassCard } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import {
  fetchSearchView,
  fetchTopicSuggestions,
  generateTopicSuggestions,
  runSearchReadbackNow,
  setTopicSuggestion,
  type SearchIntegrationStatus,
  type SearchView,
  type TopicSuggestion,
} from '@/lib/api'

const btn =
  'rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-semibold text-ink-secondary hover:text-ink-primary disabled:opacity-40'

const STATUS: Record<SearchIntegrationStatus, { label: string; cls: string }> = {
  connected: { label: 'connected', cls: 'bg-success/15 text-success' },
  needs_attention: { label: 'needs attention', cls: 'bg-danger/15 text-danger' },
  not_configured: { label: 'not set up', cls: 'bg-tint/[0.08] text-ink-tertiary' },
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

function Setup() {
  return (
    <GlassCard className="p-4">
      <h3 className="font-semibold">Set up read-only access (once)</h3>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
        <li>In Google Cloud, create a service account with no roles and a JSON key.</li>
        <li>
          In Search Console, add its email as a <strong>restricted</strong> user on your property.
        </li>
        <li>
          In GA4, add the same email as a <strong>Viewer</strong>, and note the numeric property ID.
        </li>
        <li>
          Set <code>GOOGLE_READONLY_SERVICE_ACCOUNT_JSON</code>,{' '}
          <code>SEARCH_CONSOLE_SITE_URL</code> (for example <code>sc-domain:lifekeel.co.uk</code>)
          and <code>GA4_PROPERTY_ID</code> on the API, then restart it.
        </li>
      </ol>
      <p className="mt-2 text-xs text-ink-tertiary">
        The key never leaves the API and is never shown here. LifeKeel only reads; it cannot change
        anything in Google.
      </p>
    </GlassCard>
  )
}

export function SearchPanel() {
  const toast = useToast()
  const [view, setView] = useState<SearchView | null>(null)
  const [ideas, setIdeas] = useState<TopicSuggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [v, s] = await Promise.all([fetchSearchView(28), fetchTopicSuggestions()])
      setView(v)
      setIdeas(s)
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : 'Could not load search data',
        variant: 'error',
      })
    } finally {
      setLoaded(true)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await fn()
      toast({ message: done, variant: 'success' })
      await load()
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'That did not work', variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return <GlassCard className="p-4 text-sm text-ink-tertiary">Loading…</GlassCard>
  if (!view)
    return (
      <GlassCard className="p-4 text-sm text-ink-tertiary">Search data is unavailable.</GlassCard>
    )

  const anyConfigured = view.configured.search_console || view.configured.ga4

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Search and analytics (read-only)</h3>
          {anyConfigured && (
            <button
              className={btn}
              disabled={busy}
              onClick={() => run(() => runSearchReadbackNow(), 'Pulled the latest')}
            >
              Pull now
            </button>
          )}
        </div>
        <ul className="mt-3 space-y-2 text-sm">
          {(
            [
              ['search_console', 'Google Search Console'],
              ['ga4', 'Google Analytics 4'],
            ] as const
          ).map(([id, label]) => {
            const i = view.integrations[id]
            return (
              <li key={id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{label}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[i.status].cls}`}>
                  {STATUS[i.status].label}
                </span>
                {i.last_ok_at && (
                  <span className="text-xs text-ink-tertiary">
                    last pull {new Date(i.last_ok_at).toLocaleDateString('en-GB')}
                  </span>
                )}
                {i.last_error && <span className="text-xs text-danger">{i.last_error}</span>}
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-xs text-ink-tertiary">{view.lag_note}</p>
      </GlassCard>

      {!anyConfigured && <Setup />}

      {anyConfigured && (
        <>
          <GlassCard className="p-4">
            <h3 className="mb-2 font-semibold">Last {view.window_days} days in search</h3>
            {!view.enough_data ? (
              <p className="text-sm text-ink-tertiary">
                Not enough data yet to rank anything ({view.totals.impressions} impressions).
                Rankings below this level are mostly noise.
              </p>
            ) : (
              <p className="text-sm">
                {view.totals.clicks} clicks from {view.totals.impressions} impressions.
              </p>
            )}
            {view.top_queries.length > 0 && (
              <table className="mt-3 w-full text-sm">
                <caption className="sr-only">Top search queries</caption>
                <thead>
                  <tr className="text-left text-ink-tertiary">
                    <th scope="col">Query</th>
                    <th scope="col">Clicks</th>
                    <th scope="col">Impr.</th>
                    <th scope="col">CTR</th>
                    <th scope="col">Pos.</th>
                  </tr>
                </thead>
                <tbody>
                  {view.top_queries.slice(0, 10).map((r) => (
                    <tr key={r.query}>
                      <td className="pr-2">{r.query}</td>
                      <td>{r.clicks}</td>
                      <td>{r.impressions}</td>
                      <td>{pct(r.ctr)}</td>
                      <td>{r.position}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </GlassCard>

          {view.near_misses.length > 0 && (
            <GlassCard className="p-4">
              <h3 className="mb-1 font-semibold">Near misses</h3>
              <p className="mb-2 text-xs text-ink-tertiary">
                Seen often, ranking on the first two pages, rarely clicked: the page or its title
                may be worth a look.
              </p>
              <ul className="space-y-1 text-sm">
                {view.near_misses.map((r) => (
                  <li key={r.query} className="flex justify-between gap-2">
                    <span>{r.query}</span>
                    <span className="text-ink-tertiary">
                      {r.impressions} impr. · pos {r.position} · {pct(r.ctr)}
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}

          {view.top_pages.length > 0 && (
            <GlassCard className="p-4">
              <h3 className="mb-2 font-semibold">Pages that earn search clicks</h3>
              <ul className="space-y-1 text-sm">
                {view.top_pages.slice(0, 10).map((r) => (
                  <li key={r.path} className="flex justify-between gap-2">
                    <code>{r.path}</code>
                    <span className="text-ink-tertiary">
                      {r.clicks} clicks · {r.impressions} impr.
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}

          {view.configured.ga4 && (
            <GlassCard className="p-4">
              <h3 className="mb-2 font-semibold">GA4 against our own count</h3>
              <p className="text-sm">
                GA4 sessions: <strong>{view.ga4.sessions}</strong> · first-party visits:{' '}
                <strong>{view.ga4.first_party_visits}</strong>
              </p>
              <p className="mt-1 text-xs text-ink-tertiary">{view.ga4.note}</p>
              {view.ga4.by_source.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {view.ga4.by_source.slice(0, 8).map((r) => (
                    <li key={r.source_medium} className="flex justify-between gap-2">
                      <span>{r.source_medium}</span>
                      <span className="text-ink-tertiary">
                        {r.sessions} sessions · {r.key_events} key events
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          )}

          <GlassCard className="p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Topic ideas from real searches</h3>
              <button
                className={btn}
                disabled={busy}
                onClick={() => run(() => generateTopicSuggestions(), 'Refreshed the ideas')}
              >
                Refresh ideas
              </button>
            </div>
            <p className="mb-2 text-xs text-ink-tertiary">
              Ideas only. Nothing here creates a draft or a post; write one through the usual steps.
            </p>
            {ideas.length === 0 ? (
              <p className="text-sm text-ink-tertiary">No new ideas right now.</p>
            ) : (
              <ul className="space-y-2">
                {ideas.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-tint/[0.06] p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.query}</p>
                      <p className="text-xs text-ink-tertiary">
                        {s.impressions} impressions · position {s.position}
                        {s.nearest
                          ? ` · closest: ${s.nearest.title}`
                          : ' · nothing close on the site'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() =>
                          run(() => setTopicSuggestion(s.id, 'used'), 'Marked as used')
                        }
                      >
                        I wrote it
                      </button>
                      <button
                        className={btn}
                        disabled={busy}
                        onClick={() => run(() => setTopicSuggestion(s.id, 'dismiss'), 'Dismissed')}
                      >
                        Dismiss
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>
        </>
      )}
    </div>
  )
}
