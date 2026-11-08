'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { useLandingMotion } from './motion'
import './story.css'

/**
 * "Marcia's Tuesday": a short made-up story in six calm beats. It shows the family list doing its
 * job on an ordinary day: Dev adds the car, Marcia looks too, and weeks later, with Dev away, she
 * finds the car and who to call without having to ask.
 *
 * Rules (docs/research/brand-and-story-guide-2026-11-08.md): calm movement only, the visitor can
 * pause, reduced motion is honoured through the shared landing switch (motion.ts), every beat is also
 * plain text, nothing is promised that the product cannot do, no one is shown watching another adult,
 * and children are drawn as simple shapes.
 *
 * Claims this story relies on (see claims.ts): family-list, every-adult-confirms, dates-coming-up,
 * recovery-contact.
 */
export const BEATS = [
  { caption: '7:40 on a Tuesday. A school letter and a circled date are on the fridge.' },
  { caption: 'Dev adds the car to the family list. Just the car, for now.' },
  { caption: 'That evening, Marcia looks too. The list shows who has looked.' },
  { caption: 'Weeks later it is raining. The car will not start, and Dev is away.' },
  { caption: 'Marcia opens the list. The car is there, with who to call.' },
  { caption: 'Asha hangs the key back on the hook. Nobody had to ask.' },
] as const

const STEP_MS = 5200

function Scene() {
  return (
    <svg className="fs-svg" viewBox="0 0 640 360" focusable="false">
      <rect className="fs-wall" x="0" y="0" width="640" height="250" />
      <rect className="fs-floor" x="0" y="250" width="640" height="110" />

      {/* Window, with rain in beat 4 */}
      <g transform="translate(36 36)">
        <rect className="fs-window" width="120" height="120" rx="6" />
        <path className="fs-frame" d="M60 0v120M0 60h120" />
        <g className="fs-rain">
          <path d="M20 10l-6 22M50 14l-6 22M80 8l-6 22M104 18l-6 22M34 70l-6 22M72 74l-6 22M96 82l-6 22" />
        </g>
      </g>

      {/* The key hook */}
      <g transform="translate(70 196)">
        <rect className="fs-board" width="74" height="14" rx="4" />
        <circle className="fs-hook" cx="37" cy="22" r="3" />
        <g className="fs-key">
          <path className="fs-keyline" d="M37 25v14" />
          <circle className="fs-keyhead" cx="37" cy="46" r="6" />
          <path className="fs-keyline" d="M37 52v12m0 0h6m-6-5h5" />
        </g>
      </g>

      {/* The fridge: a school letter and a calendar page with a date circled */}
      <g transform="translate(500 50)">
        <rect className="fs-fridge" width="112" height="244" rx="10" />
        <path className="fs-fridge-line" d="M0 84h112" />
        <rect className="fs-letter" x="14" y="104" width="38" height="48" rx="2" />
        <path className="fs-letter-lines" d="M20 116h26M20 124h26M20 132h18" />
        <rect className="fs-calendar" x="62" y="108" width="36" height="42" rx="3" />
        <path className="fs-letter-lines" d="M68 120h24M68 130h24M68 140h24" />
        <ellipse className="fs-circled" cx="80" cy="130" rx="10" ry="8" />
      </g>

      {/* The table, two mugs, steam */}
      <rect className="fs-table" x="200" y="244" width="230" height="12" rx="4" />
      <path className="fs-leg" d="M220 256v70M410 256v70" />
      <g className="fs-mugs">
        <rect className="fs-mug" x="282" y="224" width="22" height="20" rx="4" />
        <rect className="fs-mug" x="332" y="224" width="22" height="20" rx="4" />
      </g>
      <g className="fs-steam">
        <path d="M290 216c-5-8 5-12 0-20M343 216c-5-8 5-12 0-20" />
      </g>

      {/* Asha, drawn as a simple shape */}
      <g className="fs-asha">
        <circle className="fs-skin-a" cx="0" cy="0" r="13" />
        <rect className="fs-asha-body" x="-12" y="14" width="24" height="46" rx="10" />
        <rect className="fs-bag" x="10" y="22" width="14" height="22" rx="4" />
      </g>

      {/* Dev, with his phone */}
      <g className="fs-dev">
        <circle className="fs-skin-d" cx="0" cy="0" r="18" />
        <path className="fs-hair-d" d="M-18 -4a18 18 0 0 1 36 0c-8-9-28-9-36 0z" />
        <rect className="fs-dev-body" x="-22" y="20" width="44" height="86" rx="14" />
        <rect className="fs-phone-dev" x="16" y="48" width="12" height="20" rx="3" />
      </g>

      {/* Marcia, with her glasses */}
      <g className="fs-marcia">
        <circle className="fs-hair-m" cx="0" cy="-17" r="10" />
        <circle className="fs-skin-m" cx="0" cy="0" r="19" />
        <path className="fs-hair-m" d="M-19 -2a19 19 0 0 1 38 0c-9-10-29-10-38 0z" />
        <circle className="fs-glass" cx="-7" cy="1" r="5" />
        <circle className="fs-glass" cx="7" cy="1" r="5" />
        <path className="fs-glass" d="M-2 1h4" />
        <rect className="fs-marcia-body" x="-24" y="22" width="48" height="92" rx="16" />
        <path className="fs-coat" d="M-24 40h48" />
      </g>
    </svg>
  )
}

