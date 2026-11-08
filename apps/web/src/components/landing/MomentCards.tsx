import { CalendarClock, Copy, UserCheck, type LucideIcon } from 'lucide-react'
import './moments.css'

/**
 * Three ordinary moments, told as the family would tell them. Each one rests on a live claim
 * (claims.ts) and carries its honest limit beside it. Nothing here says what a family should buy or
 * name, and no one is shown watching another adult.
 * Claims: nomination-check, runway + household-brief, renewals-duplicates.
 * The story system is in docs/research/end-to-end-story-2026-11-08.md.
 */
export const MOMENTS: {
  claim: string
  icon: LucideIcon
  title: string
  story: string
  limit: string
}[] = [
  {
    claim: 'nomination-check',
    icon: UserCheck,
    title: 'The nomination nobody updated',
    story:
      'Dev and Marcia had a baby eighteen months ago. Both meant to update the life policy. When they put it on the list, it showed the nomination was older than the child on their family record. They dealt with it themselves.',
    limit: 'Compares two records you entered. It never says who to name.',
  },
  {
    claim: 'household-brief',
    icon: CalendarClock,
    title: 'The number they had never looked at together',
    story:
      'A nursery offer arrived. Dev thought they had four months of savings. Marcia thought two. With the start date and the monthly fee on one brief, they both opened the same number and how it was worked out.',
    limit: 'Works from the figures you enter. It is an estimate, not advice.',
  },
  {
    claim: 'renewals-duplicates',
    icon: Copy,
    title: 'The renewal that crept up',
    story:
      'The home policy renewed and the price went up. Dev had entered the same policy twice, and the list flagged the duplicate and showed the renewal date coming up. They saw it before the next payment.',
    limit: 'Reminders are opt-in. Duplicates are flagged for the same policy only.',
  },
]

export function MomentCards() {
  return (
    <section className="vv-section mm" id="moments" aria-labelledby="mm-h">
      <header className="vv-head">
        <p className="vv-eyebrow">Three ordinary moments</p>
        <h2 id="mm-h">Things that usually live in one head.</h2>
        <p className="vv-intro">
          Nothing dramatic. Each one is just easier when both adults are looking at the same list.
        </p>
      </header>
      <ul className="mm-grid">
        {MOMENTS.map(({ claim, icon: Icon, title, story, limit }) => (
          <li key={claim} className="mm-card" data-claim={claim}>
            <span className="vv-icon">
              <Icon size={22} aria-hidden="true" />
            </span>
            <h3>{title}</h3>
            <p>{story}</p>
            <p className="mm-limit">{limit}</p>
          </li>
        ))}
      </ul>
      <p className="vv-fine mm-fine">Made-up family. Made-up dates.</p>
    </section>
  )
}
