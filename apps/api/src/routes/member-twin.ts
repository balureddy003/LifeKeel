/**
 * GET /family/members/:id/twin — the member twin read model (PRD-117).
 *
 * The product vision's member micro-agents (Adult/Youth twins) need a
 * per-member view of the Family Twin first — this is that view. It
 * assembles, for one roster member:
 *
 *   member            — roster record + derived age
 *   financial.earner  — their income/protection slice (PRD-104):
 *                       their household.members[] entry, or the
 *                       household-level earner fields when the member is
 *                       the organizer (the top-level fields predate
 *                       member-level earners and are the organizer's own)
 *   financial.policies        — policies[] attributed via member_id
 *   financial.education_funds — funds attributed via member_id, falling
 *                               back to a first-name child_name match for
 *                               funds recorded before member linking
 *                               existed (PRD-104 made the field optional)
 *   financial.insights        — open family insights attributed to them
 *                               via feature_snapshot.member_id (and the
 *                               renewal window's member attribution
 *                               field), same attribution the engine's
 *                               entity_key already derives from
 *
 * Everything is computed fresh on read — a member twin is a read model,
 * not a stored document, so it can never drift from the profile/roster
 * underneath it. Tier 0 — pure read, no side effects.
 *
 * Visibility note: any authenticated family member can read any member's
 * twin, matching the financial profile's existing household-wide
 * visibility. Per-member field permissions are a separate, later design
 * decision (same flag PRD-110 raised for member access generally).
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import type { FamilyGroupDoc, FamilyMemberDoc } from './family-group.js'
import type { FinancialProfile } from './family-financial-profile.js'

// Insight states that still represent an open concern for the member —
// same set /family/readiness uses. Keep in sync.
const OPEN_INSIGHT_STATES = ['identified', 'sent', 'execution_failed', 'snoozed'] as const

const FAMILY_DETECTOR_IDS = [
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
]

function ageFrom(dateOfBirth: string | undefined): number | null {
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

// Funds recorded before PRD-104's member_id may only name the child —
// match on the member's first name as the documented fallback.
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

export function registerMemberTwinRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { id: string } }>('/family/members/:id/twin', async (req, reply) => {
    const { tenant_id } = req.authContext
    const memberId = req.params.id

    const group = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenant_id).findOne({})
    const member: FamilyMemberDoc | undefined = group?.members.find((m) => m.id === memberId)
    if (!member) return reply.status(404).send({ error: 'Family member not found' })

    const profile = await getTenantCollection<FinancialProfile>(db, 'family_financial_profile', tenant_id).findOne({})

    // Earner slice: an explicit per-member earner wins; absent that, the
    // household-level earner fields belong to the organizer (they're the
    // "primary earner" the wizard has always collected).
    const memberEarner = (profile?.household.members ?? []).find((e) => e.member_id === memberId)
    const earner = memberEarner
      ? {
          employment_status: memberEarner.employment_status,
          monthly_salary_minor: memberEarner.monthly_salary_minor,
          income_protection_monthly_minor: memberEarner.income_protection_monthly_minor,
        }
      : member.role === 'organizer' && profile?.household
        ? {
            employment_status: profile.household.employment_status,
            monthly_salary_minor: profile.household.monthly_salary_minor,
            income_protection_monthly_minor: profile.household.income_protection_monthly_minor,
          }
        : null

    const policies = (profile?.policies ?? [])
      .filter((p) => p.member_id === memberId)
      .map((p) => ({
        type: p.type,
        provider: p.provider,
        coverage_amount_minor: p.coverage_amount_minor,
        monthly_premium_minor: p.monthly_premium_minor,
        renewal_date: p.renewal_date,
      }))

    const name = firstName(member.name)
    const education_funds = (profile?.education_funds ?? [])
      .filter((f) => f.member_id === memberId || (name && f.child_name && firstName(f.child_name) === name))
      .map((f) => {
        const monthsRemaining = Math.max(0, Math.round((f.years_remaining ?? 0) * 12))
        const remainingMinor = Math.max(0, (f.target_savings_minor ?? 0) - (f.current_savings_minor ?? 0))
        return {
          child_name: f.child_name,
          current_savings_minor: f.current_savings_minor ?? 0,
          target_savings_minor: f.target_savings_minor ?? 0,
          years_remaining: f.years_remaining ?? 0,
          months_remaining: monthsRemaining,
          // The pace needed to hit the target — informational, not advice.
          needed_monthly_minor: monthsRemaining > 0 ? Math.ceil(remainingMinor / monthsRemaining) : 0,
        }
      })

    const insights = (await db
      .collection('insights')
      .find(
        {
          tenant_id,
          detector_id: { $in: FAMILY_DETECTOR_IDS },
          state: { $in: [...OPEN_INSIGHT_STATES] },
          $or: [
            { 'feature_snapshot.member_id': memberId },
            { 'feature_snapshot.soonest_renewal_member_id': memberId },
            { entity_key: memberId },
          ],
        },
        { projection: { _id: 0, id: 1, detector_id: 1, rule_id: 1, hypothesis: 1, reasoning: 1, confidence: 1, urgency: 1, state: 1, created_at: 1 } },
      )
      .toArray()) as Record<string, unknown>[]

    return {
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        status: member.status,
        date_of_birth: member.date_of_birth,
        age: ageFrom(member.date_of_birth),
      },
      financial: { earner, policies, education_funds, insights },
      has_live_data: Boolean(profile),
    }
  })
}
