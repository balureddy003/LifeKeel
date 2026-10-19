'use client'

import { useEffect, useState } from 'react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import './landing.css'
import './hero.css'

/**
 * A "Start free" bar for phones. It shows while neither signup block (the hero card
 * and the close) is on screen, and stops showing once the visitor has reached the close.
 */
export function StickyCta() {
  const [hero, setHero] = useState(true)
  const [close, setClose] = useState(false)
  const [seenClose, setSeenClose] = useState(false)
  const [foot, setFoot] = useState(false)

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const a = document.getElementById('signup')
    const b = document.getElementById('signup-final')
    const c = document.querySelector('.lk-footer')
    const ios: IntersectionObserver[] = []
    if (c) {
      const io = new IntersectionObserver((es) => setFoot(es[0]!.isIntersecting), { threshold: 0 })
      io.observe(c)
      ios.push(io)
    }
    if (a) {
      const io = new IntersectionObserver((es) => setHero(es[0]!.isIntersecting), {
        threshold: 0.2,
      })
      io.observe(a)
      ios.push(io)
    }
    if (b) {
      const io = new IntersectionObserver(
        (es) => {
          setClose(es[0]!.isIntersecting)
          if (es[0]!.isIntersecting) setSeenClose(true)
        },
        { threshold: 0.2 },
      )
      io.observe(b)
      ios.push(io)
    }
    return () => ios.forEach((io) => io.disconnect())
  }, [])

  const show = !hero && !close && !seenClose && !foot
  return (
    <div className={`lk-sticky${show ? ' on' : ''}`} aria-hidden={!show}>
      <a
        className="lk-btn"
        href={appUrl('/signup')}
        tabIndex={show ? 0 : -1}
        onClick={() => {
          haptic('light')
          track('landing_cta_click', { location: 'sticky', method: 'signup' })
        }}
      >
        Start free
      </a>
    </div>
  )
}
