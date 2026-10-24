'use client'

/**
 * PRD-220: one calm card inviting the partner onto the family — shown at most
 * once a week, gone after two dismissals, never when a second member already
 * shows as joined. Dismissal state is local-only (no profile of the prompt).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { GlassCard } from '@/components/Glass'
import { useAuth } from '@/lib/auth-context'
import { track } from '@/lib/growth-track'

const KEY = 'lifekeel_invite_prompt_v1'

export function InvitePartnerPrompt() {
  const { family } = useAuth()
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      const members = family?.members ?? []
      const joined = members.filter((m) => (m as { joined?: boolean }).joined !== false).length
      if (joined >= 2) return
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
        dismissals?: number
        last?: number
      }
      if ((raw.dismissals ?? 0) >= 2) return
      if (raw.last && Date.now() - raw.last < 7 * 24 * 3600 * 1000) return
      localStorage.setItem(KEY, JSON.stringify({ ...raw, last: Date.now() }))
      setShow(true)
      track('invite_prompt_shown', { src: 'prompt' })
    } catch {
      /* localStorage locked down — skip quietly */
    }
  }, [family])

  if (!show) return null
  return (
    <GlassCard className="p-4" data-testid="invite-partner-prompt">
      <p className="text-sm text-ink-primary font-semibold">
        Add your partner so they can see this too
      </p>
      <p className="text-xs text-ink-secondary mt-1">
        If something happens, the chart only helps if someone else can find it.
      </p>
      <div className="flex gap-2 mt-3">
        <Link
          href="/family"
          onClick={() => track('invite_prompt_clicked', { src: 'prompt' })}
          className="rounded-xl px-3 py-2 text-sm font-semibold bg-family-500 text-white"
        >
          Invite your partner
        </Link>
        <button
          onClick={() => {
            const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { dismissals?: number }
            localStorage.setItem(
              KEY,
              JSON.stringify({ ...raw, dismissals: (raw.dismissals ?? 0) + 1, last: Date.now() }),
            )
            setShow(false)
          }}
          className="rounded-xl px-3 py-2 text-sm text-ink-secondary"
        >
          Not now
        </button>
      </div>
    </GlassCard>
  )
}
