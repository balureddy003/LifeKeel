import type { HouseholdBrief } from './api'

/**
 * The one next-step line for a brief: who still needs to read and confirm it. Shared by the Briefs page's
 * latest-brief card and Home, so the same brief never reads differently on the two.
 */
export function briefNextLine(b: HouseholdBrief): string {
  const other = b.share?.for_member_name ?? 'the other adult'
  const c = b.confirmation
  if (!c?.creator_at)
    return b.share
      ? 'Read it and confirm, so you can both see the same numbers.'
      : 'Read it and confirm, so it is on record that you have seen these numbers.'
  if (!b.share) return 'Saved for you. Add another adult in Family when you want to share it.'
  if (!c.recipient_at) return `Waiting for ${other} to read and confirm.`
  return 'You have both seen the same numbers. Things change, so update the figures when they do.'
}
