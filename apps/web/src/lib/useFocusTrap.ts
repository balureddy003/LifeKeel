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
  const wasActive = useRef(false)

  // Live-verification finding: capturing this in a useEffect (a passive
  // effect) ran too late whenever the trapped content itself contains an
  // autoFocus element (e.g. CommandPalette's search input) — React applies
  // autoFocus during commit, before passive effects run, so the effect
  // observed the element that had *just* stolen focus instead of the real
  // trigger. Confirmed live via a focus() trace: previousFocus.current was
  // captured as the search input, not the button that opened the palette,
  // so Escape restored focus to nothing useful. Capturing during render
  // (on the false->true transition) runs before any child in the trap
  // subtree even mounts, so it can't lose the race.
  if (active && !wasActive.current) {
    previousFocus.current = document.activeElement as HTMLElement | null
  }
  wasActive.current = active

  useEffect(() => {
    if (!active) return
    return () => {
      previousFocus.current?.focus()
    }
  }, [active])

  useEffect(() => {
    if (!active) return
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
