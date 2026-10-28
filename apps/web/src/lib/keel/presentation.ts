import { useEffect, useState } from 'react'

export type Presentation = 'docked' | 'overlay' | 'sheet'

/** Width of the desktop navigation rail the panel must leave room beside. */
export const RAIL_WIDTH = 88
/** The page needs at least this much room next to a docked panel. */
export const MIN_MAIN_WIDTH = 640

/**
 * Chosen from the space actually left for the page, not the viewport alone:
 *  - docked: at least 640px remain beside the panel (page and chat side by side)
 *  - overlay: a laptop/desktop viewport that is too narrow to dock
 *  - sheet: phones, tablets and 200% zoom (a modal bottom sheet)
 */
export function choosePresentation(
  viewportWidth: number,
  panelWidth: number,
  hasRail: boolean,
): Presentation {
  if (viewportWidth < 1024) return 'sheet'
  const rail = hasRail ? RAIL_WIDTH : 0
  return viewportWidth - rail - panelWidth >= MIN_MAIN_WIDTH ? 'docked' : 'overlay'
}

/** null until measured, so a reload on a desktop never flashes the phone-style sheet. */
export function usePresentation(panelWidth: number): Presentation | null {
  const [value, setValue] = useState<Presentation | null>(null)
  useEffect(() => {
    const update = () => {
      const rail =
        window.matchMedia?.(
          '(min-width: 1400px), (min-width: 1024px) and (hover: hover) and (pointer: fine)',
        ).matches ?? false
      setValue(choosePresentation(window.innerWidth, panelWidth, rail))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [panelWidth])
  return value
}
