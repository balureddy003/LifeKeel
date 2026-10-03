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
 *
 * GET /family/members/:id/agent — the member agent persona (PRD-126/127).
 * The micro-agent's *voice*: it reads the same twin read model and
 * synthesizes the prioritized nudges it would surface — readiness
 * components that need attention, the member's open insights, and
 * progress worth acknowledging. PRD-127 persists those nudges in
 * `member_nudges` (see member-nudges.ts): dismissed stays dismissed,
 * resolved gaps stop announcing themselves, and a daily cron loop
 * reconciles even when nobody opens the page. Still strictly
 * informational (Tier 0): nudges never recommend products or take
 * action — anything actionable lives behind the Act layer's explicit
 * approval gates.
 */

import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@agentoak/platform'
import type { FamilyGroupDoc, FamilyMemberDoc } from './family-group.js'
import type { FinancialProfile } from './family-financial-profile.js'
import { isFamilyAdult, ageFromDob } from '../lib/family-permissions.js'
import { ESTATE_VAULT_CATEGORY } from './documents.js'
import { computeMemberReadiness } from '../readiness/score.js'
import { reconcileMemberNudges, dismissMemberNudge } from '../member-nudges.js'
import { youthLessonsFor, type YouthLesson } from '../youth-curriculum.js'

// Insight states that still represent an open concern for the member —
// same set /family/readiness uses. Keep in sync.
const OPEN_INSIGHT_STATES = ['identified', 'sent', 'execution_failed', 'snoozed'] as const

const FAMILY_DETECTOR_IDS = [
  'family_protection_gap',
  'family_emergency_fund_adequacy',
  'family_retirement_gap',
  'family_education_shortfall',
]

const ageFrom = ageFromDob

// Funds recorded before PRD-104's member_id may only name the child —
// match on the member's first name as the documented fallback.
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

export interface MemberTwinResult {
  member: {
    id: string
    name: string
    role: FamilyMemberDoc['role']
    status?: FamilyMemberDoc['status']
    date_of_birth?: string
    age: number | null
  }
  financial: {
    earner: {
      employment_status?: string
      monthly_salary_minor?: number
      income_protection_monthly_minor?: number
      pension_balance_minor?: number
      monthly_pension_contribution_minor?: number
    } | null
    policies: Array<{
      type?: string
      provider?: string
      coverage_amount_minor?: number
      monthly_premium_minor?: number
      renewal_date?: string
    }>
    education_funds: Array<{
      child_name?: string
      current_savings_minor: number
      target_savings_minor: number
      years_remaining: number
      months_remaining: number
      needed_monthly_minor: number
    }>
    insights: Record<string, unknown>[]
  }
  readiness: ReturnType<typeof computeMemberReadiness> | null
  // PRD-124 youth view: present only for ?mode=youth. Money is redacted at
  // the API boundary — a child's payload never carries minor amounts, so a
  // kid looking at the screen (or devtools) can't see household figures.
  youth?: {
    age_band: 'younger' | 'teen'
    headline: string
    savings_goals: Array<{
      name: string
      /** 0–100, rounded — a share of the goal, never an amount. */
      progress_pct: number
      years_until_goal: number
    }>
    /** PRD-129: age-banded literacy cards — concepts + a "try it"
     *  activity, no amounts, no products. */
    lessons: YouthLesson[]
  }
  has_live_data: boolean
}

