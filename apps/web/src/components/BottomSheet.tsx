'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence, type PanInfo } from 'framer-motion'
import { useFocusTrap } from '@/lib/useFocusTrap'

const DISMISS_DISTANCE = 100

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** aria-label for the sheet region, since it isn't always a labeled dialog. */
  label: string
}

// The standard mobile "sheet slides up from the bottom" pattern (Material
// Design 3's bottom sheet, iOS's action sheet) — used nowhere in this app
// before this, where confirmations and quick actions fell back to the
// browser's own unstyled window.confirm() or full-page navigation instead.
export function BottomSheet({ open, onClose, children, label }: BottomSheetProps) {
  const containerRef = useFocusTrap<HTMLDivElement>(open)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > 500) onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-modal flex items-end justify-center"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            ref={containerRef}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={handleDragEnd}
            // Same fix as SwipeableRow — without this, a mouse drag on the
            // sheet's own text/content starts the browser's native
            // drag-and-drop instead of Framer's, which then never gets a
            // release event and leaves the sheet stuck mid-drag.
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg glass-strong rounded-t-3xl overflow-hidden shadow-2xl outline-none pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing">
              <div className="w-9 h-1.5 rounded-full bg-white/15" />
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
