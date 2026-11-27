import { ArrowRight } from 'lucide-react'
import { appUrl } from '@/lib/region'
import { track } from '@/lib/growth-track'
import { haptic } from '@/lib/haptics'

/**
 * Scroll 3 — a difficult ordinary day.
 *
 * The rising action, told as a list rather than a drama. Two panels, one
 * for the family and one for the team, shaped identically: same heading,
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
  'A car fails the MOT the morning of a school run. A renewal date arrives the day the founder is in court. A partner is travelling.',
  'The list has the next three things on it. Nothing else.',
] as const

export const DAY_CLOSING =
  'Keel does not become your insurer or your solicitor on a difficult day. It is the place the family or the team already knows to look.'

export const DAY_CAPTION = 'An example plan, from a made-up family and a made-up team.'

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

export const TEAM_PLAN: Plan = {
  who: 'Team',
  title: 'A difficult morning',
  rows: [
    'Renewal — client contact on the file; reply by 11.',
    'Court bundle — key document in shared list.',
    'Customer message — draft is ready in Inbox.',
  ],
  cta: 'Open the team’s plan',
  location: 'difficult_day_team',
}

function Panel({ plan }: { plan: Plan }) {
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
        href={appUrl('/signup')}
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
  return (
    <section className="vv-section lk-day" aria-labelledby="lk-day-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The quiet part</p>
        <h2 id="lk-day-h">A difficult ordinary day.</h2>
        <p className="vv-intro">{DAY_INTRO[0]}</p>
        <p className="lk-day-lead">{DAY_INTRO[1]}</p>
      </header>

      <div className="lk-day-panels">
        <Panel plan={FAMILY_PLAN} />
        <Panel plan={TEAM_PLAN} />
      </div>

      <p className="lk-day-caption">{DAY_CAPTION}</p>
      <p className="lk-day-closing">{DAY_CLOSING}</p>
    </section>
  )
}
