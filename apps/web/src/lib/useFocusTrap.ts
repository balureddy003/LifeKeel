'use client'

import { useEffect, useRef, useCallback } from 'react'

/**
 * Focus trap hook for modal/overlay components.
 * Captures focus on mount, traps Tab/Shift+Tab within the container,
 * and restores focus to the previously active element on unmount.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    previousFocus.current = document.activeElement as HTMLElement | null

    const container = containerRef.current
    if (!container) return

    // Focus the container or first focusable element
    const focusables = getFocusables(container)
    if (focusables.length > 0 && focusables[0]) {
      focusables[0].focus()
    } else {
      container.focus()
    }

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const els = getFocusables(container)
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handler)
    return () => {
      container.removeEventListener('keydown', handler)
      previousFocus.current?.focus()
    }
  }, [active])

  return containerRef
}

function getFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null)
}
