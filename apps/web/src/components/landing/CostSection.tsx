/**
 * The ordinary cost, told calmly: one person in a family remembers everything. No disaster, no
 * fear, no advice (brand guide: stakes are everyday dignity). Observational, so it rests on no
 * product claim; the product claims come in the story that follows.
 * See docs/research/platform-story-and-gtm-2026-11-08.md.
 */
export const COST_LINES = [
  'The car insurance is in one email. The school pickup is in one head. The will is in one drawer.',
  'That is fine, until that person is away, busy or unwell.',
] as const

export function CostSection() {
  return (
    <section className="vv-section cost" id="cost" aria-labelledby="cost-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The ordinary cost</p>
        <h2 id="cost-h">Most families run on one person’s memory.</h2>
        {COST_LINES.map((line) => (
          <p key={line} className="vv-intro">
            {line}
          </p>
        ))}
      </header>
    </section>
  )
}
