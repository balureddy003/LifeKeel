'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { HeartCrack, Heart, Car, Plane, Home, ChevronRight, type LucideIcon } from 'lucide-react'
import { haptic } from '@/lib/haptics'
import { LIFE_EVENTS } from '@/lib/life-data'
import { useFocusTrap } from '@/lib/useFocusTrap'

const EMERGENCY_ICONS: Record<string, LucideIcon> = {
  bereavement: HeartCrack,
  medical: Heart,
  car: Car,
  property: Home,
  travel: Plane,
}

export function EmergencyMode({
  active,
  onDeactivate,
  onSelectEvent,
}: {
  active: boolean
  onDeactivate: () => void
  onSelectEvent: (eventId: string) => void
}) {
  const emergencyEvents = LIFE_EVENTS.filter((e) =>
    ['bereavement', 'medical', 'car', 'property', 'travel'].includes(e.id)
  )
  const containerRef = useFocusTrap<HTMLDivElement>(active)

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex flex-col"
          style={{ background: 'rgba(0,0,0,0.95)' }}
          ref={containerRef}
          tabIndex={-1}
        >
          {/* Header */}
          <div className="px-6 pt-12 pb-4 safe-area-top">
            <motion.h1
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-3xl font-bold text-center"
              style={{ color: '#f87171' }}
            >
              What happened?
            </motion.h1>
            <p className="text-center text-ink-tertiary mt-2 text-lg">
              Tap one and I&apos;ll guide you through it
            </p>
          </div>

          {/* Event buttons */}
          <div className="flex-1 px-6 space-y-4 pt-4">
            {emergencyEvents.map((event, i) => (
              <motion.button
                key={event.id}
                onClick={() => {
                  haptic('heavy')
                  onDeactivate()
                  onSelectEvent(event.id)
                }}
                whileTap={{ scale: 0.95 }}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className="w-full flex items-center gap-4 p-6 rounded-3xl border border-white/10 active:scale-95 transition-transform"
                style={{ background: 'rgba(255,255,255,0.03)', minHeight: 80 }}
              >
                {(() => {
                  const Icon = EMERGENCY_ICONS[event.id] ?? HeartCrack
                  return (
                    <div className="w-14 h-14 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center flex-shrink-0">
                      <Icon size={28} className="text-danger" strokeWidth={1.5} />
                    </div>
                  )
                })()}
                <span className="text-xl font-semibold text-left flex-1">{event.label}</span>
                <ChevronRight size={24} className="text-ink-tertiary" />
              </motion.button>
            ))}
          </div>

          {/* Close */}
          <div className="px-6 pb-8 safe-area-bottom">
            <motion.button
              onClick={() => {
                haptic('light')
                onDeactivate()
              }}
              whileTap={{ scale: 0.95 }}
              className="w-full py-4 rounded-2xl text-ink-tertiary font-semibold text-base"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              Cancel
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
