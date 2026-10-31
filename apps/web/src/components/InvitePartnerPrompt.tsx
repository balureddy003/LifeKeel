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
import { fetchAccessRequests, type AccessRequest } from '@/lib/api'

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
          href="/settings?add=1"
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

/**
 * What the organizer sees about a partner: someone waiting to be let in comes
 * first (they have already done their part), otherwise the weekly invite
 * prompt. Approving stays in Settings, because it is the one step that grants
 * access to the family's records.
 */
export function PartnerCard() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchAccessRequests()
      .then((r) => !cancelled && setRequests(r))
      .catch(() => !cancelled && setRequests([]))
    return () => {
      cancelled = true
    }
  }, [])
  if (requests === null) return null
  if (requests.length === 0) return <InvitePartnerPrompt />
  const first = requests[0]!.name
  const who = requests.length === 1 ? first : `${first} and ${requests.length - 1} more`
  return (
    <GlassCard className="p-4" data-testid="join-request-card">
      <p className="text-sm text-ink-primary font-semibold">{who} asked to join your family</p>
      <p className="text-xs text-ink-secondary mt-1">
        They cannot see anything until you approve. Check it is who you expect first.
      </p>
      <Link
        href="/settings?requests=1"
        className="mt-3 inline-block rounded-xl px-3 py-2 text-sm font-semibold bg-family-500 text-white"
      >
        Review {requests.length === 1 ? 'request' : 'requests'}
      </Link>
    </GlassCard>
  )
}
