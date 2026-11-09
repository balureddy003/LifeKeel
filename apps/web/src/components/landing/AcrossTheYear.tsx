import { Car, Home, Plane, School, type LucideIcon } from 'lucide-react'
import './year.css'

/**
 * One household, four moments in a year, one list. The platform story from
 * docs/research/platform-story-and-gtm-2026-11-08.md: the family never starts again in a new
 * app. Each moment rests on live claims (claims.ts) and carries its honest limit. Nothing says what
 * to buy or name, and nothing acts for the family: they send, they decide.
 */
export const YEAR: {
  season: string
  icon: LucideIcon
  title: string
  story: string
  limit: string
  claims: string[]
}[] = [
  {
    season: 'Spring',
    icon: Car,
    title: 'The car',
    story:
      'Dev adds the car, its policy and who to ring if it breaks down. The MOT date lands under “coming up”, and Marcia confirms she has seen it.',
    limit: 'Dates come from what you enter. It does not check any register.',
    claims: ['family-list', 'recovery-contact', 'dates-coming-up', 'every-adult-confirms'],
  },
  {
    season: 'Summer',
    icon: Plane,
    title: 'The trip',
    story:
      'Before they go, the travel policy, the assistance line printed on it and the dates go on the same list. If something happens abroad, the first steps use what is on it.',
    limit: 'Information only. You ring your insurer and decide what to do.',
    claims: ['family-list', 'who-to-call', 'first-steps-from-list'],
  },
  {
    season: 'Autumn',
    icon: School,
    title: 'The nursery fees',
    story:
      'The start date and the monthly fee become one brief. Dev and Marcia open the same number and how it was worked out.',
    limit: 'Works from the figures you enter. It is an estimate, not advice.',
    claims: ['household-brief', 'runway', 'dates-coming-up'],
  },
  {
    season: 'Winter',
    icon: Home,
    title: 'The mortgage fix ending',
    story:
      'The date has been on the list for months, so a brief with a number arrives well before it ends, not a surprise the week of.',
    limit: 'Names no lender and compares no deals.',
    claims: ['dates-coming-up', 'household-brief', 'no-policy-picks'],
  },
]

export function AcrossTheYear() {
  return (
    <section className="vv-section yr" id="across-the-year" aria-labelledby="yr-h">
      <header className="vv-head">
        <p className="vv-eyebrow">Across the year</p>
        <h2 id="yr-h">One list, four moments in the year.</h2>
        <p className="vv-intro">
          Dev and Marcia do not start again for each one. The car, the trip, the fees and the
          mortgage all sit on the list their family already looks at.
        </p>
      </header>
      <ol className="yr-grid">
        {YEAR.map(({ season, icon: Icon, title, story, limit, claims }) => (
          <li key={season} className="yr-card" data-claims={claims.join(' ')}>
            <p className="yr-season">
              <span className="vv-icon">
                <Icon size={20} aria-hidden="true" />
              </span>
              {season}
            </p>
            <h3>{title}</h3>
            <p>{story}</p>
            <p className="yr-limit">{limit}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
