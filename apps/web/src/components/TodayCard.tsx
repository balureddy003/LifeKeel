'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarCheck, ChevronRight } from 'lucide-react'
import { GlassCard } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import {
  getDomains,
  getDomainView,
  getObligationsMap,
  type FamilyInsight,
  type Obligation,
} from '@/lib/api'
import { SEEN_CONFIRMED_EVENT, seenStatus, type SeenInput } from '@/lib/seen-status'
import { useAuth } from '@/lib/auth-context'
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
  const { family } = useAuth()
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

  // True when any shared list has something on file, even if the readiness score has no data yet.
  const [onFile, setOnFile] = useState(false)
  const [listsRead, setListsRead] = useState(false)
  const [awaitingYou, setAwaitingYou] = useState<{ title: string; href: string } | null>(null)

  // A list the viewer has not confirmed: the same reading Home's "Who has looked" card uses.
  // It reads again when the viewer confirms one, so the ask goes away without a reload.
  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const { domains } = await getDomains()
        const views = await Promise.all(
          domains.map(async (d) => {
            const v = await getDomainView(d.id)
            return v
              ? ({
                  id: d.id,
                  title: d.title,
                  records: v.rows.length,
                  result_version: v.result_version,
                  confirmation: v.confirmation,
                } satisfies SeenInput)
              : null
          }),
        )
        const lists = views.filter((v): v is SeenInput => v !== null)
        if (live) setOnFile(lists.some((l) => l.records > 0))
        const mine = seenStatus(lists).find((r) => r.canConfirm)
        if (live) setAwaitingYou(mine ? { title: mine.title, href: `#seen-${mine.id}` } : null)
      } catch {
        /* the card simply falls back to its other choices */
      }
      // Wait for this read, so a household with a policy never flashes "Check one policy".
      if (live) setListsRead(true)
    }
    void load()
    const again = () => void load()
    window.addEventListener(SEEN_CONFIRMED_EVENT, again)
    return () => {
      live = false
      window.removeEventListener(SEEN_CONFIRMED_EVENT, again)
    }
  }, [])

  if (obligations === null || !listsRead) return null
  const item = pickTodayItem({
    obligations,
    insights,
    profileCompleteness,
    today: new Date().toISOString().slice(0, 10),
    awaitingYou,
    // Nothing on file: start with one policy. Something on file and no one else on it: the other adult.
    startWithPolicy: !hasLiveData && !onFile,
    startWithOtherAdult: (hasLiveData || onFile) && !!family && family.members.length <= 1,
  })
  // A brand-new account has nothing to check yet; saying so would be noise.
  if (item.tier === 'none' && !hasLiveData && !onFile) return null

  return (
    <GlassCard className="p-5 border-family-500/20" data-testid="today-card">
      <div className="flex items-center gap-2 text-xs font-semibold text-family-400">
        <CalendarCheck size={14} aria-hidden="true" />{' '}
        {item.tier === 'start' ? 'Start here' : 'One thing worth checking today'}
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
            className="mt-3 inline-flex min-h-[48px] items-center gap-1 text-sm font-semibold text-family-400"
          >
            {item.cta} <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </>
      )}
    </GlassCard>
  )
}
