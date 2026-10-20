'use client'

/**
 * /operator/marketing — the social control plane inside the operator
 * shell. Four tabs: Compose (manual or AI-generated drafts, with a
 * channel-styled preview), Queue (human review — approve publishes,
 * reject kills), Calendar (scheduled/published on a month grid), and
 * Performance (views → CTA → leads → signups per post, channel, and
 * campaign). Every post carries a UTM'd backlink so clicks convert into
 * the attributed funnel.
 */

import { useEffect, useMemo, useState } from 'react'
import { Send, Check, X, Loader2, Pencil, Sparkles, Link2 } from 'lucide-react'
import { GlassCard, GlassButton } from '@/components/Glass'
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
  startConnectorConnect,
  connectBluesky,
  disconnectSocialChannel,
  type MarketingIntegration,
  type MarketingPost,
  type AutomationSettings,
  type SocialConnection,
  previewMarketingDrafts,
  updateMarketingPost,
  fetchBlogPosts,
  updateAutomationSettings,
  fetchMarketingPerformance,
  type BlogPostSummary,
  type MarketingPerformance,
  fetchOperatorCampaigns,
  createCampaign,
  previewCampaignAudience,
  sendCampaignNow,
  pauseCampaignSend,
  resumeCampaignSend,
  type OperatorCampaign,
  type CampaignFilter,
} from '@/lib/api'
import { PostPreview } from './_components/PostPreview'
import { PostCalendar } from './_components/PostCalendar'
import { ReasonAction } from '../_components/ReasonAction'

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
 *  uses the cap so a draft can't go out that the provider would reject.
 *  media: 'required' channels can't publish without an image (Instagram's
 *  API has no text post); 'optional' attaches it as a photo (Facebook). */
const CHANNEL_META: Record<
  string,
  { label: string; limit: number; media?: 'required' | 'optional' }
> = {
  x: { label: 'X', limit: 280 },
  bluesky: { label: 'Bluesky', limit: 300 },
  threads: { label: 'Threads', limit: 500 },
  linkedin: { label: 'LinkedIn', limit: 3000 },
  instagram: { label: 'Instagram', limit: 2200, media: 'required' },
  facebook: { label: 'Facebook', limit: 5000, media: 'optional' },
  mastodon: { label: 'Mastodon', limit: 500 },
}
const channelLimit = (ch: string) => CHANNEL_META[ch]?.limit ?? 5000
const channelLabel = (ch: string) => CHANNEL_META[ch]?.label ?? ch
const channelMedia = (ch: string) => CHANNEL_META[ch]?.media

/** OAuth-connectable channels — connector id ↔ marketing channel. Bluesky
 *  is app-password instead; Mastodon is env-only. */
const OAUTH_CHANNELS: { channel: string; connector: string; label: string }[] = [
  { channel: 'x', connector: 'twitter_x', label: 'X' },
  { channel: 'facebook', connector: 'facebook_pages', label: 'Facebook Page' },
  { channel: 'instagram', connector: 'instagram_business', label: 'Instagram Business' },
  { channel: 'threads', connector: 'threads', label: 'Threads' },
  { channel: 'linkedin', connector: 'linkedin', label: 'LinkedIn' },
]

const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,59}$/
const DEFAULT_CAMPAIGN = 'lifekeel_social'

