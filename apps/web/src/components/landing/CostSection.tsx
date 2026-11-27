/**
 * The ordinary cost, told calmly: two camera angles on the same quiet cost.
 * The first follows a parent. The second follows a small-team founder. Both
 * end on the same beat: time lost, an assumption broken, or a moment of
 * not knowing who holds the answer.
 *
 * "Most families run on one person's memory." is retained as the section
 * h2 because the home-page tests assert that exact phrase as the heading
 * that follows the hero and precedes the difficult day (DifficultDay). The
 * cinematic "two scenes + same problem, different unit" layering comes
 * from the brief's §4 / Scroll 1.
 *
 * Brand rules enforced by tests:
 *   - No disaster/emergency imagery (CostAndTrust.test.tsx).
 *   - No advice verbs ("you should", "buy", "gap", "not covered").
 *   - No "every adult has seen it" / no euphemisms (LandingHero.test.tsx).
 *
 * See docs/research/brand-and-story-guide-2026-11-08.md and
 * docs/marketing/cinematic-site-redesign-2026-11-26.md §4 / Scroll 1.
 */

export const COST_LINES = [
  'Most households and small teams already have what they need to keep going. The policies are filed. The contacts exist. The renewals have dates.',
  'What is missing is not information. It is who else knows it is there.',
  'A kitchen. A drawer. A partner on the phone.',
  'One adult has always been the one they ask. The other adult has always had to ask back.',
  'It sounds like small talk. It feels like being a passenger, not a partner.',
  "A founder's laptop. A signed document on a password-protected drive. A client renewal next Tuesday.",
  'When the founder is away, the business does not know whose inbox holds the renewal, where the originals live, who to call.',
  'The co-founder has to ask the founder. Often, the founder is not the one to answer.',
  'Same problem. Different unit.',
] as const

export function CostSection() {
  return (
    <section className="vv-section cost" id="cost" aria-labelledby="cost-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The ordinary cost</p>
        <h2 id="cost-h">Most families run on one person’s memory.</h2>
        <p className="vv-intro">{COST_LINES[0]}</p>
        <p className="vv-intro">{COST_LINES[1]}</p>
      </header>

      <div className="cost-scenes" aria-label="Two scenes of the same quiet cost">
        <article className="cost-scene cost-scene-a" aria-label="A household scene">
          <p className="cost-setting">{COST_LINES[2]}</p>
          <p className="cost-beat">{COST_LINES[3]}</p>
          <p className="cost-texture">{COST_LINES[4]}</p>
        </article>
        <article className="cost-scene cost-scene-b" aria-label="A small-team scene">
          <p className="cost-setting">{COST_LINES[5]}</p>
          <p className="cost-beat">{COST_LINES[6]}</p>
          <p className="cost-texture">{COST_LINES[7]}</p>
        </article>
      </div>

      <p className="cost-close">{COST_LINES[8]}</p>
    </section>
  )
}
