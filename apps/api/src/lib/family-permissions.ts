import type { Db } from 'mongodb'
import type { FamilyGroupDoc } from '../routes/family-group.js'

export async function isFamilyOrganizer(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const family = await db.collection<FamilyGroupDoc>('family_groups').findOne({ tenant_id: tenantId })
  return family?.members.some(member => member.id === userId && member.role === 'organizer' && member.status === 'active') === true
}
