'use client'

import { useState } from 'react'
import { motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion'
import { Trash2 } from 'lucide-react'
import { haptic } from '@/lib/haptics'

const DISMISS_THRESHOLD = -80
const MAX_DRAG = -120

interface SwipeableRowProps {
  onDismiss: () => void
  children: React.ReactNode
  disabled?: boolean
}

// Standard iOS Mail / Gmail "swipe left to dismiss" pattern — absent from
// every list in this app before this. Built on Framer Motion's own drag
// system (already a dependency, used everywhere else) rather than hand-
// rolled pointer tracking, so it inherits the same gesture physics as the
// rest of the app and doesn't fight native scroll/text-selection.
export function SwipeableRow({ onDismiss, children, disabled }: SwipeableRowProps) {
  const x = useMotionValue(0)
  const bgOpacity = useTransform(x, [MAX_DRAG, 0], [1, 0])
  const iconScale = useTransform(x, [DISMISS_THRESHOLD, 0], [1, 0.6])
  const [crossed, setCrossed] = useState(false)

  const handleDrag = (_: unknown, info: PanInfo) => {
    const past = info.offset.x <= DISMISS_THRESHOLD
    if (past !== crossed) {
      setCrossed(past)
      haptic('light')
    }
  }

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x <= DISMISS_THRESHOLD) {
      haptic('success')
      onDismiss()
    }
    setCrossed(false)
  }

  return (
    <div className="relative">
      <motion.div
        className="absolute inset-0 flex items-center justify-end pr-6 rounded-3xl pointer-events-none"
        style={{ background: '#ffafa3', opacity: bgOpacity }}
        aria-hidden="true"
      >
        <motion.div style={{ scale: iconScale }}>
          <Trash2 size={20} color="#302440" />
        </motion.div>
      </motion.div>
      <motion.div
        drag={disabled ? false : 'x'}
        dragConstraints={{ left: MAX_DRAG, right: 0 }}
        dragElastic={{ left: 0.15, right: 0 }}
        dragSnapToOrigin
        style={{ x, userSelect: 'none' }}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        // Live-verification finding: dragging from over the row's text
        // triggers the browser's own native text/element drag-and-drop (a
        // real `dragstart` fires after the first pointermove), which then
        // swallows every further pointermove/pointerup for that gesture —
        // Framer's own drag recognizer never gets a chance to see the rest
        // of the pull. `draggable={false}` stops the native one from ever
        // starting, so Framer's takes over instead. (Framer's motion.div
        // reserves the `onDragStart` prop name for its own gesture
        // lifecycle, not the native DOM event, so this can't also be
        // handled with a same-named handler — the HTML attribute is the
        // only way to reach it through this component.)
        draggable={false}
      >
        {children}
      </motion.div>
    </div>
  )
}
