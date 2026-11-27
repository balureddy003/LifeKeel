import type { HouseholdBrief } from './api'

/**
 * The one next-step line for a brief: who still needs to read and confirm it. Shared by the Briefs page's
 * latest-brief card and Home, so the same brief never reads differently on the two.
 */
export function briefNextLine(b: HouseholdBrief): string {
  const other = b.share?.for_member_name ?? 'the other adult'
  const c = b.confirmation
  // A blind check comes first: nothing else to read until the other adult has given their own figures.
  if (b.blind_check?.status === 'waiting_for_you')
    return 'Give your own figures first, then you will see theirs.'
  if (b.blind_check?.status === 'waiting_for_them')
    return `Waiting for ${other.split(/\s+/)[0]} to give their own figures.`
  if (!c?.creator_at)
    return b.share
      ? 'Read it and confirm, so you can both see the same numbers.'
      : 'Read it and confirm, so it is on record that you have seen these numbers.'
  if (!b.share) return 'Saved for you. Add another adult in Family when you want to share it.'
  if (!c.recipient_at) return `Waiting for ${other} to read and confirm.`
  return 'You have both seen the same numbers. Things change, so update the figures when they do.'
}
