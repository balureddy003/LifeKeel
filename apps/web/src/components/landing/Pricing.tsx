'use client'

import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import './landing.css'
import './hero.css'
import './bands.css'

interface Row {
  claim: string
  text: string
}

export const FREE_ROWS: Row[] = [
  { claim: 'emergency-mode', text: 'Emergency Mode' },
  { claim: 'what-if', text: '"What if" scenarios on your figures' },
  { claim: 'readiness-snapshot', text: 'A readiness snapshot' },
  { claim: 'vault', text: 'Document upload and storage' },
  { claim: 'connect-email', text: 'Connect an email account' },
  { claim: 'family-roster', text: 'A roster for the whole family' },
]

export const PLUS_ROWS: Row[] = [
  { claim: 'free-plan', text: 'Everything in Free' },
  {
    claim: 'household-record',
    text: 'Unlimited household briefs and a record kept current as figures change',
  },
  {
    claim: 'plus-reads-policy',
    text: 'Reads provider, policy number, amount and dates from an uploaded policy, for you to confirm',
  },
  { claim: 'plus-inbox', text: 'A plain-language summary of financial email' },
]

function Plan({
  name,
  price,
  rows,
  cta,
  location,
  plus,
}: {
  name: string
  price: string
  rows: Row[]
  cta: string
  location: string
  plus?: boolean
}) {
  return (
    <article className={`lk-plan-card${plus ? ' plus' : ''}`}>
      <header>
        <h3>{name}</h3>
        <span className="lk-price">{price}</span>
      </header>
      <ul>
        {rows.map((r) => (
          <li key={r.text}>{r.text}</li>
        ))}
      </ul>
      {plus && <p className="lk-fine">Cancel any time. No card needed to start.</p>}
      <a
        className={plus ? 'lk-btn' : 'lk-btn lk-btn-quiet'}
        href={appUrl('/signup')}
        onClick={() => {
          haptic('light')
          track('landing_cta_click', { location, method: 'signup' })
        }}
      >
        {cta}
      </a>
    </article>
  )
}

export function Pricing() {
  return (
    <section className="lk-band" id="pricing" aria-labelledby="lk-pricing-h">
      <p className="lk-eyebrow">Pricing</p>
      <h2 id="lk-pricing-h">Free to start. One optional paid plan.</h2>
      <p className="lk-intro">
        Checking what you have told Keel starts free. The only paid plan adds AI document reading.
        No commissions, no ads, no card needed to start.
      </p>
      <div className="lk-plans">
        <Plan
          name="Free"
          price="£0"
          rows={FREE_ROWS}
          cta="Create your free account"
          location="pricing_free"
        />
        <Plan
          name="Keel Plus"
          price="£7.99 a month"
          rows={PLUS_ROWS}
          cta="Start free, add Plus later"
          location="pricing_plus"
          plus
        />
      </div>
      <p className="lk-fine lk-key">
        Cancel Keel Plus any time from your account. You upgrade from inside your account once you
        are in.
      </p>
    </section>
  )
}
