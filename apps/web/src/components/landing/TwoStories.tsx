/**
 * Two doors, two stories (owner, 27 Nov 2026). Families and small businesses
 * are separate verticals (family.lifekeel.com, business.lifekeel.com), so
 * this section never tells one "team" story with the nouns swapped.
 *
 *   Family   → the record shows what is *missing*: a nomination that still
 *              names a former partner, a will that is not on file, a payment
 *              date that was never entered. Keel names the gap from what the
 *              household entered and leaves the decision with them. Never a
 *              recommendation (no-policy-picks). Always shown.
 *   Business → a small business owner's door to business.lifekeel.com. Built,
 *              but hidden until that vertical is live (see verticals.ts):
 *              while hidden, the family panel stands alone.
 *
 * Claims: the family panel rests only on live rows (papers-on-file,
 * nomination-check, cover-on-file, payment-gaps). The business door names
 * the problem only, no feature, until business claims exist in claims.ts.
 *
 * See docs/marketing/cinematic-site-redesign-2026-11-26.md §4 (the two
 * cameras) and §7 (team scenes per chapter).
 */

import { BUSINESS_SITE_URL, businessDoorOpen } from './verticals'

export interface Row {
  fact: string
  state: string
}

export const HOUSEHOLD_CLAIMS = [
  'papers-on-file',
  'nomination-check',
  'cover-on-file',
  'payment-gaps',
] as const

export const HOUSEHOLD_ROWS: readonly Row[] = [
  { fact: 'Pension nomination', state: 'still names a former partner' },
  { fact: 'Will', state: 'none on file' },
  { fact: 'Income cover', state: 'none recorded' },
  { fact: 'Policy payment', state: 'none on file for 41 days' },
]

/** The business door's made-up sheet: where things sit today, in one owner's head. No feature claims. */
export const BUSINESS_ROWS: readonly Row[] = [
  { fact: 'Insurance', state: 'in the owner’s inbox' },
  { fact: 'Main supplier', state: 'in the owner’s phone' },
  { fact: 'Accountant', state: 'in the owner’s head' },
]

export const HOUSEHOLD_BODY =
  'It is easy to see what you have. It is harder to see what you never added. A nomination may still name a former partner. A will may not be on file. Cover for the second adult may never have been entered. The list names the gap in plain words, from what you have entered. What to do about it stays with you.'

export const BUSINESS_BODY =
  'In a small business, the key things often live with the owner. The insurance is in their inbox. The supplier is in their phone. The accountant is in their head. If the owner is away, nobody else knows where to look.'

export const FAMILY_CAPTION = 'A made-up example.'
export const TWO_CAPTION = 'Two made-up examples, one for each list.'
export const TWO_CLOSING =
  'A family’s list shows what is missing. A small business gets a list of its own.'

function Panel({
  who,
  title,
  body,
  rows,
  kind,
  claims,
  foot,
  door,
}: {
  who: string
  title: string
  body: string
  rows: readonly Row[]
  kind: 'gap' | 'business'
  claims?: readonly string[]
  foot: string
  door?: React.ReactNode
}) {
  const h = `lk-fork-${kind}-h`
  return (
    <article className="lk-fork-panel" data-kind={kind} data-claims={claims?.join(' ')}>
      <p className="lk-fork-who">{who}</p>
      <h3 id={h}>{title}</h3>
      <p className="lk-fork-body">{body}</p>
      <dl className="lk-fork-sheet">
        {rows.map((r) => (
          <div className="lk-fork-row" key={r.fact}>
            <dt>{r.fact}</dt>
            <dd>{r.state}</dd>
          </div>
        ))}
      </dl>
      <p className="lk-fork-foot">{foot}</p>
      {door}
    </article>
  )
}

export function TwoStories() {
  const both = businessDoorOpen()
  return (
    <section className="vv-section lk-fork" id="stories" aria-labelledby="lk-fork-h">
      <header className="vv-head">
        <p className="vv-eyebrow">{both ? 'A family, and a small business' : 'The family list'}</p>
        <h2 id="lk-fork-h">{both ? 'Two stories, two lists.' : 'What the list is for.'}</h2>
        <p className="vv-intro">
          {both
            ? 'In a home, the list is there to show what is missing. In a small business, it is there to show what only the owner knows.'
            : 'In a home, the list is there to show what is missing, not only what is there.'}
        </p>
      </header>

      <div className="lk-fork-panels" data-doors={both ? 'two' : 'family'}>
        <Panel
          who="For a family"
          title="What is missing."
          body={HOUSEHOLD_BODY}
          rows={HOUSEHOLD_ROWS}
          kind="gap"
          claims={HOUSEHOLD_CLAIMS}
          foot="A gap in the record, not a recommendation. Information only."
        />
        {both && (
          <Panel
            who="For a small business"
            title="What only the owner knows."
            body={BUSINESS_BODY}
            rows={BUSINESS_ROWS}
            kind="business"
            foot="A made-up small business."
            door={
              <a className="lk-fork-door" href={BUSINESS_SITE_URL}>
                LifeKeel for business →
              </a>
            }
          />
        )}
      </div>

      <p className="lk-fork-caption">{both ? TWO_CAPTION : FAMILY_CAPTION}</p>
      {both && <p className="lk-fork-closing">{TWO_CLOSING}</p>}
    </section>
  )
}
