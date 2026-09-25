export type FamilyRole = 'organizer' | 'parent' | 'adult' | 'child'

export interface User {
  id: string
  name: string
  email: string
  avatar: string
}

export interface FamilyMemberUser {
  id: string
  name: string
  email: string
  role: FamilyRole
  emoji: string
  status: 'active' | 'pending'
  joinedAt: string
  /** ISO 'YYYY-MM-DD', optional — see apps/web/src/lib/age.ts for deriving age/years-until from it. */
  dateOfBirth?: string
}

export interface FamilyGroup {
  id: string
  name: string
  members: FamilyMemberUser[]
  inviteCode: string
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
