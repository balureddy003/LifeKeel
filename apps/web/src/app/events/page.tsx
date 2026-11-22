'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import Link from 'next/link'
import {
  ChevronRight,
  Info,
  Heart,
  Wallet,
  Target,
  Plane,
  Car,
  Home,
  Baby,
  HeartCrack,
  Briefcase,
  GraduationCap,
  Palmtree,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LIFE_EVENTS } from '@/lib/life-data'
import { GlassCard, PageHeader, PageTransition } from '@/components/Glass'
import { haptic } from '@/lib/haptics'
import { EmergencyRow } from '@/components/EmergencyRow'

const categoryColors: Record<string, string> = {
  protection: '#ffafa3',
  wealth: '#ffda87',
  goals: '#92e1d7',
  life: '#d3b8f5',
}

const EVENT_ICONS: Record<string, LucideIcon> = {
  bereavement: HeartCrack,
  medical: Heart,
  'job-loss': Briefcase,
  car: Car,
  travel: Plane,
  property: Home,
  'new-child': Baby,
  marriage: Heart,
  university: GraduationCap,
  retirement: Palmtree,
}

/** The situations most families come for first; the rest are one tap away. */
const LEAD_EVENT_IDS = ['job-loss', 'medical', 'bereavement', 'new-child']

export default function EventsPage() {
  const [showAll, setShowAll] = useState(false)
  const events = showAll
    ? LIFE_EVENTS
    : LIFE_EVENTS.filter((e) => LEAD_EVENT_IDS.includes(e.id)).sort(
        (a, b) => LEAD_EVENT_IDS.indexOf(a.id) - LEAD_EVENT_IDS.indexOf(b.id),
      )
  return (
    <PageTransition>
      <div className="px-5 pt-2 space-y-5">
        <PageHeader
          title="What If?"
          subtitle="Pick a situation to see what is on your family list that applies"
        />

        <EmergencyRow />

        <div className="space-y-3">
          {events.map((event, i) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <Link href={`/events/${event.id}`} onClick={() => haptic('light')}>
                <GlassCard className="p-4" interactive>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
                      style={{ background: `${categoryColors[event.category]}15` }}
                    >
                      {(() => {
                        const EventIcon = EVENT_ICONS[event.id] ?? Target
                        return (
                          <EventIcon
                            size={22}
                            color={categoryColors[event.category]}
                            strokeWidth={1.5}
                          />
                        )
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Live-verification finding: at mobile width, the icon
                        + chevron overhead leaves ~200px for the label —
                        "Family member passed away" and "Medical emergency"
                        both genuinely don't fit on one line and were
                        truncating to "Family memb..." / "Medical emer...",
                        losing the word that actually identifies the
                        scenario. There's vertical room to spare here, so
                        wrapping to two lines (keeping only the description
                        truncated, which matters less — the card itself
                        explains everything on tap) shows the whole title
                        instead of guessing from a fragment. */}
                      <div className="text-base font-semibold leading-snug line-clamp-2">
                        {event.label}
                      </div>
                      <div className="text-xs text-ink-tertiary truncate">{event.description}</div>
                    </div>
                    <span className="text-ink-tertiary text-lg">
                      <ChevronRight size={18} />
                    </span>
                  </div>
                </GlassCard>
              </Link>
            </motion.div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-[48px] w-full rounded-full border border-haze px-4 text-base font-medium text-ink-primary"
        >
          {showAll ? 'Show fewer' : 'Show every situation'}
        </button>

        <div className="glass rounded-2xl p-4 flex items-start gap-2">
          <Info size={18} className="text-ink-tertiary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-ink-tertiary leading-relaxed">
            This shows what is on your family list for each situation. It is information only, and
            your family&apos;s data stays private.
          </p>
        </div>
      </div>
    </PageTransition>
  )
}
