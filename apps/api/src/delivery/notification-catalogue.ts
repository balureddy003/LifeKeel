/**
 * One catalogue of every kind of message LifeKeel sends a family: why they get
 * it, how it reaches them, whether they can mute it, and the only words a
 * lock screen may show.
 *
 * Rules the entries and the tests hold to:
 *  - A push body is chosen from this file, never composed from record data. It
 *    contains no digit, currency symbol or person/provider name, so it is safe
 *    on a shared or locked phone. The detail is behind sign-in.
 *  - Every kind states its reason in one sentence ("Why you got this").
 *  - A message never counts streaks, days away or "your family is waiting".
 *  - Safety-class and consent-controlled kinds are not mutable here; they have
 *    their own controls (critical alerts, the renewal-reminder scope grant).
 *  - `planned` kinds are reviewed copy for work not built yet. They are never
 *    returned to a family or sent; they exist so the lock-screen words get
 *    reviewed before anything uses them.
 */
import type { DeliveryPreferences } from './delivery-router.js'

export type KindChannel = 'push' | 'email' | 'in_app'

export interface NotificationKind {
  id: string
  /** Short name shown in settings. */
  label: string
  /** One sentence: why the family gets this. */
  reason: string
  status: 'live' | 'planned'
  channels: KindChannel[]
  /** Lock-screen words by variant. Empty when the kind never pushes. */
  push_bodies: Record<string, string>
  /** Whether the family can mute this kind in settings. */
  mutable: boolean
  /** Why it is not mutable, when it is not. Shown instead of a switch. */
  fixed_because?: string
  /** Touches separation, bereavement, health or a removed adult: never push by default. */
  safeguarding?: boolean
  /** Who receives it. Defaults to the family's adults. */
  audience?: 'adults' | 'requester'
}

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  {
    id: 'insight_alert',
    label: 'Alerts about your family list',
    reason: 'LifeKeel found something in the information you gave it that is worth a look.',
    status: 'live',
    channels: ['push', 'email'],
    push_bodies: {
      critical: 'An important update needs your attention.',
      normal: 'You have a new update in LifeKeel.',
    },
    mutable: true,
  },
  {
    id: 'policy_renewal_reminder',
    label: 'Policy renewal reminders',
    reason: 'You turned on renewal reminders, so LifeKeel tells you before a renewal date on file.',
    status: 'live',
    channels: ['push'],
    push_bodies: {},
    mutable: false,
    fixed_because: 'You control these with the renewal-reminder permission, not a mute switch.',
  },
  {
    id: 'quiet_care_digest',
    label: 'Monthly Quiet Care digest',
    reason: 'Once a month LifeKeel tells you what it checked and whether anything changed.',
    status: 'live',
    channels: ['email'],
    push_bodies: {
      ready: 'Your monthly Quiet Care digest is ready.',
      missed: 'There is an update about this month’s checks.',
    },
    mutable: true,
  },
  {
    id: 'weekly_heartbeat',
    label: 'Weekly family update',
    reason: 'You chose a weekly update on what moved in your family list.',
    status: 'live',
    channels: ['email'],
    push_bodies: { ready: 'Your weekly family update is ready.' },
    mutable: true,
  },
  {
    id: 'life_event_reminder',
    label: 'Life event reminders',
    reason: 'You reported a life event, so LifeKeel reminds you once about what is still open.',
    status: 'live',
    channels: ['email'],
    push_bodies: {},
    mutable: false,
    fixed_because: 'Sent once per event you report, only to the person who reported it.',
    safeguarding: true,
  },
  {
    id: 'join_approved',
    label: 'Your request to join was approved',
    reason: 'You asked to join a family and the organizer approved it.',
    status: 'live',
    channels: ['email'],
    push_bodies: {},
    mutable: false,
    fixed_because: 'Sent once to the person who asked to join.',
    audience: 'requester',
  },
  // ── Reviewed copy for work not built yet ────────────────────────────────
  {
    id: 'date_upcoming',
    label: 'Dates coming up on your family list',
    reason: 'A date you recorded, such as a renewal or an MOT, is close.',
    status: 'planned',
    channels: ['push', 'email'],
    push_bodies: { ready: 'A date on your family list is coming up.' },
    mutable: true,
  },
  {
    id: 'adult_action_needed',
    label: 'Waiting for you to look',
    reason: 'Another adult changed something that needs your confirmation.',
    status: 'planned',
    channels: ['email', 'in_app'],
    push_bodies: { ready: 'Something on the family list is waiting for you.' },
    mutable: true,
    safeguarding: true,
  },
  {
    id: 'join_request',
    label: 'Someone asked to join',
    reason: 'Someone used your family’s invite and is waiting for you to approve or decline.',
    status: 'planned',
    channels: ['email', 'in_app'],
    push_bodies: { ready: 'Someone asked to join your family list.' },
    mutable: false,
    fixed_because: 'The organizer is the only person who can approve a request.',
    safeguarding: true,
  },
  {
    id: 'document_ready_to_file',
    label: 'A document is ready to review',
    reason:
      'You added a document and LifeKeel prepared a draft. Nothing is saved until you confirm.',
    status: 'planned',
    channels: ['push', 'in_app'],
    push_bodies: { ready: 'A document is ready to review.' },
    mutable: true,
  },
  {
    id: 'holder_changed',
    label: 'A detail may need a look',
    reason: 'A record names someone who is no longer on the family list.',
    status: 'planned',
    channels: ['email', 'in_app'],
    push_bodies: { ready: 'A detail on your family list may need a look.' },
    mutable: true,
    safeguarding: true,
  },
  {
    id: 'monthly_note',
    label: 'Monthly family list note',
    reason: 'Once a month LifeKeel says what changed on your family list, or that nothing did.',
    status: 'planned',
    channels: ['email'],
    push_bodies: { ready: 'Your monthly family list note is ready.' },
    mutable: true,
  },
  {
    id: 'connector_needs_attention',
    label: 'A connected account needs attention',
    reason: 'An account you connected stopped working and LifeKeel can no longer check it.',
    status: 'planned',
    channels: ['push', 'email'],
    push_bodies: { ready: 'A connected account needs your attention.' },
    mutable: false,
    fixed_because: 'It tells you LifeKeel can no longer check something.',
  },
]

