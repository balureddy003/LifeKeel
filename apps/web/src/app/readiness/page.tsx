'use client'

/**
 * The public readiness quiz was retired (2026-10-20): signup is the front door and the quiz's
 * score and share card made claims the product does not keep. Old links, shares and guides that
 * pointed here land on signup, with any utm_* parameters carried across.
 */
import { useEffect } from 'react'

export default function ReadinessRetired() {
  useEffect(() => {
    const utm = new URLSearchParams(window.location.search)
    const keep = new URLSearchParams()
    utm.forEach((v, k) => { if (k.startsWith('utm_')) keep.set(k, v) })
    const qs = keep.toString()
    window.location.replace(`/signup${qs ? `?${qs}` : ''}`)
  }, [])
  return <p className="p-6 text-sm text-ink-secondary">Taking you to sign up…</p>
}
