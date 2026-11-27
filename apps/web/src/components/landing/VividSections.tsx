'use client'

/**
 * The two home sections that sit after the trust act: the household price (#pricing) and the common
 * questions (#faq). The older story sections that lived here (Features board, bad day, three problems,
 * how it works, Plus band, stat strip) were removed with the cinematic landing (PR 608); the chapter
 * board data stays in capabilities.ts for its tests and the SEO story.
 */
import { Check } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { FREE_ROWS, PLUS_ROWS } from './Pricing'
import { FAQ } from './faq-data'

function signup(location: string) {
  return () => {
    haptic('light')
    track('landing_cta_click', { location, method: 'signup' })
  }
}

function Heading({
  eyebrow,
  title,
  id,
  intro,
}: {
  eyebrow: string
  title: string
  id: string
  intro?: string
}) {
  return (
    <header className="vv-head">
      <p className="vv-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {intro && <p className="vv-intro">{intro}</p>}
    </header>
  )
}

export function Plans() {
  return (
    <section className="vv-section" id="pricing" aria-labelledby="vv-pricing-h">
      <Heading
        eyebrow="Pricing"
        id="vv-pricing-h"
        title="Free for a household. One optional plan."
        intro="Free stays free. Keel Plus is £7.99 a month for the household and cancels any time. No commissions, no ads, no card needed to start."
      />
      <div className="vv-plans">
        <article className="vv-plan">
          <h3>Free</h3>
          <p className="vv-price">£0</p>
          <ul>
            {FREE_ROWS.map((r) => (
              <li key={r.text}>
                <Check size={16} aria-hidden="true" />
                {r.text}
              </li>
            ))}
          </ul>
          <a
            className="vv-btn vv-btn-ghost"
            href={appUrl('/signup')}
            onClick={signup('pricing_free')}
          >
            Create your free account
          </a>
        </article>
        <article className="vv-plan vv-plan-plus">
          <h3>Keel Plus</h3>
          <p className="vv-price">£7.99 a month</p>
          <ul>
            {PLUS_ROWS.map((r) => (
              <li key={r.text}>
                <Check size={16} aria-hidden="true" />
                {r.text}
              </li>
            ))}
          </ul>
          <p className="vv-fine">Cancel any time. No card needed to start.</p>
          <a className="vv-btn" href={appUrl('/signup')} onClick={signup('pricing_plus')}>
            Start free, add Plus later
          </a>
        </article>
      </div>
      <p className="vv-fine vv-center">You upgrade from inside your account once you are in.</p>
    </section>
  )
}

export function Questions() {
  return (
    <section className="vv-section" id="faq" aria-labelledby="vv-faq-h">
      <Heading eyebrow="Common questions" id="vv-faq-h" title="Straight answers." />
      <div className="vv-faq">
        {FAQ.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
