'use client'

/**
 * Home: the family's newest brief and its one-line answer, so the first screen leads with something real the
 * family made rather than a score. States what the figures showed on the day and, if they have since changed,
 * says so. Renders nothing when there is no brief or the list cannot be read.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { listBriefs, type HouseholdBrief } from '@/lib/api'
import { briefHeadline, splitBriefSentence } from '@/lib/brief-text'
import { briefNextLine } from '@/lib/brief-status'

export function LatestBriefCard() {
  const [brief, setBrief] = useState<HouseholdBrief | null>(null)

  useEffect(() => {
    let cancelled = false
    void listBriefs()
      .then((all) => {
        if (cancelled) return
        const newest = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        setBrief(newest ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!brief || !brief.template_sentence?.trim()) return null
  return (
    <Link href="/briefs" className="block">
      <GlassCard className="flex items-start gap-3 p-4">
        <FileText size={20} className="mt-0.5 shrink-0 text-family-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-ink-tertiary">
            Your latest brief
          </span>
          <span className="mt-1 block font-medium text-ink-primary">
            {brief.title ?? 'Your brief'}
          </span>
          <span className="block text-sm text-ink-secondary">
            {briefHeadline(splitBriefSentence(brief.template_sentence).main)}
          </span>
          <span className="mt-1 block text-sm text-ink-tertiary">{briefNextLine(brief)}</span>
          {brief.stale && (
            <span className="mt-1 block text-sm text-ink-secondary">
              The figures have changed since. Open it to see the new answer.
            </span>
          )}
        </span>
        <ChevronRight size={18} className="mt-1 shrink-0 text-ink-tertiary" aria-hidden="true" />
      </GlassCard>
    </Link>
  )
}
