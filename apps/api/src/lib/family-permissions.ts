import type { Db } from 'mongodb'
import type { FamilyGroupDoc } from '../routes/family-group.js'

export async function isFamilyOrganizer(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id: tenantId })
  return family?.members.some(member => member.id === userId && member.role === 'organizer' && member.status === 'active') === true
}

// Digital Estate Vault (Phase 3, Digital Twin gap audit): estate documents
// (wills, power of attorney) are sensitive enough that a child account
// shouldn't see them, but any confirmed adult in the household — not just
// the organizer — should be able to view/upload them. 'child' is the only
// role this codebase already excludes from adult-only features elsewhere
// (see family-join.ts's join-request role, hardcoded to 'adult').
export async function isFamilyAdult(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id: tenantId })
  return family?.members.some(member => member.id === userId && member.role !== 'child' && member.status === 'active') === true
}
