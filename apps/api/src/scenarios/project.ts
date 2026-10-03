/**
 * Scenario projection — extracted from routes/family-scenarios.ts so the
 * nightly watchlist job (jobs/scenario-watchlist.ts, PRD-136) recomputes
 * saved scenarios through the exact same path the read routes use:
 * profile + member scoping resolved server-side, never a frozen snapshot.
 */
import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import { calculateScenario, type ScenarioChange, type ScenarioResult } from './calculate.js'
import { toScenarioProfileInput, type MemberScope } from './profile-input.js'
import type { FinancialProfile } from '../routes/family-financial-profile.js'
import type { FamilyGroupDoc } from '../routes/family-group.js'

export type ProjectOutcome =
  | { status: 'ok'; result: ScenarioResult | null; has_live_data: boolean; member_name: string | null }
  | { status: 'bad_member'; member_name: string | null }

export async function projectScenario(db: Db, tenantId: string, inputs: ScenarioChange): Promise<ProjectOutcome> {
  const profile = await getTenantCollection<FinancialProfile>(db, 'family_financial_profile', tenantId).findOne({})
  let memberScope: MemberScope | undefined
  let memberName: string | null = null
  if (inputs.member_id) {
    const family = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId).findOne({})
    const member = family?.members.find((m) => m.id === inputs.member_id)
    // An unknown id is a client bug, not a data gap — refuse rather
    // than silently running a household projection under a member's name.
    if (!member) return { status: 'bad_member', member_name: null }
    memberName = member.name
    memberScope = { member_id: inputs.member_id, is_organizer: member.role === 'organizer' }
  }
  const input = toScenarioProfileInput(profile, memberScope)
  if (!input) return { status: 'ok', result: null, has_live_data: false, member_name: memberName }
  return { status: 'ok', result: calculateScenario(input, inputs), has_live_data: true, member_name: memberName }
}
