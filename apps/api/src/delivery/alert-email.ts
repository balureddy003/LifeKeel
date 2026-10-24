/**
 * The alert-floor email address for a tenant.
 *
 * `delivery_preferences.email_to` wins when the organizer picked an address,
 * but nothing in the signup/onboarding flow ever wrote one — so for nearly
 * every family both the Settings channel state ("No email address is on
 * file") and the delivery router's email floor had no address to work with,
 * even though the account clearly has an email. This resolver falls back to
 * the family roster's active adults (organizer first), then the account's
 * own user record for families that haven't finished setup. Used by
 * channel-state.ts (what Settings reports) and delivery-router.ts (what
 * alerts actually use) so the two can never disagree.
 */
import type { Db } from 'mongodb'
import { isMinorMember } from '../family/family-permissions.js'

interface RosterMember {
  role: string
  status: string
  email?: string
  date_of_birth?: string | null
}

export async function resolveAlertEmail(db: Db, tenantId: string): Promise<string | null> {
  const family = (await db.collection('family_groups').findOne({ tenant_id: tenantId })) as {
    members?: RosterMember[]
  } | null
  const members = family?.members ?? []
  const organizer = members.find((m) => m.role === 'organizer' && m.status === 'active' && m.email)
  if (organizer?.email) return organizer.email
  const adult = members.find((m) => m.status === 'active' && m.email && !isMinorMember(m))
  if (adult?.email) return adult.email
  // No family doc yet (the setup wizard hasn't run) — the account itself.
  const user = (await db.collection('users').findOne({ tenant_id: tenantId })) as {
    email?: string
    status?: string
  } | null
  if (!user?.email || user.status === 'removed' || user.status === 'erased') return null
  return user.email
}
