'use client'

/**
 * /marketing — the review queue for outbound social posts. Drafts land here
 * (composed below now, generated daily once the content pipeline ships);
 * Approve publishes to the channel, Reject kills the draft. The trust line under
 * the composer shows how many human approvals a channel still needs before
 * Oak can publish to it unattended — the earned-trust ladder, visible.
 */

import { useEffect, useState } from 'react'
import { Send, Check, X, Loader2, Pencil } from 'lucide-react'
import { GlassCard, GlassButton, PageHeader } from '@/components/Glass'
import { useToast } from '@/components/Toast'
import { haptic } from '@/lib/haptics'
import {
  fetchMarketingIntegrations,
  fetchMarketingPosts,
  createMarketingPost,
  approveMarketingPost,
  rejectMarketingPost,
  fetchAutomationSettings,
  fetchSocialConnections,
  startXConnect,
  connectBluesky,
  disconnectSocialChannel,
  type MarketingIntegration,
  type MarketingPost,
  type AutomationSettings,
  type SocialConnection,
  generateMarketingPost,
  updateMarketingPost,
  fetchBlogPosts,
  updateAutomationSettings,
  fetchMarketingPerformance,
  type BlogPostSummary,
  type MarketingPerformance,
} from '@/lib/api'

const STATE_STYLE: Record<MarketingPost['state'], string> = {
  draft: 'text-warning bg-warning/10 border-warning/25',
  approved: 'text-family-400 bg-family-500/10 border-family-500/20',
  published: 'text-success bg-success/10 border-success/25',
  publish_failed: 'text-danger bg-danger/10 border-danger/25',
  rejected: 'text-ink-tertiary bg-tint/[0.04] border-tint/[0.08]',
}

const STATE_LABEL: Record<MarketingPost['state'], string> = {
  draft: 'draft',
  approved: 'scheduled',
  published: 'published',
  publish_failed: 'failed',
  rejected: 'rejected',
}

/** Display label + hard post-length cap per channel — the composer counter
 *  uses the cap so a draft can't go out that the provider would reject. */
const CHANNEL_META: Record<string, { label: string; limit: number }> = {
  x: { label: 'X', limit: 280 },
  bluesky: { label: 'Bluesky', limit: 300 },
  linkedin: { label: 'LinkedIn', limit: 3000 },
}
const channelLimit = (ch: string) => CHANNEL_META[ch]?.limit ?? 5000
const channelLabel = (ch: string) => CHANNEL_META[ch]?.label ?? ch

