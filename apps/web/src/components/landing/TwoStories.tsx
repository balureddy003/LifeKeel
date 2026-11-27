/**
 * The fork — a home list and a team list answer different questions.
 *
 * The film's first two scrolls are deliberately shared: "Know where to
 * look" is true of a parent and of a small business. From here the story
 * splits, because the job the list does is not the same.
 *
 *   Household  → the record shows what is *missing*: a nomination that
 *                still names someone who left, a will that is not on
 *                file, a payment date that was never entered. Keel names
 *                the gap from what the household entered and leaves the
 *                decision with them. Never a recommendation (no-policy-picks).
 *   Small team → nothing is missing from the file; the knowledge simply
 *                sits with one person. The list makes that visible so a
 *                second name can go there.
 *
 * Claims: the household panel rests only on live rows (papers-on-file,
 * nomination-check, cover-on-file, payment-gaps). The team vertical has no
 * live claims yet, so its panel is illustrative and carries none — the
 * brief allows the panel provided it promises no feature the product lacks.
 *
 * See docs/marketing/cinematic-site-redesign-2026-11-26.md §4 (the two
 * cameras) and §7 (team scenes per chapter).
 */

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
  { fact: 'Pension nomination', state: 'still names someone who left' },
  { fact: 'Will', state: 'none on file' },
  { fact: 'Income cover', state: 'none recorded' },
  { fact: 'Policy payment', state: 'none on file for 41 days' },
]

export const TEAM_ROWS: readonly Row[] = [
  { fact: 'Client renewal · 14 March', state: 'one name' },
  { fact: 'Supplier contact', state: 'one name' },
  { fact: 'Payroll run', state: 'one name' },
]

export const HOUSEHOLD_BODY =
  'It is easy to see what you have. It is harder to see what you never added: a nomination that still names someone who left, a will that is not on file, cover for the second adult that was never entered. The list names the gap in plain words, from what you have entered. What to do about it stays with you.'

export const TEAM_BODY =
  'The renewal date is in one head. The supplier contact is in one inbox. The payroll run has no second pair of hands. Nothing is missing from the file — the knowledge is simply held by one person. The list puts that beside the thing itself, so a second name can go there.'

export const TWO_CAPTION = 'Two made-up examples.'
export const TWO_CLOSING =
  'The household list shows what is missing. The team list names the second person who needs to know.'

function Panel({
  who,
  title,
  body,
  rows,
  kind,
  claims,
  foot,
}: {
  who: string
  title: string
  body: string
  rows: readonly Row[]
  kind: 'gap' | 'held'
  claims?: readonly string[]
  foot: string
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
    </article>
  )
}

export function TwoStories() {
  return (
    <section className="vv-section lk-fork" aria-labelledby="lk-fork-h">
      <header className="vv-head">
        <p className="vv-eyebrow">Two jobs, one list</p>
        <h2 id="lk-fork-h">Different questions, same list.</h2>
        <p className="vv-intro">
          In a home, the list is there to show what is missing. In a small team, it is there to show
          what only one person knows.
        </p>
      </header>

      <div className="lk-fork-panels">
        <Panel
          who="In a household"
          title="What is missing."
          body={HOUSEHOLD_BODY}
          rows={HOUSEHOLD_ROWS}
          kind="gap"
          claims={HOUSEHOLD_CLAIMS}
          foot="A gap in the record, not a recommendation. Information only."
        />
        <Panel
          who="In a small team"
          title="What only one person knows."
          body={TEAM_BODY}
          rows={TEAM_ROWS}
          kind="held"
          foot="A made-up team example."
        />
      </div>

      <p className="lk-fork-caption">{TWO_CAPTION}</p>
      <p className="lk-fork-closing">{TWO_CLOSING}</p>
    </section>
  )
}
