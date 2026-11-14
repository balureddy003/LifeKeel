/**
 * Who may see the engine's output for a household (intent 94, R11). Owner decision 2026-11-14 (A5): within
 * the family, adults can see each other's figures. Built narrowly: an ACTIVE member whose role is organizer,
 * parent or adult and who is not a minor. Everything else sees nothing and fails closed: children, pending or
 * removed members, any role not named here, and anyone not in the family.
 *
 * Deliberately NOT decided here (intent 93, A5): an adult who is leaving or in a dispute (H23, H25, H26), a
 * lodger's limited view (H29), and the no-account external link (PRD-229). Those stay unseen until the owner
 * decides. The age test mirrors `isMinorMember` in family-permissions.ts (role child, or date of birth under 18).
 */
export interface VisibilityMember {
  id: string
  user_id?: string
  role: string
  status: string
  date_of_birth?: string | null
}

const ADULT_ROLES = new Set(['organizer', 'parent', 'adult'])

function isUnder18(dob: string | null | undefined, now: Date): boolean {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false
  const birth = new Date(`${dob}T00:00:00Z`)
  if (Number.isNaN(birth.getTime())) return false
  const eighteenth = new Date(
    Date.UTC(birth.getUTCFullYear() + 18, birth.getUTCMonth(), birth.getUTCDate()),
  )
  return now < eighteenth
}

export function canSeeEngineOutput(
  members: readonly VisibilityMember[],
  userId: string,
  now: Date = new Date(),
): boolean {
  if (!userId) return false
  const m = members.find((x) => x.id === userId || x.user_id === userId)
  return (
    m !== undefined &&
    m.status === 'active' &&
    ADULT_ROLES.has(m.role) &&
    !isUnder18(m.date_of_birth, now)
  )
}

export function engineViewFor<T>(
  members: readonly VisibilityMember[],
  userId: string,
  output: T,
): T | null {
  return canSeeEngineOutput(members, userId) ? output : null
}
