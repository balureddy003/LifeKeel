'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { Calendar, GraduationCap, Heart, Home, Briefcase, Baby, Palmtree, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import type { TimelineEvent } from '@/lib/modes'

const EVENT_ICONS: Record<string, LucideIcon> = {
  married: Heart,
  house: Home,
  emma: Baby,
  lucas: Baby,
  promotion: Briefcase,
  retirement: Palmtree,
  university: GraduationCap,
  default: Target,
}

export function LifeTimeline({ events }: { events: TimelineEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  return (
    <div className="relative">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary mb-3 px-1">
        <Calendar size={16} className="text-family-400" />
        Life Timeline
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto no-scrollbar px-1 pb-2"
        style={{ scrollSnapType: 'x proximity' }}
      >
        {/* NOW marker */}
        <div className="flex flex-col items-center min-w-[80px] relative">
          <div className="w-px h-full absolute left-1/2 -translate-x-1/2 bg-gradient-to-b from-family-500/40 to-white/5" />
          <motion.div
            className="relative z-raised w-3 h-3 rounded-full bg-family-500"
            animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="text-xs font-bold text-family-400 mt-1">NOW</span>
        </div>

        {events.filter((e) => e.status !== 'current').map((event, i) => (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => haptic('light')}
            className="flex flex-col items-center min-w-[100px] cursor-pointer"
            style={{ scrollSnapAlign: 'start' }}
          >
            <div className="w-px h-8 bg-white/10" />
            <motion.div
              whileTap={{ scale: 0.9 }}
              className="glass rounded-2xl p-3 flex flex-col items-center gap-1 min-w-[90px]"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-family-500/10">
                {(() => {
                  const EventIcon = EVENT_ICONS[event.id] ?? EVENT_ICONS.default!
                  return <EventIcon size={16} className="text-family-400" strokeWidth={1.5} />
                })()}
              </div>
              <span className="text-xs font-semibold text-center">{event.label}</span>
              <span className="text-caption text-ink-tertiary">{event.year}</span>
            </motion.div>
          </motion.div>
        ))}

        {/* End marker */}
        <div className="flex flex-col items-center min-w-[40px]">
          <div className="w-px h-8 bg-white/5" />
          <div className="w-3 h-3 rounded-full bg-white/10" />
        </div>
      </div>
    </div>
  )
}
