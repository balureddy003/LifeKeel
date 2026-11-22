import type { BriefRecipient } from './api'

/** "Tom (invited)" for a partner who has not joined yet; the plain name otherwise. */
export function recipientLabel(r: BriefRecipient): string {
  return r.status === 'pending' ? `${r.name} (invited)` : r.name
}
