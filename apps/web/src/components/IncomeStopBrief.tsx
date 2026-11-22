'use client'

/**
 * One door for "what if income stops". Every other screen that asks it (What If › Lost my job, Finances › If
 * income stops) shows this card first: the family's saved income brief and its answer, or a way to make one.
 * The brief is the one place the answer is worked out, so the other screens no longer give a second number.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { listBriefs, type HouseholdBrief } from '@/lib/api'
import { briefHeadline, splitBriefSentence } from '@/lib/brief-text'

/** The brief situations that answer "how long would our savings last if income stops or falls". */
export const INCOME_BRIEFS = new Set(['income_stops', 'earning_less', 'job_change'])

export function IncomeStopBrief() {
  // undefined while loading, so the card does not flash "make one" before a saved brief arrives.
  const [brief, setBrief] = useState<HouseholdBrief | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void listBriefs()
      .then((all) => {
        if (cancelled) return
        const newest = all
          .filter((b) => INCOME_BRIEFS.has(b.problem_type) && b.template_sentence?.trim())
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
        setBrief(newest ?? null)
      })
      .catch(() => !cancelled && setBrief(null))
    return () => {
      cancelled = true
    }
  }, [])

  if (brief === undefined) return null
  return (
    <Link
      href={brief ? '/briefs' : '/briefs?start=income_stops'}
      className="block"
      data-testid="income-stop-brief"
    >
      <GlassCard className="flex items-start gap-3 p-4">
        <FileText size={20} className="mt-0.5 shrink-0 text-family-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-ink-tertiary">
            {brief ? 'Your brief' : 'Work it out with your own dates'}
          </span>
          <span className="mt-1 block font-medium text-ink-primary">
            {brief ? (brief.title ?? 'Your brief') : 'One of us might stop earning'}
          </span>
          <span className="block text-sm text-ink-secondary">
            {brief
              ? briefHeadline(splitBriefSentence(brief.template_sentence).main)
              : 'About two minutes. You get the month your savings would run out, shared with the other adult.'}
          </span>
          {brief?.stale && (
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
