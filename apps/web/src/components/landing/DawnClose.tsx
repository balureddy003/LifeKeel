'use client'

import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { Wave } from './SeaBackdrop'
import './landing.css'
import './hero.css'
import './bands.css'

/** The close: the same sea at dawn, one signup link. Plain <a> to the app host, no field. */
export function DawnClose() {
  return (
    <section className="lk-band" aria-labelledby="lk-dawn-h">
      <div className="lk-dawn">
        <h2 id="lk-dawn-h">Make your account. Keel starts checking what you tell it.</h2>
        <div className="lk-dawn-cta" id="signup-final">
          <a
            className="lk-btn"
            href={appUrl('/signup')}
            onClick={() => {
              haptic('light')
              track('landing_cta_click', { location: 'final', method: 'signup' })
            }}
          >
            Create your free account
          </a>
        </div>
        <p className="lk-fine">
          Free to start. An optional paid plan reads policy documents for you. Information only: not
          financial, tax or legal advice.
        </p>
        <div className="lk-dawn-boat" aria-hidden="true">
          <svg viewBox="0 0 120 140" className="lk-boat-svg">
            <use href="#lk-boat" />
          </svg>
        </div>
        <div className="lk-layer lk-l1" aria-hidden="true">
          <Wave i={1} gid="lk-dg1" />
        </div>
        <div className="lk-layer lk-l2" aria-hidden="true">
          <Wave i={2} gid="lk-dg2" />
        </div>
        <div className="lk-front" aria-hidden="true">
          <div className="lk-layer">
            <Wave i={3} gid="lk-dg3" />
          </div>
        </div>
      </div>
    </section>
  )
}