// The twin assembled as a value — PRD-122 reuses it to ground member-
// scoped Ask Oak answers on the same read model the member page renders.
// mode 'youth' (PRD-124) is a redacted projection for minors: savings
// progress as percentages with no minor-unit amounts anywhere in the
// payload, no earner/policies/insights/readiness, and age-banded copy —
// so a phone handed to a child can't leak household figures.
export async function getMemberTwin(
  db: Db,
  tenantId: string,
  memberId: string,
  viewerUserId: string,
  mode?: 'youth',
): Promise<MemberTwinResult | null> {
  const group = await getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenantId).findOne({})
  const member: FamilyMemberDoc | undefined = group?.members.find((m) => m.id === memberId)
  if (!member) return null

  const profile = await getTenantCollection<FinancialProfile>(db, 'family_financial_profile', tenantId).findOne({})

    // Earner slice: an explicit per-member earner wins; absent that, the
    // household-level earner fields belong to the organizer (they're the
    // "primary earner" the wizard has always collected).
    const memberEarner = (profile?.household.members ?? []).find((e) => e.member_id === memberId)
    const earner = memberEarner
      ? {
          employment_status: memberEarner.employment_status,
          monthly_salary_minor: memberEarner.monthly_salary_minor,
          income_protection_monthly_minor: memberEarner.income_protection_monthly_minor,
          pension_balance_minor: memberEarner.pension_balance_minor,
          monthly_pension_contribution_minor: memberEarner.monthly_pension_contribution_minor,
        }
      : member.role === 'organizer' && profile?.household
        ? {
            employment_status: profile.household.employment_status,
            monthly_salary_minor: profile.household.monthly_salary_minor,
            income_protection_monthly_minor: profile.household.income_protection_monthly_minor,
            // The organizer's pension is the household retirement block —
            // surfaced through the retirement component, not these fields.
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
        tenant_id: tenantId,
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

  // Estate component visibility follows the *viewer*, like
  // /family/readiness: non-adult viewers get a gated component.
  const viewerIsAdult = await isFamilyAdult(db, tenantId, viewerUserId)
  const estateDocTypes = viewerIsAdult
    ? (
        (await db
          .collection('documents')
          .find({ tenant_id: tenantId, category: ESTATE_VAULT_CATEGORY }, { projection: { _id: 0, doc_type: 1 } })
          .toArray()) as { doc_type?: string }[]
      )
        .map((d) => d.doc_type)
        .filter((t): t is string => typeof t === 'string')
    : null

  const age = ageFrom(member.date_of_birth)
  const isMinor = member.role === 'child' || (age !== null && age < 18)

  // PRD-124: the youth projection replaces the whole financial payload —
  // amounts are dropped server-side, not just hidden in the UI. Readiness
  // is omitted too: for a child it only ever scores education, which the
  // savings goals already express as kid-legible progress.
  if (mode === 'youth' && isMinor) {
    const band = age !== null && age >= 13 ? 'teen' : 'younger'
    const savings_goals = education_funds.map((f) => ({
      name: f.child_name?.trim() || `${member.name.split(' ')[0]}'s goal`,
      progress_pct: f.target_savings_minor > 0 ? Math.min(100, Math.round((f.current_savings_minor / f.target_savings_minor) * 100)) : 0,
      years_until_goal: Math.max(0, Math.ceil(f.years_remaining)),
    }))
    return {
      member: {
        id: member.id,
        name: member.name,
        role: member.role,
        status: member.status,
        date_of_birth: member.date_of_birth,
        age,
      },
      financial: { earner: null, policies: [], education_funds: [], insights: [] },
      readiness: null,
      youth: {
        age_band: band,
        headline:
          band === 'teen'
            ? 'See how your savings for the future are growing — and what they\'re aimed at.'
            : 'Your family is putting money aside for big things ahead — here\'s how it\'s growing.',
        savings_goals,
        lessons: youthLessonsFor(band),
      },
      has_live_data: Boolean(profile),
    }
  }

  const readiness = computeMemberReadiness(
    profile ?? null,
    { memberId, role: member.role, age, earner, policies, educationFunds: education_funds },
    estateDocTypes,
  )

  return {
    member: {
      id: member.id,
      name: member.name,
      role: member.role,
      status: member.status,
      date_of_birth: member.date_of_birth,
      age,
    },
    financial: { earner, policies, education_funds, insights },
    readiness,
    has_live_data: Boolean(profile),
  }
}

// ── Member agent persona (PRD-126) ───────────────────────────────────────

export interface MemberAgentNudge {
  /** 'attention' — a scored gap; 'insight' — a detector's open finding;
   *  'progress' — something going right worth acknowledging. */
  kind: 'attention' | 'insight' | 'progress'
  /** What the member's agent is leading with — plain language. */
  title: string
  detail: string
  /** Which readiness component produced an 'attention' nudge, or the
   *  insight id for 'insight' nudges — lets the UI link back to source. */
  source?: { component?: string; insight_id?: string }
}

export interface MemberAgentResult {
  member: MemberTwinResult['member']
  /** The persona this member's agent speaks with — a child's twin reports
   *  TO the parents ("for Maya"), never acts as an autonomous agent with
   *  the minor, matching the no-child-login posture of PRD-123/124. */
  persona: 'adult' | 'guardian'
  nudges: MemberAgentNudge[]
  /** True while the member is pending — their data was entered on their
   *  behalf, so every nudge is provisional. */
  provisional: boolean
}