/** ISO date → the `YYYY-MM-DDTHH:MM` a datetime-local input wants. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function trustScope(channel: string): string {
  return `marketing_social:${channel}`
}

export default function MarketingPage() {
  const toast = useToast()
  const [posts, setPosts] = useState<MarketingPost[]>([])
  // null = publishing not configured; [] = configured, no channels; the `loading`
  // gate above keeps the pre-fetch null from flashing the "not configured" copy.
  const [integrations, setIntegrations] = useState<MarketingIntegration[] | null>(null)
  const [automation, setAutomation] = useState<AutomationSettings | null>(null)
  const [connections, setConnections] = useState<SocialConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [integrationId, setIntegrationId] = useState('')
  const [content, setContent] = useState('')
  const [scheduleAt, setScheduleAt] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [bskyHandle, setBskyHandle] = useState('')
  const [bskyPassword, setBskyPassword] = useState('')
  const [showGenerate, setShowGenerate] = useState(false)
  const [blogs, setBlogs] = useState<BlogPostSummary[]>([])
  const [genBlogSlug, setGenBlogSlug] = useState('')
  const [genTopic, setGenTopic] = useState('')
  const [performance, setPerformance] = useState<MarketingPerformance | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editSchedule, setEditSchedule] = useState('')

  useEffect(() => {
    Promise.all([fetchMarketingPosts(), fetchMarketingIntegrations(), fetchAutomationSettings(), fetchSocialConnections(), fetchMarketingPerformance()])
      .then(([p, i, a, c, perf]) => {
        setPosts(p)
        setIntegrations(i)
        setAutomation(a)
        setConnections(c)
        setPerformance(perf)
        const first = (i ?? []).find((x) => !x.disabled)
        if (first) setIntegrationId(first.id)
      })
      .finally(() => setLoading(false))
  }, [])

  // OAuth return — the connector callback redirects here with
  // ?connected=twitter_x on success or ?connect=twitter_x&error=… on
  // failure. Toast the outcome, refresh the channel list, strip the params.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const connected = q.get('connected')
    const err = q.get('error')
    if (!connected && !err && !q.get('connect')) return
    if (connected === 'twitter_x') {
      toast({ message: 'X connected' })
      refreshChannels()
    } else if (err) {
      toast({ message: `X connect failed: ${q.get('detail') ?? err}`, variant: 'error' })
    }
    window.history.replaceState({}, '', '/marketing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshChannels() {
    const [ints, conns] = await Promise.all([fetchMarketingIntegrations(), fetchSocialConnections()])
    setIntegrations(ints)
    setConnections(conns)
    const first = (ints ?? []).find((x) => !x.disabled)
    if (first) setIntegrationId(first.id)
  }

  async function connect() {
    if (!bskyHandle.trim() || !bskyPassword.trim()) return
    haptic('medium')
    setBusy('connect')
    try {
      await connectBluesky({ handle: bskyHandle.trim(), app_password: bskyPassword.trim() })
      setBskyHandle('')
      setBskyPassword('')
      setShowConnect(false)
      await refreshChannels()
      toast({ message: 'Bluesky connected' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Connection failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function connectX() {
    haptic('medium')
    setBusy('connect-x')
    try {
      const res = await startXConnect()
      if (res?.auth_url) window.location.assign(res.auth_url)
      else toast({ message: 'X OAuth not configured — set X_CLIENT_ID on the API', variant: 'error' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Connect failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function disconnect(channel: string) {
    haptic('light')
    setBusy(`disconnect:${channel}`)
    try {
      await disconnectSocialChannel(channel)
      await refreshChannels()
      toast({ message: 'Channel disconnected' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Disconnect failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function openGenerator() {
    const next = !showGenerate
    setShowGenerate(next)
    if (next && blogs.length === 0) setBlogs(await fetchBlogPosts().catch(() => []))
  }

  async function generate() {
    if (!selected) return
    if (!genBlogSlug && !genTopic.trim()) return
    haptic('medium')
    setBusy('generate')
    try {
      const post = await generateMarketingPost({
        integration_id: selected.id,
        channel,
        ...(genBlogSlug ? { blog_slug: genBlogSlug } : { topic: genTopic.trim() }),
      })
      setPosts((p) => [post, ...p])
      setShowGenerate(false)
      setGenTopic('')
      toast({ message: 'Draft generated — review it below' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Generation failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const selected = (integrations ?? []).find((i) => i.id === integrationId)
  const channel = selected?.identifier ?? 'other'
  const trustLevel = automation?.trust_level_by_workflow?.[trustScope(channel)] ?? 0
  const autoEnabled = automation?.auto_execute_enabled === true
  const limit = channelLimit(channel)
  const overLimit = content.length > limit
  const pendingCount = posts.filter((p) => p.state === 'draft' || p.state === 'publish_failed').length

  async function submit() {
    if (!selected || !content.trim()) return
    haptic('medium')
    setBusy('create')
    try {
      const post = await createMarketingPost({
        integration_id: selected.id,
        channel,
        content: content.trim(),
        ...(scheduleAt ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
      })
      setPosts((p) => [post, ...p])
      setContent('')
      setScheduleAt('')
      toast({ message: post.state === 'published' ? 'Published' : 'Draft queued for review' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't save that draft", variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    haptic('light')
    setBusy(id)
    try {
      const post = action === 'approve' ? await approveMarketingPost(id) : await rejectMarketingPost(id)
      setPosts((p) => p.map((x) => (x.id === id ? post : x)))
      toast({ message: action === 'approve' ? 'Published' : 'Draft rejected' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'That did not work — try again', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  function startEdit(post: MarketingPost) {
    setEditingId(post.id)
    setEditContent(post.content)
    setEditSchedule(post.scheduled_at ? toLocalInput(post.scheduled_at) : '')
  }

  async function saveEdit(post: MarketingPost) {
    if (!editContent.trim() || editContent.length > channelLimit(post.channel)) return
    haptic('light')
    setBusy(`edit:${post.id}`)
    try {
      const updated = await updateMarketingPost(post.id, {
        content: editContent.trim(),
        scheduled_at: editSchedule ? new Date(editSchedule).toISOString() : '',
      })
      setPosts((p) => p.map((x) => (x.id === post.id ? updated : x)))
      setEditingId(null)
      toast({ message: 'Draft updated' })
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't save that edit", variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Marketing" subtitle="Outbound posts — drafted, reviewed, published." backHref="/settings" action={<></>} />

      {loading && <div className="shimmer h-24 rounded-2xl mt-4" />}

      {!loading && (
        <>
          {/* Channels */}
          <GlassCard className="p-4 mt-4">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-sm font-semibold text-ink-primary">Channels</p>
              <div className="flex items-center gap-3">
                {!(integrations ?? []).some((i) => i.identifier === 'x') && (
                  <button
                    onClick={connectX}
                    disabled={busy === 'connect-x'}
                    className="text-xs font-semibold text-family-400 disabled:opacity-40"
                  >
                    {busy === 'connect-x' ? 'Redirecting…' : 'Connect X'}
                  </button>
                )}
                <button
                  onClick={() => setShowConnect((v) => !v)}
                  className="text-xs font-semibold text-family-400"
                >
                  {showConnect
                    ? 'Close'
                    : (integrations ?? []).some((i) => i.identifier === 'bluesky')
                      ? 'Reconnect Bluesky'
                      : 'Connect Bluesky'}
                </button>
              </div>
            </div>
            {(integrations ?? []).length === 0 ? (
              <p className="text-xs text-ink-tertiary leading-relaxed">
                Nothing connected yet — link Bluesky below, or set{' '}
                <code className="text-family-400">X_ACCESS_TOKEN</code> /{' '}
                <code className="text-family-400">LINKEDIN_ACCESS_TOKEN</code> on the API.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {(integrations ?? []).map((i) => {
                  const conn = i.source === 'connection' ? connections.find((c) => c.channel === i.identifier) : undefined
                  const ok = conn?.status !== 'error'
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-success' : 'bg-danger'}`}
                          aria-hidden
                        />
                        <div className="min-w-0">
                          <p className="text-sm text-ink-primary truncate">
                            {i.name}
                            {i.source === 'env' && <span className="text-ink-tertiary"> · server env</span>}
                          </p>
                          {!ok && conn?.last_error && (
                            <p className="text-xs text-danger truncate">{conn.last_error}</p>
                          )}
                        </div>
                      </div>
                      {i.source === 'connection' && (
                        <button
                          onClick={() => disconnect(i.identifier ?? '')}
                          disabled={busy === `disconnect:${i.identifier}`}
                          className="text-xs text-ink-tertiary font-semibold disabled:opacity-40 shrink-0"
                        >
                          {busy === `disconnect:${i.identifier}` ? '…' : 'Disconnect'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {showConnect && (
              <div className="mt-3 pt-3 border-t border-tint/[0.06] space-y-2">
                <input
                  value={bskyHandle}
                  onChange={(e) => setBskyHandle(e.target.value)}
                  placeholder="handle — e.g. oak.bsky.social"
                  className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                />
                <input
                  value={bskyPassword}
                  onChange={(e) => setBskyPassword(e.target.value)}
                  type="password"
                  placeholder="app password (bsky.app → Settings → App passwords)"
                  className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                />
                <GlassButton onClick={connect} disabled={busy === 'connect' || !bskyHandle.trim() || !bskyPassword.trim()}>
                  {busy === 'connect' ? 'Verifying…' : 'Verify & connect'}
                </GlassButton>
              </div>
            )}
          </GlassCard>

          {/* Composer */}
          <GlassCard className="p-4 mt-4">
            {integrations === null ? (
              <p className="text-sm text-ink-secondary leading-relaxed">
                Publishing channels couldn't load — check the API, then refresh.
              </p>
            ) : integrations.length === 0 ? (
              <p className="text-sm text-ink-secondary leading-relaxed">
                Connect a channel above to start queueing drafts.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-3">
                  {integrations.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => !i.disabled && setIntegrationId(i.id)}
                      disabled={i.disabled}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors ${
                        i.id === integrationId
                          ? 'bg-family-500/20 border-family-500/40 text-family-300'
                          : 'bg-tint/[0.04] border-tint/[0.08] text-ink-secondary'
                      } ${i.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      {i.name}
                    </button>
                  ))}
                </div>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={`Write the post for ${channelLabel(channel)}…`}
                  rows={4}
                  className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 resize-none"
                />
                <div className="flex items-center justify-between mt-1.5 mb-3">
                  <p className="text-caption text-ink-tertiary">
                    {overLimit && `Over the ${channelLabel(channel)} limit — `}
                    {limit !== 5000 && `${channelLabel(channel)} allows ${limit} characters`}
                  </p>
                  <p
                    className={`text-caption tabular-nums ${
                      overLimit ? 'text-danger font-semibold' : content.length > limit * 0.9 ? 'text-warning' : 'text-ink-tertiary'
                    }`}
                  >
                    {content.length}/{limit === 5000 ? '∞' : limit}
                  </p>
                </div>
                <label className="block text-caption text-ink-tertiary mb-1">Schedule for later — optional</label>
                <input
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-secondary outline-none mb-3"
                />
                <GlassButton onClick={submit} disabled={busy === 'create' || !content.trim() || overLimit}>
                  {busy === 'create' ? 'Queueing…' : scheduleAt ? 'Queue scheduled draft' : 'Queue draft'}
                </GlassButton>
                {scheduleAt && (
                  <p className="text-xs text-ink-tertiary mt-2 leading-relaxed">
                    Approving a scheduled draft publishes it at {new Date(scheduleAt).toLocaleString()} — cancel it from the queue anytime before then.
                  </p>
                )}
                <p className="text-xs text-ink-tertiary mt-2.5 leading-relaxed">
                  {autoEnabled
                    ? `${Math.min(trustLevel, 5)}/5 approvals on ${channelLabel(channel)} — at 5, Oak publishes new drafts here itself.`
                    : `Earned-trust publishing is off (Settings → Automation). ${Math.min(trustLevel, 5)}/5 approvals on ${channelLabel(channel)} so far.`}
                </p>
                <div className="mt-3 pt-3 border-t border-tint/[0.06]">
                  <button onClick={openGenerator} className="text-xs font-semibold text-family-400">
                    {showGenerate ? 'Close generator' : 'Generate a draft with Oak'}
                  </button>
                  {showGenerate && (
                    <div className="mt-2.5 space-y-2">
                      <select
                        value={genBlogSlug}
                        onChange={(e) => setGenBlogSlug(e.target.value)}
                        className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary outline-none"
                      >
                        <option value="">Free topic…</option>
                        {blogs.map((b) => (
                          <option key={b.slug} value={b.slug}>
                            Promote: {b.title}
                          </option>
                        ))}
                      </select>
                      {!genBlogSlug && (
                        <input
                          value={genTopic}
                          onChange={(e) => setGenTopic(e.target.value)}
                          placeholder="Topic — e.g. why emergency funds matter"
                          className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                        />
                      )}
                      <GlassButton onClick={generate} disabled={busy === 'generate' || (!genBlogSlug && !genTopic.trim())}>
                        {busy === 'generate' ? 'Generating…' : 'Generate draft'}
                      </GlassButton>
                      <label className="flex items-start gap-2 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={automation?.daily_marketing_drafts_enabled === true}
                          onChange={async (e) => {
                            const next = await updateAutomationSettings({ daily_marketing_drafts_enabled: e.target.checked })
                            if (next && next !== 'queued') setAutomation(next)
                            toast({ message: e.target.checked ? 'Daily drafts on — one queued each morning' : 'Daily drafts off' })
                          }}
                          className="mt-0.5 accent-family-500"
                        />
                        <span className="text-xs text-ink-secondary leading-relaxed">
                          Queue one for review every morning — promotes a blog post you haven't pushed yet.
                        </span>
                      </label>
                      <p className="text-xs text-ink-tertiary leading-relaxed">
                        Generated drafts always wait for your approval — they never auto-publish.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </GlassCard>

          {/* Performance — promoted posts → views → signups */}
          {performance && (performance.totals.views > 0 || performance.totals.signups > 0 || performance.channels.length > 0) && (
            <GlassCard className="p-4 mt-4">
              <p className="text-sm font-semibold text-ink-primary mb-3">Performance</p>
              <div className="flex gap-4 mb-3 text-center">
                <div><p className="text-lg font-bold text-ink-primary">{performance.totals.views}</p><p className="text-caption text-ink-tertiary">views</p></div>
                <div><p className="text-lg font-bold text-ink-primary">{performance.totals.cta_clicks}</p><p className="text-caption text-ink-tertiary">CTA taps</p></div>
                <div><p className="text-lg font-bold text-ink-primary">{performance.totals.leads}</p><p className="text-caption text-ink-tertiary">leads</p></div>
                <div><p className="text-lg font-bold text-success">{performance.totals.signups}</p><p className="text-caption text-ink-tertiary">signups</p></div>
              </div>
              {performance.channels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {performance.channels.map((c) => (
                    <span key={c.channel} className="text-caption rounded-full border border-family-500/25 text-family-400 px-2 py-0.5">
                      {c.channel}: {c.views}v · {c.signups}s
                    </span>
                  ))}
                </div>
              )}
              <ul className="space-y-1.5">
                {performance.posts.slice(0, 8).map((p) => (
                  <li key={p.slug} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink-secondary truncate">{p.title ?? p.slug}</span>
                    <span className="text-ink-tertiary shrink-0">
                      {p.views}v · {p.cta_clicks}c · {p.leads}l · <span className="text-success">{p.signups}s</span>
                    </span>
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}

          {/* Queue */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink-primary">Queue</p>
              {pendingCount > 0 && (
                <span className="text-caption font-semibold rounded-full bg-warning/10 border border-warning/25 text-warning px-2 py-0.5">
                  {pendingCount} to review
                </span>
              )}
            </div>
            {posts.length === 0 && (
              <GlassCard className="p-4">
                <p className="text-sm text-ink-secondary leading-relaxed">
                  Nothing queued yet — write a draft above or generate one with Oak.
                </p>
              </GlassCard>
            )}
            {posts.map((post) => (
              <GlassCard key={post.id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-caption font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${STATE_STYLE[post.state]}`}>
                    {STATE_LABEL[post.state]}
                  </span>
                  <span className="text-caption text-ink-tertiary">{channelLabel(post.channel)}</span>
                  {post.auto_published && <span className="text-caption text-family-400">auto</span>}
                  {post.generated && <span className="text-caption text-ink-tertiary">ai draft</span>}
                  {post.dry_run && <span className="text-caption text-ink-tertiary">dry run</span>}
                  {(post.state === 'draft' || post.state === 'publish_failed') && editingId !== post.id && (
                    <button
                      onClick={() => startEdit(post)}
                      className="ml-auto flex items-center gap-1 text-caption font-semibold text-ink-tertiary"
                      aria-label="Edit draft"
                    >
                      <Pencil size={11} /> Edit
                    </button>
                  )}
                </div>
                {editingId === post.id ? (
                  <div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      rows={4}
                      className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-family-500/40 resize-none"
                    />
                    <p className={`text-caption tabular-nums mt-1 text-right ${editContent.length > channelLimit(post.channel) ? 'text-danger font-semibold' : 'text-ink-tertiary'}`}>
                      {editContent.length}/{channelLimit(post.channel)}
                    </p>
                    <input
                      type="datetime-local"
                      value={editSchedule}
                      onChange={(e) => setEditSchedule(e.target.value)}
                      aria-label="Schedule for later"
                      className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-secondary outline-none mt-1"
                    />
                    <div className="flex gap-2 mt-2.5">
                      <button
                        onClick={() => saveEdit(post)}
                        disabled={busy === `edit:${post.id}` || !editContent.trim() || editContent.length > channelLimit(post.channel)}
                        className="flex-1 rounded-xl py-2 text-sm font-semibold bg-family-500/15 border border-family-500/25 text-family-400 disabled:opacity-40"
                      >
                        {busy === `edit:${post.id}` ? 'Saving…' : 'Save changes'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-11 flex items-center justify-center rounded-xl bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary"
                        aria-label="Cancel edit"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink-primary leading-relaxed whitespace-pre-wrap">{post.content}</p>
                )}
                {post.publish_error && (
                  <p className="text-xs text-danger mt-2 leading-snug">{post.publish_error}</p>
                )}
                {(post.state === 'draft' || post.state === 'publish_failed') && editingId !== post.id && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => decide(post.id, 'approve')}
                      disabled={busy === post.id}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold bg-family-500/15 border border-family-500/25 text-family-400 disabled:opacity-40"
                    >
                      {busy === post.id ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                      {post.state === 'publish_failed' ? 'Retry publish' : 'Approve & publish'}
                    </button>
                    <button
                      onClick={() => decide(post.id, 'reject')}
                      disabled={busy === post.id}
                      className="w-11 flex items-center justify-center rounded-xl bg-tint/[0.04] border border-tint/[0.08] text-ink-secondary disabled:opacity-40"
                      aria-label="Reject draft"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {post.state === 'approved' && (
                  <div className="flex items-center justify-between gap-2 mt-3">
                    <span className="text-xs text-ink-tertiary">
                      {post.scheduled_at ? `Scheduled for ${new Date(post.scheduled_at).toLocaleString()}` : 'Approved — publishes on the next sweep'}
                    </span>
                    <button
                      onClick={() => decide(post.id, 'reject')}
                      disabled={busy === post.id}
                      className="text-xs font-semibold text-ink-tertiary disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                )}
                {post.state === 'published' && (
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-xs text-ink-tertiary mt-2">
                    {post.published_at && (
                      <span className="flex items-center gap-1.5">
                        <Check size={13} className="text-success" />
                        {new Date(post.published_at).toLocaleString()}
                      </span>
                    )}
                    {post.metrics && (
                      <span>
                        {post.metrics.likes ?? 0} likes · {post.metrics.reposts ?? 0} reposts · {post.metrics.replies ?? 0} replies
                      </span>
                    )}
                    {post.external_url && (
                      <a href={post.external_url} target="_blank" rel="noopener noreferrer" className="text-family-400 font-semibold">
                        View post ↗
                      </a>
                    )}
                  </div>
                )}
              </GlassCard>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
