'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

/**
 * One switch for every ambient animation on the landing page (WCAG 2.2.2).
 * Motion is on unless the visitor pressed Pause or their system asks for reduced
 * motion. The state is shared by every landing component and mirrored to
 * data-motion on <html> so CSS can stop loops without each component knowing.
 * It resets whenever the last landing component unmounts.
 */
let paused = false
let reduced = false
const listeners = new Set<() => void>()

const isOn = () => !paused && !reduced

function emit() {
  document.documentElement.dataset.motion = isOn() ? 'on' : 'off'
  listeners.forEach((l) => l())
}

let mq: MediaQueryList | null = null
const onMq = () => {
  reduced = !!mq?.matches
  emit()
}

function subscribe(l: () => void) {
  if (listeners.size === 0) {
    paused = false
    mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduced = mq.matches
    mq.addEventListener('change', onMq)
    document.documentElement.dataset.motion = isOn() ? 'on' : 'off'
  }
  listeners.add(l)
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) {
      mq?.removeEventListener('change', onMq)
      delete document.documentElement.dataset.motion
    }
  }
}

export function useLandingMotion(): { on: boolean; paused: boolean; toggle: () => void } {
  const on = useSyncExternalStore(subscribe, isOn, () => true)
  const isPaused = useSyncExternalStore(
    subscribe,
    () => paused,
    () => false,
  )
  const toggle = useCallback(() => {
    paused = !paused
    emit()
  }, [])
  return { on, paused: isPaused, toggle }
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