/** Component scores at or below this read as "needs attention" — above it
 *  they're either fine (>80) or genuinely nothing to say (null). */
const ATTENTION_THRESHOLD = 80

// Time-based nudge thresholds — the proactive "always-on" half of the
// member agent. These fire based on time passing, not on what the data
// says right now: an approaching 18th birthday, a stale profile, a
// renewal coming due. Time nudges are only added when there isn't already
// an insight/attention nudge about the same subject (the detector system
// is still the primary source of truth; these are the "nothing changed
// but time passed" catch-all).
const AGE_MILESTONE_MONTHS_AHEAD = 6
const AGE_MILESTONES: Array<{ from: number; to: number; label: string; detail: string }> = [
  { from: 17, to: 18, label: 'Adulthood approaching', detail: 'Their education fund and any child-specific arrangements may transition. Worth reviewing what changes at 18.' },
  { from: 15, to: 16, label: 'Approaching working age', detail: 'In the UK, 16 is the minimum school-leaving age. Any apprenticeship or part-time earnings may affect household figures.' },
  { from: 12, to: 13, label: 'Entering teenage years', detail: 'Education fund targets and financial literacy lessons may need updating for secondary school.' },
  { from: 24, to: 25, label: 'Age band change', detail: 'Insurance premiums and financial products often reprice at 25.' },
  { from: 49, to: 50, label: 'Age band change', detail: 'Life insurance and income protection typically reprice at 50 — worth reviewing coverage before the birthday.' },
  { from: 59, to: 60, label: 'Approaching common retirement window', detail: 'Review pension drawdown timing, state pension forecast, and whether the retirement plan is on track.' },
]