export function FamilyStory() {
  const [beat, setBeat] = useState(1)
  const { on, paused, toggle } = useLandingMotion()
  const reduced = !on && !paused

  // One beat at a time, only while the landing page says motion is on. Stops on the last beat.
  useEffect(() => {
    if (!on || beat >= BEATS.length) return
    const id = setTimeout(() => setBeat((b) => Math.min(b + 1, BEATS.length)), STEP_MS)
    return () => clearTimeout(id)
  }, [on, beat])

  return (
    <section className="vv-section fs" id="story" aria-labelledby="fs-h">
      <header className="vv-head">
        <p className="vv-eyebrow">A short story</p>
        <h2 id="fs-h">Marcia’s Tuesday.</h2>
        <p className="vv-intro">
          Dev, Marcia and Asha share one household. Six small moments, and nobody is in a hurry.
          Nothing goes wrong that cannot be put right.
        </p>
      </header>

      <div className="fs-stage" data-testid="story-stage" data-beat={beat} aria-hidden="true">
        <Scene />
        <div className="fs-phone">
          <p className="fs-phone-h">Family list</p>
          <p className="fs-row fs-row-car">Car · MOT due 14 March</p>
          <p className="fs-row fs-row-call">Who to call · on the list</p>
          <p className="fs-seen fs-seen-dev">✓ Dev has looked</p>
          <p className="fs-seen fs-seen-marcia">✓ Marcia has looked</p>
        </div>
      </div>

      <div className="fs-controls">
        <button
          type="button"
          className="fs-btn"
          onClick={() => setBeat((b) => Math.max(b - 1, 1))}
          disabled={beat === 1}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Previous
        </button>
        {!reduced && (
          <button
            type="button"
            className="fs-btn"
            onClick={() => {
              haptic('light')
              toggle()
            }}
          >
            {on ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            {on ? 'Pause the story' : 'Play the story'}
          </button>
        )}
        <button
          type="button"
          className="fs-btn"
          onClick={() => setBeat((b) => Math.min(b + 1, BEATS.length))}
          disabled={beat === BEATS.length}
        >
          Next
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>

      <ol className="fs-beats">
        {BEATS.map((b, i) => (
          <li key={b.caption} aria-current={i + 1 === beat ? 'step' : undefined}>
            {b.caption}
          </li>
        ))}
      </ol>

      <div className="fs-end">
        <p className="fs-end-line">Know where to look.</p>
        <a
          className="vv-btn"
          href={appUrl('/signup')}
          onClick={() => {
            haptic('light')
            track('landing_cta_click', { location: 'story', method: 'signup' })
          }}
        >
          Start your family’s list
          <ArrowRight size={18} aria-hidden="true" />
        </a>
        <p className="vv-fine">Made-up family. Made-up dates.</p>
      </div>
    </section>
  )
}
