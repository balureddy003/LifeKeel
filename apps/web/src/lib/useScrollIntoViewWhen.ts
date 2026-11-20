import { useEffect, type RefObject } from 'react'

/**
 * Scrolls an element to the middle of the screen when it opens. A form that renders below the fold
 * (Add Member sits under the "Leave this family" block on a phone) otherwise looks as if tapping
 * its button did nothing.
 */
export function useScrollIntoViewWhen(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [active, ref])
}
