import type { BriefRecipient } from './api'
import { memberStatusLabel, type FamilyMemberUser } from './auth-types'

/**
 * "Tom (invite sent)" for a partner who has not joined yet, using the same
 * status words as Home, Family and Settings; the plain name otherwise.
 */
export function recipientLabel(
  r: BriefRecipient,
  inviteStatus?: FamilyMemberUser['inviteStatus'],
): string {
  if (r.status !== 'pending') return r.name
  return `${r.name} (${memberStatusLabel('pending', 'adult', inviteStatus).toLowerCase()})`
}
