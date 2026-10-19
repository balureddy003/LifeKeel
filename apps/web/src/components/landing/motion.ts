'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One switch for every ambient animation on the landing page (WCAG 2.2.2).
 * Motion is on unless the visitor pressed Pause or their system asks for reduced
 * motion. The state is mirrored to data-motion on <html> so CSS can stop loops
 * without each component knowing about it.
 */
export function useLandingMotion(): { on: boolean; paused: boolean; toggle: () => void } {
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const on = !paused && !reduced

  useEffect(() => {
    document.documentElement.dataset.motion = on ? 'on' : 'off'
    return () => {
      delete document.documentElement.dataset.motion
    }
  }, [on])

  const toggle = useCallback(() => setPaused((p) => !p), [])
  return { on, paused, toggle }
}

/** Counts towards `target` over 900ms; jumps straight there when motion is off. */
export function useCountUp(target: number, on: boolean): number {
  const [shown, setShown] = useState(target)
  const current = useRef(target)
  useEffect(() => {
    if (!on) {
      current.current = target
      setShown(target)
      return
    }
    const from = current.current
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 900)
      current.current = from + (target - from) * (1 - Math.pow(1 - p, 3))
      setShown(current.current)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, on])
  return shown
}
