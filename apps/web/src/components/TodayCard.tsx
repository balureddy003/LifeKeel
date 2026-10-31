'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarCheck, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { getObligationsMap, type FamilyInsight, type Obligation } from '@/lib/api'
import { pickTodayItem } from '@/lib/today-item'

/**
 * The first thing on home: one item, why it is first, one button. Chosen by
 * the rule in lib/today-item.ts, so the order is the same for everyone and
 * says what is on file without telling anyone what to buy or switch.
 */
export function TodayCard({
  insights,
  profileCompleteness,
  hasLiveData,
}: {
  insights: FamilyInsight[]
  profileCompleteness: number
  hasLiveData: boolean
}) {
  const [obligations, setObligations] = useState<Obligation[] | null>(null)

  useEffect(() => {
    let live = true
    getObligationsMap()
      .then((m) => live && setObligations(m.obligations ?? []))
      .catch(() => live && setObligations([]))
    return () => {
      live = false
    }
  }, [])

  if (obligations === null) return null
  const item = pickTodayItem({
    obligations,
    insights,
    profileCompleteness,
    today: new Date().toISOString().slice(0, 10),
  })
  // A brand-new account has nothing to check yet; saying so would be noise.
  if (item.tier === 'none' && !hasLiveData) return null

  return (
    <GlassCard className="p-5 border-family-500/20" data-testid="today-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-family-400">
        <CalendarCheck size={14} aria-hidden="true" /> One thing worth checking today
      </div>
      <h2 className="mt-2 text-lg font-semibold leading-snug text-ink-primary">{item.title}</h2>
      {item.tier === 'check' && (
        <p className="mt-1 line-clamp-3 text-sm text-ink-secondary">{item.detail}</p>
      )}
      {item.tier !== 'none' && (
        <>
          <p className="mt-2 text-xs text-ink-tertiary">{item.why}</p>
          <Link
            href={item.href}
            onClick={() => haptic('light')}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-family-400"
          >
            {item.cta} <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </>
      )}
    </GlassCard>
  )
}
