'use client'

/**
 * /marketing — the review queue for outbound social posts. Drafts land here
 * (composed below now, generated daily once the content pipeline ships);
 * Approve publishes to the channel, Reject kills the draft. The trust line under
 * the composer shows how many human approvals a channel still needs before
 * Oak can publish to it unattended — the earned-trust ladder, visible.
 */

import { useEffect, useState } from 'react'
import { Send, Check, X, Loader2 } from 'lucide-react'
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
  connectBluesky,
  disconnectSocialChannel,
  type MarketingIntegration,
  type MarketingPost,
  type AutomationSettings,
  type SocialConnection,
  generateMarketingPost,
  fetchBlogPosts,
  updateAutomationSettings,
  type BlogPostSummary,
} from '@/lib/api'

const STATE_STYLE: Record<MarketingPost['state'], string> = {
  draft: 'text-warning bg-warning/10 border-warning/25',
  approved: 'text-family-400 bg-family-500/10 border-family-500/20',
  published: 'text-success bg-success/10 border-success/25',
  publish_failed: 'text-danger bg-danger/10 border-danger/25',
  rejected: 'text-ink-tertiary bg-tint/[0.04] border-tint/[0.08]',
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
  const [busy, setBusy] = useState<string | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [bskyHandle, setBskyHandle] = useState('')
  const [bskyPassword, setBskyPassword] = useState('')
  const [showGenerate, setShowGenerate] = useState(false)
  const [blogs, setBlogs] = useState<BlogPostSummary[]>([])
  const [genBlogSlug, setGenBlogSlug] = useState('')
  const [genTopic, setGenTopic] = useState('')

  useEffect(() => {
    Promise.all([fetchMarketingPosts(), fetchMarketingIntegrations(), fetchAutomationSettings(), fetchSocialConnections()])
      .then(([p, i, a, c]) => {
        setPosts(p)
        setIntegrations(i)
        setAutomation(a)
        setConnections(c)
        const first = (i ?? []).find((x) => !x.disabled)
        if (first) setIntegrationId(first.id)
      })
      .finally(() => setLoading(false))
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

  async function submit() {
    if (!selected || !content.trim()) return
    haptic('medium')
    setBusy('create')
    try {
      const post = await createMarketingPost({
        integration_id: selected.id,
        channel,
        content: content.trim(),
      })
      setPosts((p) => [post, ...p])
      setContent('')
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

  return (
    <div className="px-5 pt-2 pb-12">
      <PageHeader title="Marketing" subtitle="Outbound posts — drafted, reviewed, published." backHref="/settings" action={<></>} />

      {loading && <div className="shimmer h-24 rounded-2xl mt-4" />}

      {!loading && (
        <>
          {/* Channels */}
          <GlassCard className="p-4 mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-ink-primary">Channels</p>
              <button
                onClick={() => setShowConnect((v) => !v)}
                className="text-xs font-semibold text-family-400"
              >
                {showConnect ? 'Close' : 'Connect Bluesky'}
              </button>
            </div>
            {(integrations ?? []).length === 0 ? (
              <p className="text-xs text-ink-tertiary leading-relaxed">
                Nothing connected yet — link Bluesky below, or set{' '}
                <code className="text-family-400">X_ACCESS_TOKEN</code> /{' '}
                <code className="text-family-400">LINKEDIN_ACCESS_TOKEN</code> on the API.
              </p>
            ) : (
              <ul className="space-y-2">
                {(integrations ?? []).map((i) => {
                  const conn = i.source === 'connection' ? connections.find((c) => c.channel === i.identifier) : undefined
                  return (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-primary truncate">
                          {i.name}
                          {i.source === 'env' && <span className="text-ink-tertiary"> · server env</span>}
                        </p>
                        {conn?.status === 'error' && conn.last_error && (
                          <p className="text-xs text-danger truncate">{conn.last_error}</p>
                        )}
                      </div>
                      {i.source === 'connection' && (
                        <button
                          onClick={() => disconnect(i.identifier ?? '')}
                          disabled={busy === `disconnect:${i.identifier}`}
                          className="text-xs text-ink-tertiary font-semibold disabled:opacity-40"
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
                <select
                  value={integrationId}
                  onChange={(e) => setIntegrationId(e.target.value)}
                  className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary mb-3 outline-none"
                >
                  {integrations.map((i) => (
                    <option key={i.id} value={i.id} disabled={i.disabled}>
                      {i.name}{i.identifier ? ` (${i.identifier})` : ''}
                    </option>
                  ))}
                </select>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write the post…"
                  rows={4}
                  className="glass-input w-full rounded-xl px-4 py-3 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none focus:ring-2 focus:ring-family-500/40 resize-none mb-3"
                />
                <GlassButton onClick={submit} disabled={busy === 'create' || !content.trim()}>
                  {busy === 'create' ? 'Queueing…' : 'Queue draft'}
                </GlassButton>
                <p className="text-xs text-ink-tertiary mt-2.5 leading-relaxed">
                  {autoEnabled
                    ? `${Math.min(trustLevel, 5)}/5 approvals on ${channel} — at 5, Oak publishes new drafts here itself.`
                    : `Earned-trust publishing is off (Settings → Automation). ${Math.min(trustLevel, 5)}/5 approvals on ${channel} so far.`}
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

          {/* Queue */}
          <div className="mt-6 space-y-3">
            {posts.length === 0 && (
              <GlassCard className="p-4">
                <p className="text-sm text-ink-secondary">Nothing queued yet.</p>
              </GlassCard>
            )}
            {posts.map((post) => (
              <GlassCard key={post.id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-caption font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${STATE_STYLE[post.state]}`}>
                    {post.state.replace('_', ' ')}
                  </span>
                  <span className="text-caption text-ink-tertiary">{post.channel}</span>
                  {post.auto_published && <span className="text-caption text-family-400">auto</span>}
                  {post.generated && <span className="text-caption text-ink-tertiary">ai draft</span>}
                  {post.dry_run && <span className="text-caption text-ink-tertiary">dry run</span>}
                </div>
                <p className="text-sm text-ink-primary leading-relaxed whitespace-pre-wrap">{post.content}</p>
                {post.publish_error && (
                  <p className="text-xs text-danger mt-2 leading-snug">{post.publish_error}</p>
                )}
                {(post.state === 'draft' || post.state === 'publish_failed') && (
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
                {post.state === 'published' && post.published_at && (
                  <div className="flex items-center gap-1.5 text-xs text-ink-tertiary mt-2">
                    <Check size={13} className="text-success" />
                    {new Date(post.published_at).toLocaleString()}
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
