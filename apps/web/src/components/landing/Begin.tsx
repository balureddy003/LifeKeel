'use client'

/**
 * Cinematic close — Scroll 6, "Begin."
 *
 * The film does not end on a button. It ends on one breath: the headline,
 * the hero's promise folded into a sentence, the honest price line, and two
 * invitations at the same restraint as the opening shot — one calm primary
 * and one quiet text link to /pricing.
 *
 * The team path deliberately does not push the team product; /pricing
 * describes it on its own terms (brief §4, Scroll 6).
 *
 * `#signup-final` lives here because StickyCta watches it to retire the
 * phone bar once the close is on screen.
 */

import { ArrowRight } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'

export const BEGIN_BODY_LINES = [
  'One list. The people who need to know.',
  'Confirmations, not notifications.',
] as const

export const BEGIN_BODY = BEGIN_BODY_LINES.join(' ')
export const BEGIN_CLOSING = 'Free for a household. Honest plans for a team. Information only.'

/** Claims the close rests on. All `live` — see claims.ts. */
export const BEGIN_CLAIMS = [
  'family-list',
  'every-adult-confirms',
  'free-plan',
  'plus-price',
  'no-policy-picks',
]

export function Begin() {
  return (
    <section
      className="vv-section lk-begin"
      id="signup-final"
      aria-labelledby="lk-begin-h"
      data-claims={BEGIN_CLAIMS.join(' ')}
    >
      <h2 id="lk-begin-h" className="lk-begin-h">
        Begin.
      </h2>
      <p className="lk-begin-body">
        {BEGIN_BODY_LINES.map((line, i) => (
          <span key={line}>
            {i > 0 ? ' ' : ''}
            {line}
          </span>
        ))}
      </p>
      <p className="lk-begin-closing">{BEGIN_CLOSING}</p>
      <div className="lk-begin-actions">
        <a
          href={appUrl('/signup')}
          className="lk-begin-primary"
          onClick={() => {
            haptic('light')
            track('landing_cta_click', { location: 'final', method: 'signup' })
          }}
        >
          Start your free list
          <ArrowRight size={18} aria-hidden="true" />
        </a>
        <a href="/pricing" className="lk-begin-secondary">
          For a small team — see plans →
        </a>
      </div>
    </section>
  )
}
