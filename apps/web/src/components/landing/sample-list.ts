/**
 * The one sample sheet the marketing page shows.
 *
 * The hero (Scroll 0) opens on it as a still; TheList (Scroll 2) shows
 * the same sheet one beat later, with the change note. Keeping the rows
 * in one place means the two shots can never drift into two different
 * families' lists — the cast invariant (Rivera: Dev, Marcia, Asha) is
 * also asserted by HomeExperience.test.tsx.
 *
 * Illustrative only: no tenant, no live data, never interactive.
 */

import type { MarketingSeenByLastSeen, MarketingSeenByListRow } from './MarketingSeenByList'

export const SAMPLE_ROWS: MarketingSeenByListRow[] = [
  { text: 'Car insurance — renewal 14 March', seenBy: ['Dev', 'Marcia'] },
  { text: 'School fees start 1 September — Asha', seenBy: ['Dev', 'Marcia'] },
  { text: 'Life policy — held by the provider', seenBy: ['Dev', 'Marcia'] },
  { text: 'Who to call from the policy papers', seenBy: ['Marcia'], pendingBy: ['Dev'] },
]

export const SAMPLE_LAST_SEEN: MarketingSeenByLastSeen[] = [
  { name: 'Dev', days: 9 },
  { name: 'Marcia', days: 21 },
]

/**
 * The change mechanic, said plainly: a change asks everyone to look again.
 * No names here — the footer's last-looked times already say who came back
 * and when, and naming them again would contradict Marcia's 21 days.
 */
export const SAMPLE_CHANGED_NOTE = 'Changed 9 days ago — everyone was asked to look again.'
