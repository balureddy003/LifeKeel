/**
 * Push payloads (PRD-140). A push appears on lock screens, including on shared
 * devices, so it carries a generic title, a generic body and a deep link, and
 * nothing else: no amounts, no names of people or policies, no provider names,
 * no confidence figures, and never an approve or dismiss link. The detail is
 * behind the deep link, after sign-in.
 */
import type { InsightNotification } from './channels.js'

export interface PushPayload {
  title: string
  body: string
  /** Deep link into the app. The only variable part of a push. */
  url: string
}

const TITLE = 'LifeKeel'

/** Generic by urgency; the text never depends on the insight's content. */
export function buildAlertPushPayload(
  n: Pick<InsightNotification, 'urgency' | 'action_url'>,
): PushPayload {
  return {
    title: TITLE,
    body:
      n.urgency === 'critical'
        ? 'An important update needs your attention.'
        : 'You have a new update in LifeKeel.',
    url: n.action_url,
  }
}

/** Push-shaped payloads for the digest and heartbeat (they stay email-only; see PRD-139). */
export function buildDigestPushPayload(
  kind: 'quiet_care_digest' | 'quiet_care_digest_missed' | 'weekly_heartbeat',
  appUrl: string,
): PushPayload {
  const body =
    kind === 'quiet_care_digest'
      ? 'Your monthly Quiet Care digest is ready.'
      : kind === 'quiet_care_digest_missed'
        ? 'There is an update about this month’s checks.'
        : 'Your weekly family update is ready.'
  return { title: TITLE, body, url: appUrl }
}
