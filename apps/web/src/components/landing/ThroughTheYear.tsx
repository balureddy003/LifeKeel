/**
 * Scroll 4 — through the year.
 *
 * The rest beat after the difficult day: three small observed moments, one
 * household and two team, that show the list working on ordinary weeks.
 * The pacing relaxes here on purpose — no dashboard, no chart, no growth
 * arrow, no call to action. Each vignette ends on the same prop grammar as
 * the hero: a paper row, a real name, a tick in ink.
 *
 * The ticks are drawn once (the same 220ms tick as the sample list) and
 * settle; there is no scroll choreography, because this scroll is where the
 * film lets the reader breathe.
 *
 * Copy rules:
 *   - three vignettes, never four; nothing added to make the scroll longer.
 *   - no percentages, no platform claims, no CTA.
 *   - each moment rests on live rows in claims.ts.
 *
 * See docs/marketing/cinematic-site-redesign-2026-11-26.md §4 / Scroll 4.
 */

export interface Vignette {
  /** Short date mark above the title: February, Spring, Autumn. */
  when: string
  title: string
  body: string
  /** The row that lands on the list in this moment. */
  row: string
  /** Adults whose tick appears on the row. */
  seenBy: string[]
  claims: string[]
}

export const VIGNETTES: Vignette[] = [
  {
    when: 'February',
    title: 'A renewal in February.',
    body: 'The car insurance email arrives. It goes onto the list. The partner looks; they have seen it. The renewal goes through on time, even with a sick four-year-old at home.',
    row: 'Car cover renews 14 February',
    seenBy: ['Marcia'],
    claims: ['family-list', 'dates-coming-up', 'every-adult-confirms'],
  },
  {
    when: 'Spring',
    title: 'A trip deposit in spring.',
    body: 'The booking number turns up between two other emails. It goes onto the list. Two names tick it. Six months later, it is the answer to a question that did not have to be asked out loud.',
    row: 'Trip deposit — reference 8814',
    seenBy: ['Dev', 'Marcia'],
    claims: ['family-list', 'every-adult-confirms'],
  },
  {
    when: 'Autumn',
    title: 'A new adult in autumn.',
    body: 'Marcia’s sister moves in to help for the winter. She joins with a code, Marcia approves her, and she looks at the same list. The question — where is the boiler cover, who do we call? — stops being a question.',
    row: 'Boiler cover — who to call is on the policy papers',
    seenBy: ['Marcia', 'Lena'],
    claims: ['join-with-code', 'every-adult-confirms', 'family-list'],
  },
]

export const YEAR_CLOSING =
  'The list is rarely the right answer to a hard day. It is more often the right answer to a Tuesday.'

export const YEAR_CAPTION = 'Three example list entries, from a made-up family.'

function Vignette({ v }: { v: Vignette }) {
  return (
    <article className="lk-year-card" data-claims={v.claims.join(' ')}>
      <p className="lk-year-when">{v.when}</p>
      <h3>{v.title}</h3>
      <p className="lk-year-body">{v.body}</p>
      <div className="lk-year-prop">
        <span className="lk-year-row">{v.row}</span>
        <span className="lk-year-seen">
          {v.seenBy.map((name) => (
            <span key={name} className="lk-year-person">
              <span className="lk-msl-tick" aria-hidden="true">
                ✓
              </span>
              {name}
            </span>
          ))}
        </span>
      </div>
    </article>
  )
}

export function ThroughTheYear() {
  return (
    <section className="vv-section lk-year" aria-labelledby="lk-year-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The ordinary week</p>
        <h2 id="lk-year-h">Through the year.</h2>
      </header>

      <div className="lk-year-grid">
        {VIGNETTES.map((v) => (
          <Vignette key={v.title} v={v} />
        ))}
      </div>

      <p className="lk-year-caption">{YEAR_CAPTION}</p>
      <p className="lk-year-closing">{YEAR_CLOSING}</p>
    </section>
  )
}
