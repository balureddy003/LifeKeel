import { ArrowRight } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'
import { BUSINESS_SITE_URL, businessDoorOpen } from './verticals'

/**
 * Scroll 3 — a difficult ordinary day.
 *
 * The rising action, told as a list rather than a drama. The family panel,
 * and (only while the business door is open) a small business panel, shaped identically: same heading,
 * same three numbered next things, same quiet link. The shape is the
 * argument — the same list holds up in both households.
 *
 * Copy rules:
 *   - ordinary difficulty only (a car, a renewal, a school run). Never a
 *     crisis, a hospital, a siren, a red button, or a call to act.
 *   - it describes what is on the list; it never says what to buy or which
 *     professional to use. Keel is not the insurer and not the solicitor.
 *   - the panels are illustrative and say so.
 *
 * The closing line names Keel, not Keel Plus, deliberately: the list this
 * scroll shows is the free one, and pricing must not read as if a calm
 * hard day is a paid feature.
 *
 * See docs/marketing/cinematic-site-redesign-2026-11-26.md §4 / Scroll 3.
 */

export const DAY_INTRO = [
  'A car fails the MOT the morning of a school run. A partner is travelling. The insurance papers are somewhere in the house.',
  'The list has the next three things on it. Nothing else.',
] as const

export const DAY_CLOSING =
  'Keel does not become your insurer or your solicitor on a difficult day. It is the place the family already knows to look.'

export const DAY_CAPTION = 'An example plan, from a made-up family.'
export const DAY_CAPTION_TWO = 'Example plans, from a made-up family and a made-up small business.'

interface Plan {
  who: string
  title: string
  rows: readonly string[]
  cta: string
  location: string
}

export const FAMILY_PLAN: Plan = {
  who: 'Family',
  title: 'A difficult morning',
  rows: [
    'School run — bus passes are in the kitchen drawer.',
    'MOT — call the garage on the policy card.',
    'Insurer — the number is on the policy in the file.',
  ],
  cta: 'Open the family’s plan',
  location: 'difficult_day_family',
}

/** Shown only while the business door is open (verticals.ts); its link goes to business.lifekeel.com. */
export const BUSINESS_PLAN: Plan = {
  who: 'Small business',
  title: 'A difficult morning',
  rows: [
    'Insurance — the policy number is on the business list.',
    'Main supplier — the number is on the business list.',
    'Accountant — who to call is on the business list.',
  ],
  cta: 'LifeKeel for business',
  location: 'difficult_day_business',
}

function Panel({ plan, href }: { plan: Plan; href?: string }) {
  const id = plan.who.toLowerCase()
  return (
    <article className="lk-day-panel" aria-labelledby={`${id}-who ${id}-h`}>
      <p className="lk-day-who" id={`${id}-who`}>
        {plan.who}
      </p>
      <h3 id={`${id}-h`}>{plan.title}</h3>
      <ol className="lk-day-rows">
        {plan.rows.map((row, i) => (
          <li key={row}>
            <span className="lk-day-n" aria-hidden="true">
              {i + 1}
            </span>
            <span>{row}</span>
          </li>
        ))}
      </ol>
      <a
        className="lk-day-link"
        href={href ?? appUrl('/signup')}
        onClick={() => {
          haptic('light')
          track('landing_cta_click', { location: plan.location, method: 'signup' })
        }}
      >
        {plan.cta}
        <ArrowRight size={15} aria-hidden="true" />
      </a>
    </article>
  )
}

export function DifficultDay() {
  const both = businessDoorOpen()
  return (
    <section className="vv-section lk-day" aria-labelledby="lk-day-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The quiet part</p>
        <h2 id="lk-day-h">A difficult ordinary day.</h2>
        <p className="vv-intro">{DAY_INTRO[0]}</p>
        <p className="lk-day-lead">{DAY_INTRO[1]}</p>
      </header>

      <div className="lk-day-panels" data-doors={both ? 'two' : 'family'}>
        <Panel plan={FAMILY_PLAN} />
        {both && <Panel plan={BUSINESS_PLAN} href={BUSINESS_SITE_URL} />}
      </div>

      <p className="lk-day-caption">{both ? DAY_CAPTION_TWO : DAY_CAPTION}</p>
      <p className="lk-day-closing">{DAY_CLOSING}</p>
    </section>
  )
}
