import { MarketingSeenByList } from './MarketingSeenByList'
import { SAMPLE_CHANGED_NOTE, SAMPLE_LAST_SEEN, SAMPLE_ROWS } from './sample-list'

/**
 * Scroll 2 — the list as character.
 *
 * The hero opens on the sample sheet as a still. This is the closer shot:
 * the same Rivera sheet one beat later, with the change note ('a change
 * asks everyone to look again') and the honest line underneath.
 *
 * The two lines are the section's whole argument, said without a verb of
 * advice: it moves no money, picks no product, gives no advice. The honest
 * line under the sheet is the claim the trust act later on the page earns.
 *
 * Copy rules enforced by tests:
 *   - no disaster/emergency vocabulary, no advice verbs
 *   - the illustrative caption is on every prop instance
 *   - the sheet is inert: no buttons, no links, no live data
 *
 * See docs/marketing/cinematic-site-redesign-2026-11-26.md §5 / Scroll 2.
 */

export const LIST_LINES = [
  'It doesn’t move money. It doesn’t pick a product. It doesn’t give advice.',
  'It holds what is already on file, and gives every adult the same thing to look at.',
] as const

export const LIST_LEAD =
  'They look. They confirm. The next time something needs to be found, they already know where to look.'

export const LIST_HONEST = 'The list never lies. “I’ve seen this” means the adult said so.'

export function TheList() {
  return (
    <section className="vv-section lk-list" aria-labelledby="lk-list-h">
      <header className="vv-head">
        <p className="vv-eyebrow">The saving grace</p>
        <h2 id="lk-list-h">The list is the quiet hero.</h2>
        <p className="vv-intro">{LIST_LINES[0]}</p>
        <p className="vv-intro">{LIST_LINES[1]}</p>
        <p className="lk-list-lead">{LIST_LEAD}</p>
      </header>

      <div className="lk-list-prop">
        <MarketingSeenByList
          familyName="The Rivera family"
          rows={SAMPLE_ROWS}
          lastSeen={SAMPLE_LAST_SEEN}
          changedNote={SAMPLE_CHANGED_NOTE}
          ariaLabel="Sample family list, after a change, as shown in the app"
        />
      </div>

      <p className="lk-list-honest">{LIST_HONEST}</p>
    </section>
  )
}