// Pure — the agent's whole persona is a deterministic read of the twin.
// No LLM: proactive member guidance that's wrong is worse than none, and
// deterministic copy stays inside the informational-only boundary.
export function buildMemberAgent(twin: MemberTwinResult): MemberAgentResult {
  const first = twin.member.name.split(' ')[0] ?? twin.member.name
  const isMinor = twin.member.role === 'child' || (twin.member.age !== null && twin.member.age < 18)
  const nudges: MemberAgentNudge[] = []
  const now = new Date()

  // 1. Readiness components that need attention — scored by how far they
  //    fall short, which doubles as the sort priority.
  for (const c of twin.readiness?.components ?? []) {
    if (c.gated || c.score === null || c.score > ATTENTION_THRESHOLD) continue
    nudges.push({
      kind: 'attention',
      title: `${c.label} could use attention`,
      detail: c.detail,
      source: { component: c.key },
    })
  }

  // 2. The member's open detector insights — attention-shaping wording,
  //    never a product or provider recommendation.
  for (const i of twin.financial.insights) {
    nudges.push({
      kind: 'insight',
      title: typeof i.hypothesis === 'string' ? i.hypothesis.replace(/_/g, ' ') : 'An open finding',
      detail: typeof i.reasoning === 'string' ? i.reasoning : '',
      source: { insight_id: String(i.id ?? '') },
    })
  }

  // 3. Time-based nudges — fire when time itself changed something, even
  //    if the data hasn't. Only added when no insight/attention nudge
  //    already covers the same subject (avoid duplicates).
  if (twin.member.date_of_birth) {
    const dob = new Date(twin.member.date_of_birth)
    const ageMonths = Math.floor((now.getTime() - dob.getTime()) / (30.44 * 24 * 60 * 60 * 1000))
    const ageYears = Math.floor(ageMonths / 12)
    const nextBirthdayMonths = 12 - (ageMonths % 12)

    for (const milestone of AGE_MILESTONES) {
      // Fires when the member is within AGE_MILESTONE_MONTHS_AHEAD of the
      // milestone's `to` age — the "about to cross" window, not the
      // birthday itself (too late to plan by then).
      if (ageYears === milestone.from && nextBirthdayMonths <= AGE_MILESTONE_MONTHS_AHEAD) {
        const alreadyFlagged = nudges.some((n) => n.title.toLowerCase().includes(milestone.label.toLowerCase()))
        if (!alreadyFlagged) {
          nudges.push({
            kind: 'attention',
            title: `${first} is approaching ${milestone.to} — ${milestone.label.toLowerCase()}`,
            detail: milestone.detail,
            source: { component: 'time_milestone' },
          })
        }
      }
    }
  }

  // Approaching renewal nudges — a policy renewing within the lead time
  // is a time-based fact the detector system may not have flagged yet
  // (the detector fires on renewal_date, but the agent should also surface
  // it proactively even if the insight was resolved or dismissed).
  const RENEWAL_LEAD_DAYS = 45
  for (const p of twin.financial.policies) {
    if (!p.renewal_date) continue
    const renewalDate = new Date(p.renewal_date)
    const daysUntil = Math.ceil((renewalDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    if (daysUntil > 0 && daysUntil <= RENEWAL_LEAD_DAYS) {
      nudges.push({
        kind: 'attention',
        title: `${p.provider ?? 'A policy'} ${p.type ?? 'policy'} renews in ${daysUntil} days`,
        detail: `${p.provider ?? 'A policy'} (${p.type ?? 'insurance'}) renews on ${renewalDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}. Worth reviewing the cover and comparing before it auto-renews.`,
        source: { component: 'policy_renewal' },
      })
    }
  }

  // 4. Progress — a member agent that only reports gaps reads as an alarm
  //    bell, so genuinely-on-track components get one quiet positive.
  for (const c of twin.readiness?.components ?? []) {
    if (c.gated || c.score === null || c.score <= ATTENTION_THRESHOLD) continue
    nudges.push({ kind: 'progress', title: `${c.label} is on track`, detail: c.detail, source: { component: c.key } })
  }

  // Ordering: open findings first (they're the most concrete), then scored
  // gaps by ascending score (worst first), progress last.
  const order = { insight: 0, attention: 1, progress: 2 } as const
  nudges.sort((a, b) => order[a.kind] - order[b.kind])

  return {
    member: twin.member,
    persona: isMinor ? 'guardian' : 'adult',
    nudges: nudges.map((n) => ({
      ...n,
      // Guardian persona rephrases attention nudges to speak about the
      // child, not to them — the family reads these, the child doesn't.
      title: isMinor && n.kind === 'attention' ? `${first}'s ${n.title.charAt(0).toLowerCase()}${n.title.slice(1)}` : n.title,
    })),
    provisional: twin.member.status === 'pending',
  }
}

export function registerMemberTwinRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { id: string }; Querystring: { mode?: string } }>('/family/members/:id/twin', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const mode = req.query.mode === 'youth' ? 'youth' : undefined
    const twin = await getMemberTwin(db, tenant_id, req.params.id, user_id, mode)
    if (!twin) return reply.status(404).send({ error: 'Family member not found' })
    // Youth mode on an adult silently falling back to the full payload
    // would be a redaction hole pretending to work — refuse instead.
    if (mode === 'youth' && !twin.youth) {
      return reply.status(400).send({ error: 'Youth view only applies to members under 18' })
    }
    return twin
  })

  // PRD-126/127: the member's agent persona — proactive, member-scoped
  // nudges read off the twin, reconciled against the persisted nudge
  // store so dismissed nudges stay dismissed and resolved gaps stop
  // announcing. Never available in youth mode (a child's agent speaks to
  // the adults; PRD-124's redacted payload is for the child).
  app.get<{ Params: { id: string } }>('/family/members/:id/agent', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const twin = await getMemberTwin(db, tenant_id, req.params.id, user_id)
    if (!twin) return reply.status(404).send({ error: 'Family member not found' })
    const agent = buildMemberAgent(twin)
    const nudges = await reconcileMemberNudges(db, tenant_id, agent)
    return { ...agent, nudges }
  })

  // Dismiss a nudge — the gap may still exist, but the family has seen it
  // and chosen not to hear about it again while the evidence stands.
  app.post<{ Params: { id: string; nudgeId: string } }>(
    '/family/members/:id/agent/nudges/:nudgeId/dismiss',
    async (req, reply) => {
      const { tenant_id } = req.authContext
      const dismissed = await dismissMemberNudge(db, tenant_id, req.params.id, req.params.nudgeId)
      if (!dismissed) return reply.status(404).send({ error: 'Nudge not found' })
      return { ok: true }
    },
  )
}
