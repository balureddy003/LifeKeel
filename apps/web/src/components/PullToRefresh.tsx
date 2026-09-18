'use client'

import { useCallback, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { haptic } from '@/lib/haptics'

const TRIGGER_DISTANCE = 64
const MAX_PULL = 96
const RESISTANCE = 0.45

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void
  children: React.ReactNode
}

// Standard mobile "pull down at the top of a list to refresh" gesture —
// absent everywhere in this app before this. Built on Pointer Events (not
// Touch Events) so it works the same for touch, mouse, and stylus input.
// Only arms when the page is scrolled to the very top, so it never fights
// normal scrolling further down the list.
export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const armed = useRef(false)
  const crossedThreshold = useRef(false)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (window.scrollY > 0 || refreshing) return
    startY.current = e.clientY
    armed.current = true
    crossedThreshold.current = false
    // Text selection on mouse starts right at mousedown, before any move
    // delta exists to test — has to be blocked here, not in the move
    // handler, or a drag from the page top always selects text instead.
    if (e.pointerType === 'mouse') e.preventDefault()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported — gesture still works */ }
  }, [refreshing])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!armed.current || startY.current === null) return
    const dy = e.clientY - startY.current
    if (dy <= 0 || window.scrollY > 0) {
      armed.current = dy <= 0
      setPull(0)
      return
    }
    // A real drag-down gesture, not a scroll or a text selection — claim it
    // before the browser's native text-selection (mouse) or page-scroll
    // (touch) behavior can start, which otherwise wins the race against
    // React's next render on every input type this component supports.
    e.preventDefault()
    const distance = Math.min(dy * RESISTANCE, MAX_PULL)
    setPull(distance)
    if (distance >= TRIGGER_DISTANCE && !crossedThreshold.current) {
      haptic('light')
      crossedThreshold.current = true
    } else if (distance < TRIGGER_DISTANCE) {
      crossedThreshold.current = false
    }
  }, [])

  const endPull = useCallback(async (e: React.PointerEvent) => {
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* no-op */ }
    if (!armed.current) return
    armed.current = false
    startY.current = null
    if (pull >= TRIGGER_DISTANCE) {
      setRefreshing(true)
      setPull(TRIGGER_DISTANCE)
      haptic('success')
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
        setPull(0)
      }
    } else {
      setPull(0)
    }
  }, [pull, onRefresh])

  const progress = Math.min(pull / TRIGGER_DISTANCE, 1)

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPull}
      onPointerCancel={endPull}
      style={{ touchAction: pull > 0 ? 'none' : 'pan-y', userSelect: pull > 0 ? 'none' : undefined }}
    >
      <div
        className="flex items-end justify-center overflow-hidden"
        style={{ height: pull, transition: armed.current ? 'none' : 'height 0.25s ease' }}
      >
        <div className="pb-2">
          <RefreshCw
            size={20}
            className={refreshing ? 'animate-spin text-family-400' : 'text-ink-tertiary'}
            style={{
              opacity: progress,
              transform: refreshing ? undefined : `rotate(${progress * 360}deg)`,
            }}
            aria-hidden="true"
          />
        </div>
      </div>
      {children}
    </div>
  )
}
