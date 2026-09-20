'use client'

/**
 * /marketing — the review queue for outbound social posts. Drafts land here
 * (composed below now, generated daily once the content pipeline ships);
 * Approve publishes via Postiz, Reject kills the draft. The trust line under
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
  type MarketingIntegration,
  type MarketingPost,
  type AutomationSettings,
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
  // null = Postiz not configured; [] = configured, no channels; the `loading`
  // gate above keeps the pre-fetch null from flashing the "not configured" copy.
  const [integrations, setIntegrations] = useState<MarketingIntegration[] | null>(null)
  const [automation, setAutomation] = useState<AutomationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [integrationId, setIntegrationId] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchMarketingPosts(), fetchMarketingIntegrations(), fetchAutomationSettings()])
      .then(([p, i, a]) => {
        setPosts(p)
        setIntegrations(i)
        setAutomation(a)
        const first = (i ?? []).find((x) => !x.disabled)
        if (first) setIntegrationId(first.id)
      })
      .finally(() => setLoading(false))
  }, [])

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
          {/* Composer */}
          <GlassCard className="p-4 mt-4">
            {integrations === null ? (
              <p className="text-sm text-ink-secondary leading-relaxed">
                Postiz isn&apos;t configured on the API yet — set <code className="text-family-400">POSTIZ_API_KEY</code> and
                connect a channel in Postiz, then drafts can publish from here.
              </p>
            ) : integrations.length === 0 ? (
              <p className="text-sm text-ink-secondary leading-relaxed">
                Postiz is connected but has no channels yet — connect an account in Postiz first.
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
