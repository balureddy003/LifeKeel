'use client'

import { useEffect, useState } from 'react'
import { animate, useReducedMotion } from 'framer-motion'

/**
 * Counts up to a number once, as a small moment of reveal. People who prefer
 * reduced motion (and anyone before the page has hydrated) get the final number
 * straight away.
 */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(value)

  useEffect(() => {
    if (reduce) {
      setShown(value)
      return
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (v) => setShown(v),
    })
    return () => controls.stop()
  }, [value, reduce])

  return <>{shown.toFixed(decimals)}</>
}