export const kindById = (id: string): NotificationKind | undefined =>
  NOTIFICATION_KINDS.find((k) => k.id === id)

/** Kinds a family sees and can act on. Planned kinds never leave this file. */
export const liveKinds = (): NotificationKind[] =>
  NOTIFICATION_KINDS.filter((k) => k.status === 'live')

/** Ids the settings API accepts in `kinds_muted`. */
export const MUTABLE_KIND_IDS = liveKinds()
  .filter((k) => k.mutable)
  .map((k) => k.id) as [string, ...string[]]

/** The words a lock screen may show for a kind. Throws on an unknown kind or variant. */
export function pushBodyFor(kindId: string, variant: string): string {
  const body = kindById(kindId)?.push_bodies[variant]
  if (!body) throw new Error(`No push body for ${kindId}/${variant}`)
  return body
}

/** The closed set of every push body that may exist. */
export const PUSH_BODIES: ReadonlySet<string> = new Set(
  NOTIFICATION_KINDS.flatMap((k) => Object.values(k.push_bodies)),
)

export function isKindMuted(
  prefs: Pick<DeliveryPreferences, 'kinds_muted'> | null | undefined,
  kindId: string,
): boolean {
  const kind = kindById(kindId)
  return !!kind?.mutable && !!prefs?.kinds_muted?.includes(kindId)
}

const PRODUCT_WORDS = new Set(['LifeKeel', 'Quiet', 'Care'])
/** Words a lock-screen sentence may open with. A name at the start is the one thing a capital letter cannot reveal. */
const OPENERS = new Set(['A', 'An', 'You', 'Your', 'Something', 'Someone', 'There'])

/**
 * Why a body is not safe on a lock screen: a digit, a currency symbol, an
 * opening word outside a small list of sentence openers, or a capitalised word
 * that is not the product name (a person or provider). Returns an empty list
 * when it is fine.
 */
export function lockScreenProblems(body: string): string[] {
  const problems: string[] = []
  if (/\d/.test(body)) problems.push('contains a digit')
  if (/[£$€¥]/.test(body)) problems.push('contains a currency symbol')
  const words = body.split(/\s+/)
  words.forEach((w, i) => {
    const bare = w.replace(/[^A-Za-z]/g, '')
    if (i === 0) {
      if (!OPENERS.has(bare)) problems.push(`opening word "${bare}"`)
    } else if (/^[A-Z]/.test(bare) && !PRODUCT_WORDS.has(bare)) {
      problems.push(`capitalised word "${bare}"`)
    }
  })
  return problems
}
