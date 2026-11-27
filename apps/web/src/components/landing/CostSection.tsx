/**
 * The ordinary cost, told calmly: two camera angles on the same quiet cost.
 * The first follows a parent. The second, shown only while the business door
 * is open (verticals.ts), follows a small business owner. Families and small
 * businesses are separate verticals; never a "team" or "co-founder" story.
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

import { businessDoorOpen } from './verticals'

export const COST_LINES = [
  'Most households already have what they need to keep going. The policies are filed. The contacts exist. The renewals have dates.',
  'What is missing is not information. It is who else knows it is there.',
  'A kitchen. A drawer. A partner on the phone.',
  'One adult has always been the one they ask. The other adult has always had to ask back.',
  'It sounds like small talk. It feels like being a passenger, not a partner.',
] as const

/** The small business owner's scene: shown only while the business door is open. */
export const BUSINESS_COST_LINES = [
  'A shop counter. An inbox. An accountant whose number is in one phone.',
  'When the owner is away, nobody else knows where the insurance is, who the supplier is, or who to call.',
  'The business runs on one person’s memory too.',
] as const

export function CostSection() {
  const both = businessDoorOpen()
  return (
    <section className="vv-section cost" id="cost" aria-labelledby="cost-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The ordinary cost</p>
        <h2 id="cost-h">Most families run on one person’s memory.</h2>
        <p className="vv-intro">{COST_LINES[0]}</p>
        <p className="vv-intro">{COST_LINES[1]}</p>
      </header>

      <div
        className="cost-scenes"
        data-doors={both ? 'two' : 'family'}
        aria-label={both ? 'Two scenes of the same quiet cost' : 'A household scene'}
      >
        <article className="cost-scene cost-scene-a" aria-label="A household scene">
          <p className="cost-setting">{COST_LINES[2]}</p>
          <p className="cost-beat">{COST_LINES[3]}</p>
          <p className="cost-texture">{COST_LINES[4]}</p>
        </article>
        {both && (
          <article className="cost-scene cost-scene-b" aria-label="A small business scene">
            <p className="cost-setting">{BUSINESS_COST_LINES[0]}</p>
            <p className="cost-beat">{BUSINESS_COST_LINES[1]}</p>
            <p className="cost-texture">{BUSINESS_COST_LINES[2]}</p>
          </article>
        )}
      </div>
    </section>
  )
}
