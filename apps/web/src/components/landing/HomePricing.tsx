'use client'

import { ArrowUpRight, Check, Sparkles } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import './home-pricing.css'

const COMPARISON = [
  { feature: 'Your household profile and readiness view', free: 'Included', plus: 'Included' },
  { feature: 'Savings runway and “what if” scenarios', free: 'Included', plus: 'Included' },
  { feature: 'Document upload and storage', free: 'Included', plus: 'Included' },
  { feature: 'Family roster and Emergency Mode', free: 'Included', plus: 'Included' },
  {
    feature: 'Add policy details to your profile',
    free: 'Enter them yourself',
    plus: 'AI reads them; you review and apply',
  },
  { feature: 'Connect an email account', free: 'Optional connection', plus: 'Optional connection' },
  {
    feature: 'Summaries of financial email',
    free: 'Not included',
    plus: 'Included with a connected mailbox',
  },
  {
    feature: 'Read relevant financial email attachments',
    free: 'Not included',
    plus: 'AI document reading, ready for review',
  },
]

export function HomePricing() {
  const start = (plan: string) =>
    track('landing_cta_click', { location: `home_pricing_${plan}`, method: 'signup' })
  return (
    <section className="lk-home-pricing" id="pricing" aria-labelledby="home-pricing-title">
      <div className="lk-home-pricing-heading">
        <p className="home-kicker">TWO PLANS. ONE CLEAR CHOICE.</p>
        <h2 id="home-pricing-title">
          Start with the essentials.
          <br />
          Add help with the paperwork.
        </h2>
        <p>
          You can build a useful family picture for free. Choose Keel Plus when you want AI to help
          read documents and financial email.
        </p>
      </div>
      <div className="lk-home-plan-grid">
        <article className="lk-home-plan" data-plan="free" aria-labelledby="home-plan-free-title">
          <span className="lk-home-plan-label">FOR GETTING ORGANISED</span>
          <h3 id="home-plan-free-title">Free</h3>
          <p className="lk-home-price">
            <strong>£0</strong>
            <span>to use the core tools</span>
          </p>
          <p>Bring your information together and see where your household stands.</p>
          <ul>
            {[
              'Enter your savings, spending and cover',
              'See your readiness view and savings runway',
              'Explore “what if” changes using your figures',
              'Upload and store important documents',
              'Add your family’s details and use Emergency Mode',
            ].map((item) => (
              <li key={item}>
                <Check size={17} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <a className="lk-home-plan-cta" href={appUrl('/signup')} onClick={() => start('free')}>
            Create a free account <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <small>No credit card needed to start.</small>
        </article>
        <article
          className="lk-home-plan lk-home-plan-plus"
          data-plan="plus"
          aria-labelledby="home-plan-plus-title"
        >
          <span className="lk-home-plan-label">
            <Sparkles size={14} aria-hidden="true" /> FOR LESS MANUAL WORK
          </span>
          <h3 id="home-plan-plus-title">Keel Plus</h3>
          <p className="lk-home-price">
            <strong>£7.99</strong>
            <span>per month</span>
          </p>
          <p>
            Everything in Free, with two AI capabilities that help turn paperwork into usable
            information.
          </p>
          <ul>
            {[
              'Read provider, policy number, amounts and dates from uploaded documents',
              'Review and edit extracted details before applying them',
              'Get plain-language summaries of financial email',
              'Read relevant financial attachments from your connected mailbox',
              'Use confirmed information in your household picture',
            ].map((item) => (
              <li key={item}>
                <Check size={17} aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
          <a className="lk-home-plan-cta" href={appUrl('/signup')} onClick={() => start('plus')}>
            Start free, add Plus later <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <small>Upgrade inside your account. Cancel from your account.</small>
        </article>
      </div>
      <div className="lk-home-comparison-heading">
        <h3>What changes when you choose Plus?</h3>
        <p>
          The core tools stay available. The difference is help reading the information you add.
        </p>
      </div>
      <p className="lk-home-compare-hint">Scroll across to compare both plans.</p>
      <div
        className="lk-home-compare"
        role="region"
        aria-label="Free and Keel Plus feature comparison"
        tabIndex={0}
      >
        <table>
          <caption className="lk-home-sr">Included features in Free and Keel Plus</caption>
          <thead>
            <tr>
              <th scope="col">What you can do</th>
              <th scope="col">Free</th>
              <th scope="col">Keel Plus</th>
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((row) => (
              <tr key={row.feature}>
                <th scope="row">{row.feature}</th>
                <td>{row.free}</td>
                <td>{row.plus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lk-home-price-notes">
        <p>
          <strong>You stay in control.</strong> AI proposes information; you review it. Connecting
          email is optional, and a connection on its own does not include AI summaries on Free.
        </p>
        <p>
          AI features need Plus or an active account trial. Usage limits and processing availability
          apply. If Plus ends, your access returns to the Free plan.
        </p>
      </div>
    </section>
  )
}
