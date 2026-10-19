'use client'

import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import './landing.css'
import './hero.css'
import './bands.css'

/** A signup link placed mid-page, after a section has shown what the product does. */
export function InlineCta({ location, text }: { location: string; text: string }) {
  return (
    <div className="lk-inline-cta">
      <p>{text}</p>
      <a
        className="lk-btn"
        href={appUrl('/signup')}
        onClick={() => {
          haptic('light')
          track('landing_cta_click', { location, method: 'signup' })
        }}
      >
        Create your free account
      </a>
    </div>
  )
}
