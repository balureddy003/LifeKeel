'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { HeartCrack, Heart, Car, Plane, Home, ChevronRight, ShieldAlert, type LucideIcon } from 'lucide-react'
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
  const router = useRouter()

  // useFocusTrap only handles Tab-cycling and focus restoration, not
  // Escape — CommandPalette (the app's other full-screen overlay) has its
  // own Escape handler for the same reason, so this mirrors that pattern
  // rather than baking Escape into the shared hook (which would double-fire
  // there). A stressed user's instinct to hit Escape should work here too.
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDeactivate()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, onDeactivate])

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-overlay flex flex-col"
          style={{ background: 'rgba(0,0,0,0.95)' }}
          ref={containerRef}
          tabIndex={-1}
        >
          {/* Life-safety notice — this screen is Oak's crisis entry point, but
              Oak is a financial/insurance assistant, not emergency services.
              Every tile below leads into insurance and financial admin steps;
              a family in real physical danger needs this line before any of
              that, not after. Shown unconditionally, above the fold, on every
              entry (Siren button, Cmd+K, elderly tile) — never gated behind a
              tile choice. */}
          <div className="px-6 pt-6 safe-area-top">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-danger/30 px-4 py-3 flex items-start gap-2.5"
              style={{ background: 'rgba(248,113,113,0.1)' }}
            >
              <ShieldAlert size={18} className="text-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed text-ink-primary">
                <span className="font-semibold">If anyone is in immediate danger, call 911 (or your local
                emergency number) now.</span> Oak can help with the insurance and financial steps after.
              </p>
            </motion.div>
          </div>

          {/* Header */}
          <div className="px-6 pt-8 pb-4">
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

          {/* Every tile above already leads into the real, tracked /life-events
              flow (remediation item 18) — so this is no longer "the one real
              path vs. 5 fake ones," it's the catch-all for something that
              doesn't fit the 5 tiles above (job loss, disability, or just
              picking from the full list). Worded accordingly. */}
          <div className="px-6 pt-2 pb-4">
            <motion.button
              onClick={() => {
                haptic('heavy')
                onDeactivate()
                router.push('/life-events')
              }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-4 rounded-2xl font-semibold text-base text-danger border border-danger/30"
              style={{ background: 'rgba(248,113,113,0.08)' }}
            >
              Something else — see all event types
            </motion.button>
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
