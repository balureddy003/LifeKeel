'use client'

import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import './landing.css'
import './hero.css'
import './bands.css'

const FIELDS = [
  ['Provider', 'Example Insurance Co.'],
  ['Policy number', 'HO-88213-A'],
  ['Amount', '£1,240/yr'],
  ['Renews', '14 Jun 2027'],
] as const

/** Keel Plus: a made-up extraction, labelled as a sample, for the person to confirm. */
export function PlusSpotlight() {
  return (
    <section className="lk-band" aria-labelledby="lk-plus-h">
      <div className="lk-two">
        <div>
          <p className="lk-eyebrow">Keel Plus</p>
          <h2 id="lk-plus-h">Skip the retyping.</h2>
          <p className="lk-intro">
            Photograph an insurance policy or pension statement and Keel Plus reads out the
            provider, policy number, amount and renewal date for you to confirm. Typing them in
            yourself stays free.
          </p>
          <div className="lk-cta-row">
            <a
              className="lk-btn"
              href={appUrl('/signup')}
              onClick={() => {
                haptic('light')
                track('landing_cta_click', { location: 'plus_spotlight', method: 'signup' })
              }}
            >
              Start free, add Plus later
            </a>
          </div>
        </div>
        <article className="lk-cardx" aria-label="Sample policy fields read for you">
          <header>
            <h3>Read from a policy</h3>
            <span className="lk-tag">Sample document</span>
          </header>
          <dl className="lk-fields">
            {FIELDS.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="lk-fine">Made-up document. You check each field before it is saved.</p>
        </article>
      </div>
    </section>
  )
}
