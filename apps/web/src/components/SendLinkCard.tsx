'use client'

import { Share2 } from 'lucide-react'
import { GlassCard } from '@/components/Glass'

export function SendLinkCard({
  name,
  member,
  busy,
  onShare,
  onClose,
}: {
  name: string
  member: { id: string } | undefined
  busy: boolean
  onShare: (memberId: string) => void
  onClose: () => void
}) {
  const first = name.split(' ')[0]
  return (
    <GlassCard className="p-4">
      <div data-testid="send-link-card">
        <div className="text-base font-semibold text-ink-primary">{first} is on the list</div>
        <p className="mt-1 text-sm text-ink-secondary">
          Send {first} the link. They open it, see the same list, and confirm they have looked.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={!member || busy}
            onClick={() => member && onShare(member.id)}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-family-500 px-5 text-sm font-semibold text-[rgb(var(--on-cta))] disabled:opacity-50 active:opacity-80"
          >
            <Share2 size={16} aria-hidden="true" />
            {busy ? 'Making the link…' : `Send ${first} the link`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] rounded-full px-4 text-sm font-medium text-ink-tertiary active:bg-tint/10"
          >
            Later
          </button>
        </div>
      </div>
    </GlassCard>
  )
}
