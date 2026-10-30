'use client'

/**
 * Home-screen state for a brief that has been sent but not yet read by the other
 * adult. It is the only surface that mentions the wait: no email, no push, and
 * it disappears the moment they confirm or the link is turned off.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Clock } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { listBriefs, type HouseholdBrief } from '@/lib/api'

export function BriefWaitingCard() {
  const [brief, setBrief] = useState<HouseholdBrief | null>(null)

  useEffect(() => {
    let cancelled = false
    void listBriefs().then((all) => {
      if (cancelled) return
      setBrief(
        all.find(
          (b) =>
            b.confirmation?.creator_at &&
            !b.confirmation.recipient_at &&
            b.share &&
            !b.share.revoked,
        ) ?? null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!brief) return null
  const other = brief.share?.for_member_name ?? 'the other adult'
  return (
    <Link href="/briefs" className="mt-4 block">
      <GlassCard className="flex items-center gap-3 p-4">
        <Clock size={20} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-ink-primary">Waiting for {other}</span>
          <span className="block truncate text-sm text-ink-secondary">
            {brief.title ?? 'Your brief'} has not been read yet
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
      </GlassCard>
    </Link>
  )
}