/** ISO date → the `YYYY-MM-DDTHH:MM` a datetime-local input wants. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

type Tab = 'compose' | 'queue' | 'calendar' | 'performance' | 'campaigns'

export default function MarketingPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('compose')
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
  const [campaign, setCampaign] = useState(DEFAULT_CAMPAIGN)
  const [busy, setBusy] = useState<string | null>(null)
  const [showConnect, setShowConnect] = useState(false)
  const [bskyHandle, setBskyHandle] = useState('')
  const [bskyPassword, setBskyPassword] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [showGenerate, setShowGenerate] = useState(false)
  const [blogs, setBlogs] = useState<BlogPostSummary[]>([])
  const [genBlogSlug, setGenBlogSlug] = useState('')
  const [genTopic, setGenTopic] = useState('')
  const [variants, setVariants] = useState<string[] | null>(null)
  const [performance, setPerformance] = useState<MarketingPerformance | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editSchedule, setEditSchedule] = useState('')
  const [campaignFilter, setCampaignFilter] = useState<string | null>(null)
  const [showLinkBuilder, setShowLinkBuilder] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchMarketingPosts(),
      fetchMarketingIntegrations(),
      fetchAutomationSettings(),
      fetchSocialConnections(),
      fetchMarketingPerformance(),
    ])
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
    if (connected) {
      const label = OAUTH_CHANNELS.find((o) => o.connector === connected)?.label ?? connected
      toast({ message: `${label} connected` })
      refreshChannels()
    } else if (err) {
      const label = OAUTH_CHANNELS.find((o) => o.connector === q.get('connect'))?.label ?? 'Channel'
      const hint =
        err === 'no_facebook_page'
          ? ' — no managed Facebook Page found'
          : err === 'no_instagram_business_account'
            ? ' — no Instagram Business account linked to your Page'
            : ''
      toast({
        message: `${label} connect failed: ${q.get('detail') ?? err}${hint}`,
        variant: 'error',
      })
    }
    window.history.replaceState({}, '', '/operator/marketing')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshChannels() {
    const [ints, conns] = await Promise.all([
      fetchMarketingIntegrations(),
      fetchSocialConnections(),
    ])
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

  async function connectOAuth(connectorId: string, label: string) {
    haptic('medium')
    setBusy(`connect-${connectorId}`)
    try {
      const res = await startConnectorConnect(connectorId)
      if (res?.auth_url) window.location.assign(res.auth_url)
      else
        toast({
          message: `${label} OAuth not configured — set its client credentials on the API`,
          variant: 'error',
        })
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
    setVariants(null)
    if (next && blogs.length === 0) setBlogs(await fetchBlogPosts().catch(() => []))
  }

  /** Preview 3 variants — nothing persists until the operator picks one
   *  and queues it through the normal create path. */
  async function generateVariants() {
    if (!selected) return
    if (!genBlogSlug && !genTopic.trim()) return
    haptic('medium')
    setBusy('generate')
    setVariants(null)
    try {
      const drafts = await previewMarketingDrafts({
        integration_id: selected.id,
        channel,
        campaign: campaign.trim() || DEFAULT_CAMPAIGN,
        count: 3,
        ...(genBlogSlug ? { blog_slug: genBlogSlug } : { topic: genTopic.trim() }),
      })
      if (drafts.length === 0) throw new Error('No drafts came back')
      setVariants(drafts)
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Generation failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const selected = (integrations ?? []).find((i) => i.id === integrationId)
  const channel = selected?.identifier ?? 'other'
  const selectedAccount = selected?.name ?? 'LifeKeel'
  const trustLevel = automation?.trust_level_by_workflow?.[trustScope(channel)] ?? 0
  const limit = channelLimit(channel)
  const overLimit = content.length > limit
  const mediaMode = channelMedia(channel)
  const mediaMissing = mediaMode === 'required' && !mediaUrl.trim()
  const pendingCount = posts.filter(
    (p) => p.state === 'draft' || p.state === 'publish_failed',
  ).length

  const knownCampaigns = useMemo(() => {
    const set = new Set<string>([DEFAULT_CAMPAIGN])
    for (const p of posts) if (p.campaign) set.add(p.campaign)
    for (const c of performance?.campaigns ?? []) set.add(c.campaign)
    return [...set].sort()
  }, [posts, performance])

  const visiblePosts = campaignFilter
    ? posts.filter((p) => (p.campaign ?? DEFAULT_CAMPAIGN) === campaignFilter)
    : posts

  async function submit() {
    if (!selected || !content.trim()) return
    const camp = campaign.trim() || DEFAULT_CAMPAIGN
    if (!CAMPAIGN_RE.test(camp)) {
      toast({
        message: 'Campaign names must be lowercase letters, numbers, - or _',
        variant: 'error',
      })
      return
    }
    haptic('medium')
    setBusy('create')
    try {
      const post = await createMarketingPost({
        integration_id: selected.id,
        channel,
        content: content.trim(),
        campaign: camp,
        ...(scheduleAt ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
        ...(mediaUrl.trim() ? { media_url: mediaUrl.trim() } : {}),
      })
      setPosts((p) => [post, ...p])
      setContent('')
      setScheduleAt('')
      setMediaUrl('')
      setTab('queue')
      toast({ message: post.state === 'published' ? 'Published' : 'Draft queued for review' })
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : "Couldn't save that draft",
        variant: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    haptic('light')
    setBusy(id)
    try {
      const post =
        action === 'approve' ? await approveMarketingPost(id) : await rejectMarketingPost(id)
      setPosts((p) => p.map((x) => (x.id === id ? post : x)))
      toast({ message: action === 'approve' ? 'Published' : 'Draft rejected' })
    } catch (err) {
      toast({
        message: err instanceof Error ? err.message : 'That did not work — try again',
        variant: 'error',
      })
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
      toast({
        message: err instanceof Error ? err.message : "Couldn't save that edit",
        variant: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">Marketing</h1>
        <p className="mt-1 text-sm text-ink-tertiary">
          Outbound posts — drafted, reviewed, published, measured.
        </p>
      </div>

      {loading && <div className="shimmer h-24 rounded-2xl" />}

      {!loading && (
        <>
          {/* Channels */}
          <GlassCard className="p-4">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-sm font-semibold text-ink-primary">Channels</p>
              <button
                onClick={() => setShowConnect((v) => !v)}
                className="text-xs font-semibold text-family-400"
              >
                {showConnect ? 'Close' : 'Connect a channel'}
              </button>
            </div>
            {(integrations ?? []).length === 0 ? (
              <p className="text-xs text-ink-tertiary leading-relaxed">
                Nothing connected yet — open "Connect a channel" above.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {(integrations ?? []).map((i) => {
                  const conn =
                    i.source === 'connection'
                      ? connections.find((c) => c.channel === i.identifier)
                      : undefined
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
                            {i.source === 'env' && (
                              <span className="text-ink-tertiary"> · server env</span>
                            )}
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
              <div className="mt-3 pt-3 border-t border-tint/[0.06] space-y-3">
                {/* OAuth channels — each appears until connected */}
                <div className="flex flex-wrap gap-2">
                  {OAUTH_CHANNELS.filter(
                    (o) => !(integrations ?? []).some((i) => i.identifier === o.channel),
                  ).map((o) => (
                    <button
                      key={o.connector}
                      onClick={() => connectOAuth(o.connector, o.label)}
                      disabled={busy === `connect-${o.connector}`}
                      className="rounded-full px-3.5 py-1.5 text-xs font-semibold border bg-tint/[0.04] border-tint/[0.08] text-ink-secondary hover:border-family-500/40 hover:text-family-300 disabled:opacity-40 transition-colors"
                    >
                      {busy === `connect-${o.connector}` ? 'Redirecting…' : `Connect ${o.label}`}
                    </button>
                  ))}
                  {OAUTH_CHANNELS.every((o) =>
                    (integrations ?? []).some((i) => i.identifier === o.channel),
                  ) && <p className="text-xs text-ink-tertiary">All OAuth channels connected.</p>}
                </div>
                <div>
                  <p className="text-caption text-ink-tertiary mb-1.5">Bluesky — app password</p>
                  <div className="space-y-2">
                    <input
                      value={bskyHandle}
                      onChange={(e) => setBskyHandle(e.target.value)}
                      placeholder="handle — e.g. keel.bsky.social"
                      className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                    />
                    <input
                      value={bskyPassword}
                      onChange={(e) => setBskyPassword(e.target.value)}
                      type="password"
                      placeholder="app password (bsky.app → Settings → App passwords)"
                      className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                    />
                    <GlassButton
                      onClick={connect}
                      disabled={busy === 'connect' || !bskyHandle.trim() || !bskyPassword.trim()}
                    >
                      {busy === 'connect' ? 'Verifying…' : 'Verify & connect'}
                    </GlassButton>
                  </div>
                </div>
                <p className="text-caption text-ink-tertiary leading-relaxed">
                  Facebook + Instagram need a Meta app (META_CLIENT_ID/SECRET) and a Page with a
                  linked Business account. Threads uses the same Meta app (or THREADS_CLIENT_ID).
                  LinkedIn needs a LinkedIn app with "Share on LinkedIn" enabled
                  (LINKEDIN_CLIENT_ID/SECRET). Mastodon runs off env: MASTODON_INSTANCE_URL +
                  MASTODON_ACCESS_TOKEN.
                </p>
              </div>
            )}
          </GlassCard>

          {/* Tabs */}
          <div className="flex gap-1.5 mt-5 mb-4 rounded-xl bg-tint/[0.03] border border-tint/[0.06] p-1">
            {(
              [
                ['compose', 'Compose'],
                ['queue', `Queue${pendingCount ? ` (${pendingCount})` : ''}`],
                ['calendar', 'Calendar'],
                ['performance', 'Performance'],
                ['campaigns', 'Campaigns'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                  tab === key
                    ? 'bg-family-500/20 text-family-300'
                    : 'text-ink-tertiary hover:text-ink-secondary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Compose */}
          {tab === 'compose' && (
            <GlassCard className="p-4">
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
                        overLimit
                          ? 'text-danger font-semibold'
                          : content.length > limit * 0.9
                            ? 'text-warning'
                            : 'text-ink-tertiary'
                      }`}
                    >
                      {content.length}/{limit === 5000 ? '∞' : limit}
                    </p>
                  </div>
                  <div className="mb-3">
                    <PostPreview
                      channel={channel}
                      content={content}
                      accountName={selectedAccount}
                    />
                  </div>
                  {mediaMode && (
                    <div className="mb-3">
                      <label className="block text-caption text-ink-tertiary mb-1">
                        Image URL{' '}
                        {mediaMode === 'required'
                          ? '— Instagram requires an image'
                          : '— optional, posts as a photo'}
                      </label>
                      <input
                        value={mediaUrl}
                        onChange={(e) => setMediaUrl(e.target.value)}
                        placeholder="https://… a public image URL"
                        className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                      />
                    </div>
                  )}
                  <div className="grid sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-caption text-ink-tertiary mb-1">
                        Schedule for later — optional
                      </label>
                      <input
                        type="datetime-local"
                        value={scheduleAt}
                        onChange={(e) => setScheduleAt(e.target.value)}
                        min={new Date().toISOString().slice(0, 16)}
                        className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-secondary outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-caption text-ink-tertiary mb-1">Campaign</label>
                      <input
                        list="marketing-campaigns"
                        value={campaign}
                        onChange={(e) => setCampaign(e.target.value)}
                        placeholder={DEFAULT_CAMPAIGN}
                        className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
                      />
                      <datalist id="marketing-campaigns">
                        {knownCampaigns.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <GlassButton
                    onClick={submit}
                    disabled={busy === 'create' || !content.trim() || overLimit || mediaMissing}
                  >
                    {busy === 'create'
                      ? 'Queueing…'
                      : scheduleAt
                        ? 'Queue scheduled draft'
                        : 'Queue draft'}
                  </GlassButton>
                  {scheduleAt && (
                    <p className="text-xs text-ink-tertiary mt-2 leading-relaxed">
                      Approving a scheduled draft publishes it at{' '}
                      {new Date(scheduleAt).toLocaleString()} — cancel it from the queue anytime
                      before then.
                    </p>
                  )}
                  <p className="text-xs text-ink-tertiary mt-2.5 leading-relaxed">
                    {`${Math.min(trustLevel, 5)}/5 approvals on ${channelLabel(channel)} so far — every publish stays a human tap; Keel never posts on its own.`}
                  </p>
                  <div className="mt-3 pt-3 border-t border-tint/[0.06]">
                    <button
                      onClick={openGenerator}
                      className="flex items-center gap-1.5 text-xs font-semibold text-family-400"
                    >
                      <Sparkles size={13} />
                      {showGenerate ? 'Close generator' : 'Generate variants with Keel'}
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
                        <GlassButton
                          onClick={generateVariants}
                          disabled={busy === 'generate' || (!genBlogSlug && !genTopic.trim())}
                        >
                          {busy === 'generate' ? 'Generating…' : 'Generate 3 variants'}
                        </GlassButton>
                        {variants && (
                          <div className="space-y-2 pt-1">
                            {variants.map((v, i) => (
                              <div
                                key={i}
                                className="rounded-xl border border-tint/[0.08] bg-tint/[0.02] p-3"
                              >
                                <p className="text-xs text-ink-primary leading-relaxed whitespace-pre-wrap">
                                  {v}
                                </p>
                                <button
                                  onClick={() => {
                                    setContent(v)
                                    setVariants(null)
                                    setShowGenerate(false)
                                    haptic('light')
                                  }}
                                  className="mt-2 text-xs font-semibold text-family-400"
                                >
                                  Use this draft →
                                </button>
                              </div>
                            ))}
                            <p className="text-caption text-ink-tertiary">
                              Picking one fills the composer — edit it, then queue.
                            </p>
                          </div>
                        )}
                        <label className="flex items-start gap-2 cursor-pointer pt-1">
                          <input
                            type="checkbox"
                            checked={automation?.daily_marketing_drafts_enabled === true}
                            onChange={async (e) => {
                              const next = await updateAutomationSettings({
                                daily_marketing_drafts_enabled: e.target.checked,
                              })
                              if (next && next !== 'queued') setAutomation(next)
                              toast({
                                message: e.target.checked
                                  ? 'Daily drafts on — one queued each morning'
                                  : 'Daily drafts off',
                              })
                            }}
                            className="mt-0.5 accent-family-500"
                          />
                          <span className="text-xs text-ink-secondary leading-relaxed">
                            Queue one for review every morning — promotes a blog post you haven't
                            pushed yet.
                          </span>
                        </label>
                        <p className="text-xs text-ink-tertiary leading-relaxed">
                          Generated drafts always wait for your approval — they never auto-publish.
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-tint/[0.06]">
                    <button
                      onClick={() => setShowLinkBuilder((v) => !v)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-family-400"
                    >
                      <Link2 size={13} />
                      {showLinkBuilder ? 'Close link builder' : 'Build a tracked link'}
                    </button>
                    {showLinkBuilder && (
                      <LinkBuilder blogs={blogs} campaigns={knownCampaigns} onToast={toast} />
                    )}
                  </div>
                </>
              )}
            </GlassCard>
          )}

          {/* Queue */}
          {tab === 'queue' && (
            <div className="space-y-3">
              {knownCampaigns.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setCampaignFilter(null)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                      campaignFilter === null
                        ? 'bg-family-500/20 border-family-500/40 text-family-300'
                        : 'bg-tint/[0.04] border-tint/[0.08] text-ink-secondary'
                    }`}
                  >
                    All
                  </button>
                  {knownCampaigns.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCampaignFilter(campaignFilter === c ? null : c)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                        campaignFilter === c
                          ? 'bg-family-500/20 border-family-500/40 text-family-300'
                          : 'bg-tint/[0.04] border-tint/[0.08] text-ink-secondary'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              {visiblePosts.length === 0 && (
                <GlassCard className="p-4">
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    Nothing queued yet — write a draft or generate variants in Compose.
                  </p>
                </GlassCard>
              )}
              {visiblePosts.map((post) => (
                <GlassCard key={post.id} className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-caption font-bold uppercase tracking-wide rounded-full px-2 py-0.5 border ${STATE_STYLE[post.state]}`}
                    >
                      {STATE_LABEL[post.state]}
                    </span>
                    <span className="text-caption text-ink-tertiary">
                      {channelLabel(post.channel)}
                    </span>
                    {post.campaign && post.campaign !== DEFAULT_CAMPAIGN && (
                      <span className="text-caption text-family-400">{post.campaign}</span>
                    )}
                    {post.auto_published && (
                      <span className="text-caption text-family-400">auto</span>
                    )}
                    {post.generated && (
                      <span className="text-caption text-ink-tertiary">ai draft</span>
                    )}
                    {post.dry_run && (
                      <span className="text-caption text-ink-tertiary">dry run</span>
                    )}
                    {(post.state === 'draft' || post.state === 'publish_failed') &&
                      editingId !== post.id && (
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
                      <p
                        className={`text-caption tabular-nums mt-1 text-right ${editContent.length > channelLimit(post.channel) ? 'text-danger font-semibold' : 'text-ink-tertiary'}`}
                      >
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
                          disabled={
                            busy === `edit:${post.id}` ||
                            !editContent.trim() ||
                            editContent.length > channelLimit(post.channel)
                          }
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
                    <p className="text-sm text-ink-primary leading-relaxed whitespace-pre-wrap">
                      {post.content}
                    </p>
                  )}
                  {post.publish_error && (
                    <p className="text-xs text-danger mt-2 leading-snug">{post.publish_error}</p>
                  )}
                  {post.copy_check && !post.copy_check.ok && (post.state === 'draft' || post.state === 'publish_failed') && (
                    <p role="alert" className="text-xs text-danger mt-2 leading-snug">
                      Fails the copy guard, so it cannot be approved until edited:{' '}
                      {post.copy_check.violations.map((v) => `${v.rule} ("${v.match}")`).join('; ')}
                    </p>
                  )}
                  {(post.state === 'draft' || post.state === 'publish_failed') &&
                    editingId !== post.id && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => decide(post.id, 'approve')}
                          disabled={busy === post.id || post.copy_check?.ok === false}
                          className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold bg-family-500/15 border border-family-500/25 text-family-400 disabled:opacity-40"
                        >
                          {busy === post.id ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Send size={15} />
                          )}
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
                        {post.scheduled_at
                          ? `Scheduled for ${new Date(post.scheduled_at).toLocaleString()}`
                          : 'Approved — publishes on the next sweep'}
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
                          {post.metrics.likes ?? 0} likes · {post.metrics.reposts ?? 0} reposts ·{' '}
                          {post.metrics.replies ?? 0} replies
                        </span>
                      )}
                      {post.external_url && (
                        <a
                          href={post.external_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-family-400 font-semibold"
                        >
                          View post ↗
                        </a>
                      )}
                    </div>
                  )}
                </GlassCard>
              ))}
            </div>
          )}

          {/* Calendar */}
          {tab === 'calendar' && <PostCalendar posts={posts} />}

          {/* Performance */}
          {tab === 'performance' && (
            <>
              {performance &&
              (performance.totals.views > 0 ||
                performance.totals.signups > 0 ||
                performance.channels.length > 0) ? (
                <div className="space-y-4">
                  <GlassCard className="p-4">
                    <div className="flex gap-4 mb-1 text-center">
                      <div>
                        <p className="text-lg font-bold text-ink-primary">
                          {performance.totals.views}
                        </p>
                        <p className="text-caption text-ink-tertiary">views</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-ink-primary">
                          {performance.totals.cta_clicks}
                        </p>
                        <p className="text-caption text-ink-tertiary">CTA taps</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-ink-primary">
                          {performance.totals.leads}
                        </p>
                        <p className="text-caption text-ink-tertiary">leads</p>
                      </div>
                      <div>
                        <p className="text-lg font-bold text-success">
                          {performance.totals.signups}
                        </p>
                        <p className="text-caption text-ink-tertiary">signups</p>
                      </div>
                    </div>
                    {performance.totals.views > 0 && (
                      <p className="text-caption text-ink-tertiary">
                        {((performance.totals.cta_clicks / performance.totals.views) * 100).toFixed(
                          1,
                        )}
                        % view→CTA
                        {performance.totals.cta_clicks > 0 &&
                          ` · ${((performance.totals.signups / performance.totals.cta_clicks) * 100).toFixed(1)}% CTA→signup`}
                      </p>
                    )}
                  </GlassCard>
                  {performance.channels.length > 0 && (
                    <GlassCard className="p-4">
                      <p className="text-caption font-semibold text-ink-tertiary mb-2">
                        Channel funnel — where the clicks actually convert
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-ink-tertiary">
                              <th className="pb-2 font-medium">Channel</th>
                              <th className="pb-2 text-right font-medium">Views</th>
                              <th className="pb-2 text-right font-medium">CTA</th>
                              <th className="pb-2 text-right font-medium">Leads</th>
                              <th className="pb-2 text-right font-medium">Signups</th>
                              <th className="pb-2 text-right font-medium">View→signup</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-tint/[0.06]">
                            {performance.channels.map((c) => (
                              <tr key={c.channel}>
                                <td className="py-2 font-medium text-ink-primary">{c.channel}</td>
                                <td className="py-2 text-right text-ink-secondary">{c.views}</td>
                                <td className="py-2 text-right text-ink-secondary">
                                  {c.cta_clicks}
                                </td>
                                <td className="py-2 text-right text-ink-secondary">{c.leads}</td>
                                <td className="py-2 text-right font-semibold text-success">
                                  {c.signups}
                                </td>
                                <td className="py-2 text-right text-ink-tertiary">
                                  {c.views > 0
                                    ? `${((c.signups / c.views) * 100).toFixed(1)}%`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </GlassCard>
                  )}
                  {performance.campaigns.length > 0 && (
                    <GlassCard className="p-4">
                      <p className="text-caption font-semibold text-ink-tertiary mb-2">Campaigns</p>
                      <ul className="space-y-1.5">
                        {performance.campaigns.map((c) => (
                          <li
                            key={c.campaign}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-ink-secondary truncate">{c.campaign}</span>
                            <span className="text-ink-tertiary shrink-0">
                              {c.views}v · {c.leads}l ·{' '}
                              <span className="text-success">{c.signups}s</span>
                              {c.views > 0 && (
                                <span className="ml-1">
                                  ({((c.signups / c.views) * 100).toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </GlassCard>
                  )}
                  <GlassCard className="p-4">
                    <p className="text-caption font-semibold text-ink-tertiary mb-2">
                      Top content — the learning loop reads this same ranking
                    </p>
                    <ul className="space-y-1.5">
                      {performance.posts.slice(0, 8).map((p) => (
                        <li
                          key={p.slug}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-ink-secondary truncate">{p.title ?? p.slug}</span>
                          <span className="text-ink-tertiary shrink-0">
                            {p.views}v · {p.cta_clicks}c · {p.leads}l ·{' '}
                            <span className="text-success">{p.signups}s</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                  {(performance.insights.measured_posts > 0 ||
                    performance.insights.unmeasured_channels.length > 0) && (
                    <GlassCard className="p-4">
                      <p className="text-caption font-semibold text-ink-tertiary mb-1">
                        What works
                      </p>
                      <p className="text-caption text-ink-tertiary mb-3">
                        Engagement vs. this account&apos;s own median across{' '}
                        {performance.insights.measured_posts} measured
                        {performance.insights.measured_posts === 1 ? ' post' : ' posts'} — providers
                        don&apos;t expose impressions, so multipliers are relative, not absolute
                        rates.
                      </p>
                      {performance.insights.rows.length > 0 ? (
                        <ul className="space-y-1.5">
                          {performance.insights.rows.map((r) => (
                            <li
                              key={r.label}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <span className="text-ink-secondary">{r.label}</span>
                              <span
                                className={`shrink-0 font-semibold tabular-nums ${r.engagement_x >= 1 ? 'text-success' : 'text-danger'}`}
                              >
                                {r.engagement_x}×{' '}
                                <span className="font-normal text-ink-tertiary">
                                  ({r.measured} posts)
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-ink-tertiary">
                          No trait separates winners from flops yet — keep publishing.
                        </p>
                      )}
                      {performance.insights.top_post && (
                        <p className="text-xs text-ink-secondary mt-3 pt-3 border-t border-tint/[0.06]">
                          Best post:{' '}
                          <span className="text-ink-tertiary">
                            [{performance.insights.top_post.channel}]
                          </span>{' '}
                          &ldquo;{performance.insights.top_post.excerpt}&rdquo;{' '}
                          <span className="text-success">
                            ({performance.insights.top_post.engagement} engagement)
                          </span>
                        </p>
                      )}
                      {performance.insights.unmeasured_channels.length > 0 && (
                        <p className="text-caption text-ink-tertiary mt-2">
                          Unmeasured: {performance.insights.unmeasured_channels.join(', ')} — their
                          APIs can&apos;t be polled for engagement yet.
                        </p>
                      )}
                    </GlassCard>
                  )}
                </div>
              ) : (
                <GlassCard className="p-4">
                  <p className="text-sm text-ink-secondary leading-relaxed">
                    No attributed traffic yet — published posts carry UTM'd links, and views, CTA
                    taps, leads and signups land here once posts go out.
                  </p>
                </GlassCard>
              )}
            </>
          )}

          {/* Campaigns — one-shot targeted email to filtered cohorts */}
          {tab === 'campaigns' && <CampaignsPanel />}
        </>
      )}
    </div>
  )
}

function trustScope(channel: string): string {
  return `marketing_social:${channel}`
}

/** UTM link builder — share-ready tracked URLs with the same convention
 *  the publisher stamps (utm_source=channel, utm_medium, utm_campaign,
 *  utm_content=slug) so clicks land in attribution and the funnel joins
 *  them back to the channel. Presets enforce naming hygiene — free text
 *  stays possible for off-preset sources. */
const LINK_SOURCE_PRESETS = [
  'x',
  'linkedin',
  'bluesky',
  'threads',
  'facebook',
  'instagram',
  'newsletter',
  'bio',
]
const LINK_MEDIUM_PRESETS = ['social', 'newsletter', 'referral', 'bio', 'paid']
const LINK_PATH_PRESETS = ['/', '/guides', '/signup']

function LinkBuilder({
  blogs,
  campaigns,
  onToast,
}: {
  blogs: BlogPostSummary[]
  campaigns: string[]
  onToast: (t: { message: string }) => void
}) {
  const [base, setBase] = useState('')
  const [path, setPath] = useState('/guides')
  const [source, setSource] = useState('x')
  const [medium, setMedium] = useState('social')
  const [camp, setCamp] = useState(DEFAULT_CAMPAIGN)
  const [contentTag, setContentTag] = useState('')

  useEffect(() => {
    if (!base && typeof window !== 'undefined') setBase(window.location.origin)
  }, [base])

  // utm_content convention: the blog slug for promoted posts, so the
  // performance rollup can join traffic back to the post.
  useEffect(() => {
    const slug = /^\/blog\/([^/?#]+)/.exec(path)?.[1]
    if (slug) setContentTag(slug)
  }, [path])

  const url = useMemo(() => {
    const b = base.trim().replace(/\/$/, '')
    if (!b || !path.trim()) return ''
    try {
      const u = new URL(`${b}${path.startsWith('/') ? path : `/${path}`}`)
      u.searchParams.set('utm_source', source.trim())
      u.searchParams.set('utm_medium', medium)
      u.searchParams.set('utm_campaign', camp.trim() || DEFAULT_CAMPAIGN)
      if (contentTag.trim()) u.searchParams.set('utm_content', contentTag.trim())
      return u.toString()
    } catch {
      return ''
    }
  }, [base, path, source, medium, camp, contentTag])

  const copy = async () => {
    if (!url) return
    await navigator.clipboard.writeText(url)
    haptic('light')
    onToast({ message: 'Link copied' })
  }

  return (
    <div className="mt-2.5 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-caption text-ink-tertiary mb-1">Destination base</label>
          <input
            value={base}
            onChange={(e) => setBase(e.target.value)}
            placeholder="https://lifekeel.co.uk"
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
          />
        </div>
        <div>
          <label className="block text-caption text-ink-tertiary mb-1">Path</label>
          <input
            list="link-paths"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary outline-none"
          />
          <datalist id="link-paths">
            {LINK_PATH_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
            {blogs.map((b) => (
              <option key={b.slug} value={`/blog/${b.slug}`}>
                {b.title}
              </option>
            ))}
          </datalist>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-caption text-ink-tertiary mb-1">Source (channel)</label>
          <input
            list="link-sources"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary outline-none"
          />
          <datalist id="link-sources">
            {LINK_SOURCE_PRESETS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-caption text-ink-tertiary mb-1">Medium</label>
          <select
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary outline-none"
          >
            {LINK_MEDIUM_PRESETS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-caption text-ink-tertiary mb-1">Campaign</label>
          <input
            list="link-campaigns"
            value={camp}
            onChange={(e) => setCamp(e.target.value)}
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary outline-none"
          />
          <datalist id="link-campaigns">
            {campaigns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-caption text-ink-tertiary mb-1">Content tag</label>
          <input
            value={contentTag}
            onChange={(e) => setContentTag(e.target.value)}
            placeholder="slug or variant id"
            className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
          />
        </div>
      </div>
      {url && (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-xl border border-tint/[0.08] bg-tint/[0.02] px-3 py-2 text-xs text-ink-secondary">
            {url}
          </code>
          <GlassButton onClick={copy}>Copy</GlassButton>
        </div>
      )}
      <p className="text-caption text-ink-tertiary leading-relaxed">
        Keep <span className="font-semibold">medium = social</span> for channel posts — the
        performance tab only joins utm_medium=social traffic.
      </p>
    </div>
  )
}

/** One-shot targeted email — operator drafts copy, previews the audience,
 *  fires the send. Drafts render the filter as chips; sent campaigns show
 *  their delivery stats. */
function CampaignsPanel() {
  const toast = useToast()
  const [campaigns, setCampaigns] = useState<OperatorCampaign[] | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [audience, setAudience] = useState<CampaignFilter['audience']>('users')
  const [planFilter, setPlanFilter] = useState('')
  const [trialing, setTrialing] = useState('')
  const [hasProfile, setHasProfile] = useState('')
  const [sources, setSources] = useState('')
  const [preview, setPreview] = useState<{ count: number; users: number; leads: number } | null>(
    null,
  )
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    fetchOperatorCampaigns()
      .then((r) => setCampaigns(r.campaigns))
      .catch(() => setCampaigns([]))
  }, [])

  function buildFilter(): CampaignFilter {
    const f: CampaignFilter = { audience }
    if (planFilter) f.plans = [planFilter]
    if (trialing === 'only') f.trialing = true
    if (trialing === 'exclude') f.trialing = false
    if (hasProfile === 'yes') f.has_profile = true
    if (hasProfile === 'no') f.has_profile = false
    const srcs = sources
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (srcs.length > 0) f.utm_sources = srcs
    return f
  }

  async function runPreview() {
    setBusy('preview')
    try {
      setPreview(await previewCampaignAudience(buildFilter()))
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Preview failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function create(reason: string) {
    setBusy('create')
    try {
      await createCampaign(
        {
          name: name.trim(),
          subject: subject.trim(),
          body_text: body.trim(),
          ...(ctaUrl.trim() ? { cta_url: ctaUrl.trim() } : {}),
          ...(ctaLabel.trim() ? { cta_label: ctaLabel.trim() } : {}),
          filter: buildFilter(),
        },
        reason,
      )
      toast({ message: 'Campaign draft created' })
      setShowCreate(false)
      setName('')
      setSubject('')
      setBody('')
      setCtaUrl('')
      setCtaLabel('')
      setPreview(null)
      const r = await fetchOperatorCampaigns()
      setCampaigns(r.campaigns)
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : 'Create failed', variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function send(id: string, reason: string) {
    await sendCampaignNow(id, reason)
    toast({ message: 'Campaign queued — recipients send in the background' })
    const r = await fetchOperatorCampaigns()
    setCampaigns(r.campaigns)
  }

  async function pause(id: string, reason: string) {
    await pauseCampaignSend(id, reason)
    toast({ message: 'Campaign paused — pending recipients hold' })
    const r = await fetchOperatorCampaigns()
    setCampaigns(r.campaigns)
  }

  async function resume(id: string, reason: string) {
    await resumeCampaignSend(id, reason)
    toast({ message: 'Campaign resumed' })
    const r = await fetchOperatorCampaigns()
    setCampaigns(r.campaigns)
  }

  const selectCls = 'glass-input w-full rounded-xl px-3 py-2 text-sm text-ink-primary outline-none'

  return (
    <div className="space-y-4">
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-ink-primary">Email campaigns</p>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="text-xs font-semibold text-family-400"
          >
            {showCreate ? 'Close' : 'New campaign'}
          </button>
        </div>
        <p className="text-caption text-ink-tertiary leading-relaxed">
          One-shot email to a filtered cohort — users honor <code>email_opt_out</code>, leads honor
          consent + suppression. The send button is the approval gate: once fired, a campaign
          can&apos;t re-send.
        </p>

        {showCreate && (
          <div className="mt-3 pt-3 border-t border-tint/[0.06] space-y-2.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Campaign name — e.g. trial-nudge-march"
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
            />
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              placeholder={
                'Body — blank lines split paragraphs.\nUse {{first_name}} to personalize.'
              }
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none resize-y"
            />
            <div className="flex gap-2">
              <input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="CTA URL (optional)"
                className="glass-input flex-1 rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
              />
              <input
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="CTA label"
                className="glass-input w-40 rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as CampaignFilter['audience'])}
                className={selectCls}
              >
                <option value="users">Users only</option>
                <option value="leads">Leads only</option>
                <option value="both">Users + leads</option>
              </select>
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className={selectCls}
              >
                <option value="">Any plan</option>
                <option value="free">Free</option>
                <option value="starter">Keel Plus</option>
              </select>
              <select
                value={trialing}
                onChange={(e) => setTrialing(e.target.value)}
                className={selectCls}
              >
                <option value="">Trial: any</option>
                <option value="only">Trialing only</option>
                <option value="exclude">Not trialing</option>
              </select>
              <select
                value={hasProfile}
                onChange={(e) => setHasProfile(e.target.value)}
                className={selectCls}
              >
                <option value="">Profile: any</option>
                <option value="yes">Has profile</option>
                <option value="no">No profile</option>
              </select>
            </div>
            <input
              value={sources}
              onChange={(e) => setSources(e.target.value)}
              placeholder="utm_source filter — comma-separated, optional"
              className="glass-input w-full rounded-xl px-4 py-2.5 text-sm text-ink-primary placeholder:text-ink-tertiary outline-none"
            />

            <div className="flex items-center gap-3">
              <button
                onClick={runPreview}
                disabled={busy === 'preview'}
                className="rounded-lg border border-tint/[0.1] px-3 py-1.5 text-xs font-medium text-ink-secondary hover:text-ink-primary disabled:opacity-40"
              >
                {busy === 'preview' ? 'Counting…' : 'Preview audience'}
              </button>
              {preview && (
                <p className="text-xs text-ink-secondary">
                  <span className="font-semibold text-ink-primary">{preview.count}</span> recipients
                  <span className="text-ink-tertiary">
                    {' '}
                    ({preview.users} users · {preview.leads} leads)
                  </span>
                </p>
              )}
            </div>

            <ReasonAction
              label="Create draft"
              description="Creates a draft — nothing sends until you fire it from the list below."
              onConfirm={async (reason) => {
                if (
                  name.trim().length < 3 ||
                  subject.trim().length < 3 ||
                  body.trim().length < 20
                ) {
                  throw new Error('Name, subject, and a 20+ character body are required')
                }
                await create(reason)
              }}
            />
          </div>
        )}
      </GlassCard>

      {campaigns === null ? (
        <div className="shimmer h-20 rounded-2xl" />
      ) : campaigns.length === 0 ? (
        <GlassCard className="p-4">
          <p className="text-sm text-ink-secondary">
            No campaigns yet — the lifecycle sequences handle the always-on mail; campaigns are for
            the moments in between.
          </p>
        </GlassCard>
      ) : (
        <GlassCard className="p-4">
          <ul className="space-y-3">
            {campaigns.map((c) => (
              <li key={c.id} className="border-b border-tint/[0.06] last:border-0 pb-3 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-primary truncate">{c.name}</p>
                    <p className="text-xs text-ink-tertiary truncate">{c.subject}</p>
                    <p className="text-caption text-ink-tertiary mt-0.5">
                      {c.filter.audience}
                      {c.filter.plans?.length ? ` · ${c.filter.plans.join(',')}` : ''}
                      {c.filter.trialing !== undefined
                        ? c.filter.trialing
                          ? ' · trialing'
                          : ' · not trialing'
                        : ''}
                      {c.filter.has_profile !== undefined
                        ? c.filter.has_profile
                          ? ' · has profile'
                          : ' · no profile'
                        : ''}
                      {c.filter.utm_sources?.length
                        ? ` · src: ${c.filter.utm_sources.join(',')}`
                        : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {c.status === 'sending' || c.status === 'paused' ? (
                      <div className="space-y-1">
                        <p className="text-xs text-ink-tertiary">
                          {c.status === 'sending' ? 'sending' : 'paused'}{' '}
                          {c.stats ? `${c.stats.settled ?? 0}/${c.stats.targeted} settled` : ''}
                          {c.stats?.failed ? (
                            <span className="text-danger"> · {c.stats.failed} failed</span>
                          ) : (
                            ''
                          )}
                        </p>
                        {c.status === 'sending' ? (
                          <ReasonAction
                            label="Pause"
                            description="Stops dispatching new recipient sends. Claimed-but-unsent recipients stay queued until you resume."
                            onConfirm={(reason) => pause(c.id, reason)}
                          />
                        ) : (
                          <ReasonAction
                            label="Resume"
                            description="Re-queues every still-pending recipient send."
                            onConfirm={(reason) => resume(c.id, reason)}
                          />
                        )}
                      </div>
                    ) : c.status === 'sent' ? (
                      <p className="text-xs text-ink-tertiary">
                        sent {c.stats ? `${c.stats.sent}/${c.stats.targeted}` : ''}
                        {c.stats?.failed ? (
                          <span className="text-danger"> ({c.stats.failed} failed)</span>
                        ) : (
                          ''
                        )}
                        {c.engagement && (
                          <span>
                            {' · '}
                            {c.engagement.opened} opened · {c.engagement.clicked} clicked
                            {c.engagement.bounced ? (
                              <span className="text-danger"> · {c.engagement.bounced} bounced</span>
                            ) : (
                              ''
                            )}
                          </span>
                        )}
                      </p>
                    ) : (
                      <ReasonAction
                        label="Send now"
                        destructive
                        description="One-shot — sends real email to the matching audience and can't be re-run."
                        onConfirm={(reason) => send(c.id, reason)}
                      />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  )
}
