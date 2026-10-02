import type { Db } from 'mongodb'
import type { FamilyGroupDoc } from '../routes/family-group.js'

/** A roster entry resolves to an authenticated user either directly
 * (`member.id === userId` — the organizer, and members added through the
 * PRD-110 join-request flow where the entry was created with the user's id)
 * or through `member.user_id`, set when an organizer-invited pending member
 * accepts their invite (PRD-123) while `member.id` stays the stable identity
 * member twins and attributed insights already key on. */
export function memberMatchesUser(member: { id: string; user_id?: string }, userId: string): boolean {
  return member.id === userId || member.user_id === userId
}

export async function isFamilyOrganizer(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id: tenantId })
  return family?.members.some(member => memberMatchesUser(member, userId) && member.role === 'organizer' && member.status === 'active') === true
}

// Digital Estate Vault (Phase 3, Digital Twin gap audit): estate documents
// (wills, power of attorney) are sensitive enough that a child account
// shouldn't see them, but any confirmed adult in the household — not just
// the organizer — should be able to view/upload them. 'child' is the only
// role this codebase already excludes from adult-only features elsewhere
// (see family-join.ts's join-request role, hardcoded to 'adult').
export async function isFamilyAdult(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id: tenantId })
  return family?.members.some(member => memberMatchesUser(member, userId) && member.role !== 'child' && member.status === 'active') === true
}

/** Whole years from an ISO date_of_birth ('YYYY-MM-DD') to today, UTC.
 *  null when unset or unparseable — callers treat null as "don't infer"
 *  rather than guessing an age (PRD-119 retirement projection needs a
 *  real DOB; a wrong age is worse than none). */
export function ageFromDob(dateOfBirth: string | undefined | null): number | null {
  if (!dateOfBirth) return null
  const dob = new Date(`${dateOfBirth}T00:00:00Z`)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate())
  if (beforeBirthday) age -= 1
  return age
}
