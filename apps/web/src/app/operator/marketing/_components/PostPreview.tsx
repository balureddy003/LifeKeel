'use client'

/**
 * Channel-styled preview of a post before it queues — operators should see
 * roughly what followers will. Not pixel-perfect (each client renders
 * differently), just enough to catch truncation, link placement, and tone.
 */

import { Heart, MessageCircle, Repeat2, BarChart3 } from 'lucide-react'
import type { MarketingPost } from '@/lib/api'

const CHANNEL_LABEL: Record<string, string> = {
  x: 'X',
  bluesky: 'Bluesky',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  mastodon: 'Mastodon',
}

/** Renders the post text with URLs tinted, like the channels do. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <span key={i} className="text-family-400 break-all">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export function PostPreview({ channel, content, accountName }: { channel: string; content: string; accountName?: string }) {
  return (
    <div className="rounded-xl border border-tint/[0.08] bg-tint/[0.02] p-4">
      <div className="flex items-center gap-3 mb-2.5">
        <div className="w-9 h-9 rounded-full bg-family-500/25 border border-family-500/30 flex items-center justify-center text-xs font-bold text-family-300 shrink-0">
          AO
        </div>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-ink-primary truncate">{accountName || 'Agent Oak'}</p>
          <p className="text-xs text-ink-tertiary truncate">{CHANNEL_LABEL[channel] ?? channel} preview</p>
        </div>
      </div>
      <p className="text-sm text-ink-primary leading-relaxed whitespace-pre-wrap">
        {content ? <Linkified text={content} /> : <span className="text-ink-tertiary">Your post preview…</span>}
      </p>
      <div className="flex items-center gap-6 mt-3 pt-3 border-t border-tint/[0.06] text-ink-tertiary">
        <MessageCircle size={14} />
        <Repeat2 size={14} />
        <Heart size={14} />
        <BarChart3 size={14} />
      </div>
    </div>
  )
}

export type { MarketingPost }
