export type FamilyRole = 'organizer' | 'parent' | 'adult' | 'child'

export interface User {
  id: string
  name: string
  email: string
  avatar: string
  /** ISO-3166 alpha-2 (e.g. 'GB'), from /auth/me — used to localize the emergency-services number. */
  country?: string
  /** Only meaningful when the server flags it false — undefined (older
   *  accounts, verification disabled) must not read as unverified. */
  emailVerified?: boolean | undefined
}

export type RelationshipLabel = 'my_child' | 'partners_child' | 'shared_child' | 'other_child'

/** Intent 25: display labels for a child's relationship in a blended family. */
export const RELATIONSHIP_LABELS: Record<RelationshipLabel, string> = {
  my_child: 'My child',
  partners_child: "Partner's child",
  shared_child: 'Shared child',
  other_child: 'Other dependant',
}

export interface FamilyMemberUser {
  id: string
  name: string
  email: string
  role: FamilyRole
  emoji: string
  status: 'active' | 'pending'
  joinedAt: string
  /** The `users.id` this entry binds to after invite acceptance (PRD-123) — id stays the roster identity. */
  userId?: string
  /** Intent 25: blended-family relationship on child members — display-only. */
  relationshipLabel?: RelationshipLabel
  /** ISO 'YYYY-MM-DD', optional — see apps/web/src/lib/age.ts for deriving age/years-until from it. */
  dateOfBirth?: string
}

export interface FamilyGroup {
  id: string
  name: string
  members: FamilyMemberUser[]
  inviteCode: string
  /** Organizer-authored household note Ask Keel reads as background (gap 8). */
  contextNote?: string
}

export const ROLE_LABELS: Record<FamilyRole, string> = {
  organizer: 'Organizer',
  parent: 'Parent / Guardian',
  adult: 'Adult',
  child: 'Child',
}

export const ROLE_DESCRIPTIONS: Record<FamilyRole, string> = {
  organizer: 'Full control — manages members, roles, and all family data',
  parent: 'Can manage child settings and approve actions',
  adult: 'Can view and contribute to family financial data',
  child: 'Limited access — view only, requires adult approval',
}

export const ROLE_EMOJI: Record<FamilyRole, string> = {
  organizer: '👑',
  parent: '🛡️',
  adult: '👤',
  child: '🧒',
}

/** What to show for a member's status. "Pending" alone read as an unsent invite on members who were simply added in setup. Children never get their own sign-in — the invite flow rejects minors server-side — so a pending child gets a label describing who manages the record, not an invitation that can never be accepted. */
export function memberStatusLabel(status: 'pending' | 'active' | string, role?: string): string {
  if (status !== 'pending') return 'Active'
  return role === 'child' ? 'Managed by adults' : 'Not joined yet'
}
