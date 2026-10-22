import type { Db } from 'mongodb'
import type { FamilyGroupDoc } from '../routes/family-group.js'

/** A roster entry resolves to an authenticated user either directly
 * (`member.id === userId` — the organizer, and members added through the
 * PRD-110 join-request flow where the entry was created with the user's id)
 * or through `member.user_id`, set when an organizer-invited pending member
 * accepts their invite (PRD-123) while `member.id` stays the stable identity
 * member twins and attributed insights already key on. */
export function memberMatchesUser(
  member: { id: string; user_id?: string },
  userId: string,
): boolean {
  return member.id === userId || member.user_id === userId
}

export async function isFamilyOrganizer(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const family = await db
    .collection<FamilyGroupDoc>('family_groups')
    .findOne({ tenant_id: tenantId })
  return (
    family?.members.some(
      (member) =>
        memberMatchesUser(member, userId) &&
        member.role === 'organizer' &&
        member.status === 'active',
    ) === true
  )
}

// Digital Estate Vault (Phase 3, Digital Twin gap audit): estate documents
// (wills, power of attorney) are sensitive enough that a child account
// shouldn't see them, but any confirmed adult in the household — not just
// the organizer — should be able to view/upload them. 'child' is the only
// role this codebase already excludes from adult-only features elsewhere
// (see family-join.ts's join-request role, hardcoded to 'adult').
export async function isFamilyAdult(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const family = await db
    .collection<FamilyGroupDoc>('family_groups')
    .findOne({ tenant_id: tenantId })
  return (
    family?.members.some(
      (member) =>
        memberMatchesUser(member, userId) && !isMinorMember(member) && member.status === 'active',
    ) === true
  )
}

/**
 * The one minor test every access boundary uses (R08): role 'child' or a
 * date of birth under 18. Marketing already used both; vault and invite
 * checks used role alone, so an adult-labelled member with an under-18 DOB
 * passed adult-only gates.
 */
export function isMinorMember(member: { role: string; date_of_birth?: string | null }): boolean {
  if (member.role === 'child') return true
  const age = ageFromDob(member.date_of_birth)
  return age !== null && age < 18
}

/** JWT roles that may change household-wide facts. Join-request and invite users get 'viewer'. */
const EDITOR_AUTH_ROLES = new Set(['owner', 'admin', 'operator', 'analyst'])

/**
 * May this user change shared household records (financial profile,
 * policies applied from documents or email) and export the household's
 * data (R04, R05)? Needs a non-viewer role and, when the user is on the
 * roster, an active adult entry. Viewers can read but not write.
 */
export async function isHouseholdEditor(
  db: Db,
  tenantId: string,
  userId: string,
  roles: readonly string[] | undefined,
): Promise<boolean> {
  if (!roles?.some((role) => EDITOR_AUTH_ROLES.has(role))) return false
  const family = await db
    .collection<FamilyGroupDoc>('family_groups')
    .findOne({ tenant_id: tenantId })
  const member = family?.members?.find((m) => memberMatchesUser(m, userId))
  if (!member) return true
  return member.status === 'active' && !isMinorMember(member)
}

/**
 * User ids whose linked roster member is a minor — role 'child' or a
 * date_of_birth under 18. Marketing and lifecycle paths subtract this set
 * so a consent flag can never put a minor's inbox on a campaign (intent
 * 09). Children can't hold sign-ins today (family-join blocks 'child'
 * invites), but member role and DOB are mutable on a live adult member —
 * this check does not rely on "a child user can't exist".
 */
export async function minorUserIds(
  db: Db,
  users: ReadonlyArray<{ id: string; tenant_id: string }>,
): Promise<Set<string>> {
  const tenantIds = [...new Set(users.map((u) => u.tenant_id))]
  if (tenantIds.length === 0) return new Set()
  const families = await db
    .collection<FamilyGroupDoc>('family_groups')
    .find({ tenant_id: { $in: tenantIds } }, { projection: { _id: 0, tenant_id: 1, members: 1 } })
    .toArray()
  const minors = new Set<string>()
  for (const user of users) {
    const family = families.find((f) => f.tenant_id === user.tenant_id)
    const member = family?.members.find((m) => memberMatchesUser(m, user.id))
    if (!member) continue
    if (isMinorMember(member)) minors.add(user.id)
  }
  return minors
}

/** The same exclusion over raw user documents — the shape the lifecycle
 *  and campaign queries return. */
export async function excludeMinorUsers<T extends Record<string, unknown>>(
  db: Db,
  users: T[],
): Promise<T[]> {
  const minors = await minorUserIds(
    db,
    users.map((u) => ({ id: u['id'] as string, tenant_id: u['tenant_id'] as string })),
  )
  return minors.size === 0 ? users : users.filter((u) => !minors.has(u['id'] as string))
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
