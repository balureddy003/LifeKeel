/**
 * Assistant Routes — grounds the in-app assistant in the tenant's real
 * financial profile and open insights via an LLM, replacing the
 * client-side hardcoded response map previously used by
 * apps/web/src/lib/api.ts's fetchAIResponse. See docs/prd/101-live-ai-assistant.md.
 *
 * POST /assistant/ask — ask a question, get a grounded, informational-only
 * answer. Never throws to the client: any LLM failure (no provider
 * configured, bad key, rate limit, network) degrades to a graceful,
 * honest fallback with isLive: false rather than a 500.
 *
 * POST /assistant/simulate — a "what if" scenario (income change, new
 * savings rate, directed at a child's education fund) computed by plain
 * arithmetic in ../scenarios/calculate.ts, never by the LLM. The model
 * only narrates the numbers this route hands it.
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { taskLlm } from '../ai/task-gateway.js'
import { getInsightsCollection, getSignalsCollection } from '../db.js'
import { getAuditLogger } from '../audit/audit-log.js'
import { type ScenarioResult, type ScenarioTimelinePoint } from '../scenarios/calculate.js'
import { projectScenario } from '../scenarios/project.js'
import { ScenarioStepSchema } from './family-scenarios.js'
import { isUnsetTarget } from './family-financial-profile.js'
import { getMemberTwin, type MemberTwinResult } from './member-twin.js'
import {
  isFamilyAdult,
  isFamilyOrganizer,
  memberMatchesUser,
} from '../family/family-permissions.js'
import { buildLegacyGraph, renderLegacyGraphForAssistant } from '../legacy/graph.js'

const AskSchema = z.object({
  query: z.string().min(1).max(2000),
  // PRD-122: scope the answer to one roster member — the assistant grounds
  // on that member's twin (their earner slice, attributed policies/funds/
  // insights, member readiness) instead of the whole household.
  member_id: z.string().max(100).optional(),
})

const SimulateSchema = z.object({
  monthlyIncomeDeltaMinor: z.number().int().optional(),
  monthlyExtraSavingsMinor: z.number().int().min(0).optional(),
  targetChildName: z.string().max(100).optional(),
  // PRD-115: months until the income change takes effect — "a job
  // transition in 6 months" — so the runway projection starts from the
  // balance the household will actually have then, not today's.
  monthsUntilChange: z.number().int().min(0).max(360).optional(),
  // G14 flywheel / PRD-132: multi-step timelines ("income stops now,
  // returns in 12 months") reach the assistant the same way they reach
  // saved scenarios — the calculator walks each regime boundary.
  steps: z.array(ScenarioStepSchema).max(12).optional(),
  // G7: scope the projection to one roster member's earner slice.
  member_id: z.string().min(1).optional(),
  // Optional — what the family actually typed/asked about this scenario.
  // Falls back to a generic prompt so the endpoint works from a plain
  // structured UI control (sliders/inputs) with no free text at all.
  question: z.string().max(2000).optional(),
})

export const SYSTEM_PROMPT = `You are Keel, the assistant inside LifeKeel — a family's financial digital twin. Answer the family's question using ONLY the data provided below.

Rules:
- Never give definitive financial, investment, insurance, tax, or legal advice, and never recommend, compare, or steer toward a specific product or provider. Always frame guidance as informational — describe what's on file and possible gaps — and recommend consulting a licensed professional for decisions.
- If the provided data doesn't answer the question, say so honestly rather than guessing or inventing numbers.
- Be concise and specific — reference the family's actual figures where relevant instead of generic advice.
- Do not suggest Keel can take any action on the family's behalf (send money, contact anyone, file anything) — Keel only explains and summarizes.
- Some figures below are marked "profile pending" — that household member hasn't joined and confirmed their own details yet. If your answer relies on one of those figures, say plainly that it's provisional and based on data entered by someone else on their behalf, rather than presenting it as confirmed.
- Some figures below come from an unreviewed uploaded document — the family hasn't confirmed those numbers are correct or added them to the profile yet. If your answer relies on one of those, say so and suggest they review it, rather than treating it as an established fact.
- Never invent a hypothetical projection (e.g. "if income changed by X"). If asked one and no computed scenario result is provided below, say you can't calculate that yet and point to what's currently on file instead.
- The "Open insights" list below is the only set of gaps Keel has formally flagged — each one already passed a specific threshold (e.g. an education fund is only flagged once it's within 5 years of its target date). When a question leads you to describe a gap that ISN'T in that list — a figure that's merely below target but not close enough to be flagged yet — say so plainly (e.g. "on track for now, but worth revisiting closer to the date") rather than using the same urgent language ("shortfall", "not fully funded", "gap") you'd use for a flagged insight. Matching tone to formal flags keeps a distant, low-priority observation from reading as equally urgent to a real one.
- The family legacy map below lists estate and inheritance records the family declared — you may describe what records exist and who they name, label unverified claims as such, but you must never state that a document is legally valid, who legally owns a property, or what anyone will inherit.`

const FALLBACK_CONTENT =
  "Based on the information you've entered, here is a summary from your family's data. This is for informational purposes only — please consult a qualified professional before making financial decisions. Would you like to see the specific numbers from your family's profile?"

interface FinancialProfileDoc extends Record<string, unknown> {
  household?: {
    employment_status?: string
    monthly_salary_minor?: number
    annual_living_expenses_minor?: number
    mortgage_outstanding_minor?: number
    life_cover_minor?: number
    income_protection_monthly_minor?: number
    // PRD-104: per-member earners, linked to the family roster — see
    // FamilyGroupDoc below and its use in buildContext().
    members?: Array<{
      member_id?: string
      employment_status?: string
      monthly_salary_minor?: number
      income_protection_monthly_minor?: number
    }>
  }
  emergency_fund?: {
    emergency_savings_minor?: number
    monthly_expenses_minor?: number
    has_high_interest_debt?: boolean
  }
  retirement?: {
    current_age?: number
    target_retirement_age?: number
    pension_balance_minor?: number
    monthly_contribution_minor?: number
    target_retirement_income_minor?: number
  }
  education_funds?: Array<{
    child_name?: string
    child_age?: number
    current_savings_minor?: number
    target_savings_minor?: number
    years_remaining?: number
  }>
  // PRD-110: individual policies were invisible to the assistant entirely —
  // "does my husband's car insurance renew soon?" couldn't be answered even
  // after the policy was recorded. member_id resolves to a roster name the
  // same way household.members does below; car/home are household-wide and
  // carry no member_id.
  policies?: Array<{
    type?: string
    provider?: string
    coverage_amount_minor?: number
    monthly_premium_minor?: number
    renewal_date?: string
    member_id?: string
  }>
}

// PRD-104: minimal local mirror of the family roster (owned by
// family-group.ts) — same established pattern as FinancialProfileDoc
// above, a route reading another route's collection directly (see also
// documents.ts's direct family_financial_profile read) rather than a
// shared/exported accessor. Only what buildContext needs to resolve a
// member_id to a real name.
interface FamilyGroupDoc extends Record<string, unknown> {
  // `status` was never declared here before, even though family-group.ts's
  // own FamilyMemberDoc has had it from the start — a Pending member's name
  // and figures flowed into the prompt exactly like a confirmed member's,
  // with no signal to the model (or thus the family) that the data hadn't
  // been confirmed by that person yet.
  members: Array<{ id: string; name: string; role: string; status?: string }>
}

// A recently-extracted-but-unreviewed document (AI Memory) — surfaced so
// Keel can mention it rather than stay silent about data sitting right
// there unconfirmed. Mirrors the same `status === 'extracted'` convention
// apps/web/src/components/Intelligence.tsx's MemoryPrompts already uses;
// applying a suggestion never flips this status (a pre-existing gap, not
// something this change fixes), so this can resurface an already-applied
// document — same known limitation as the Home screen's own AI Memory card.
interface UnreviewedDocumentDoc extends Record<string, unknown> {
  filename?: string
  category?: string
  uploaded_at?: Date
}

// G6: a life event with the reporter's free-text account attached — the
// only channel through which "Mum's at County Hospital, kids need pickup"
// reaches Ask Keel's grounding. Bounded to recent events (90 days): a
// bereavement from last year is context for readiness, not for today's
// crisis question.
interface LifeEventContextDoc extends Record<string, unknown> {
  data?: {
    event_type?: string
    context?: string
    reported_at?: string
    affected_member_id?: string
  }
}

function toMajor(minor: number | undefined): string {
  return typeof minor === 'number' ? (minor / 100).toFixed(2) : 'not provided'
}

function memberLabel(
  family: FamilyGroupDoc | null,
  memberId: string | undefined,
  fallback: string,
): string {
  const member = family?.members.find((m) => m.id === memberId)
  if (!member) return fallback
  return member.status === 'pending' ? `${member.name} (profile pending)` : member.name
}

function buildContext(
  profile: FinancialProfileDoc | null,
  family: FamilyGroupDoc | null,
  insights: Array<{ reasoning: string; category: string; detector_id: string }>,
  unreviewedDocs: UnreviewedDocumentDoc[],
  lifeEventContexts: LifeEventContextDoc[] = [],
  // PRD-137 §5: rendered legacy-graph lines, or null when the register is
  // empty / the caller isn't an adult. Family declarations, never legal
  // facts — the header line says so and every claim carries its label.
  legacyText: string | null = null,
): string {
  const parts: string[] = []

  if (!profile) {
    parts.push('No financial profile has been submitted yet.')
  } else {
    const h = profile.household
    const ef = profile.emergency_fund
    const r = profile.retirement
    if (h) {
      parts.push(
        `Household: employment status ${h.employment_status ?? 'unknown'}, monthly salary £${toMajor(h.monthly_salary_minor)}, ` +
          `annual living expenses £${toMajor(h.annual_living_expenses_minor)}, mortgage outstanding £${toMajor(h.mortgage_outstanding_minor)}, ` +
          `life insurance cover £${toMajor(h.life_cover_minor)}, income protection £${toMajor(h.income_protection_monthly_minor)}/month.`,
      )
      // PRD-104: resolve each member_id to their real roster name so the
      // assistant can answer "does my husband have income protection?"
      // about a specific person, not just the household total.
      for (const member of h.members ?? []) {
        const name = memberLabel(family, member.member_id, 'another household member')
        parts.push(
          `Household member ${name}: employment status ${member.employment_status ?? 'unknown'}, ` +
            `monthly salary £${toMajor(member.monthly_salary_minor)}, income protection £${toMajor(member.income_protection_monthly_minor)}/month.`,
        )
      }
    }
    if (ef) {
      parts.push(
        `Emergency fund: £${toMajor(ef.emergency_savings_minor)} saved against £${toMajor(ef.monthly_expenses_minor)}/month expenses. ` +
          `High-interest debt: ${ef.has_high_interest_debt ? 'yes' : 'no'}.`,
      )
    }
    // The retirement wizard step pre-fills current_age/target_retirement_age
    // with plausible-looking placeholders (30/65) so autosave can satisfy
    // the schema before the user has ever reached that step — unlike every
    // other blank-defaulted field here, an unedited placeholder age reads
    // exactly like a real answer, so Keel must not repeat it as fact. Gate
    // on the same isUnsetTarget threshold the retirement detector itself
    // already uses (family-financial-profile.ts) to decide the section was
    // never really engaged with — confirmed live: without this gate Keel
    // told a user with no date of birth on file "Current age: 30" as data.
    if (r) {
      if (isUnsetTarget(r.target_retirement_income_minor ?? 0)) {
        parts.push(
          'Retirement: no target retirement income has been set yet. Any age or contribution figures on file may just be ' +
            'unconfirmed wizard defaults, not real answers — do not state them as facts; ask the user to complete the ' +
            'retirement section of their Financial Profile before estimating retirement income or age.',
        )
      } else {
        parts.push(
          `Retirement: currently age ${r.current_age ?? 'unknown'}, targeting retirement at ${r.target_retirement_age ?? 'unknown'}, ` +
            `pension balance £${toMajor(r.pension_balance_minor)}, contributing £${toMajor(r.monthly_contribution_minor)}/month, ` +
            `target retirement income £${toMajor(r.target_retirement_income_minor)}/year.`,
        )
      }
    }
    for (const fund of profile.education_funds ?? []) {
      parts.push(
        `Education fund for ${fund.child_name ?? 'a child'} (age ${fund.child_age ?? 'unknown'}): ` +
          `£${toMajor(fund.current_savings_minor)} saved against a £${toMajor(fund.target_savings_minor)} target, ` +
          `${fund.years_remaining ?? 'unknown'} years remaining.`,
      )
    }
    for (const policy of profile.policies ?? []) {
      const holder = policy.member_id
        ? memberLabel(family, policy.member_id, 'a household member')
        : 'the household'
      parts.push(
        `${policy.type ?? 'Insurance'} policy with ${policy.provider ?? 'unknown provider'} held by ${holder}: ` +
          `cover £${toMajor(policy.coverage_amount_minor)}, premium £${toMajor(policy.monthly_premium_minor)}/month` +
          `${policy.renewal_date ? `, renews ${policy.renewal_date}` : ''}.`,
      )
    }
  }

  // Gap-8: the organizer's own free-text context note — background color
  // for questions the structured profile can't express ("Mum lives alone
  // in Leeds"). User-authored, not a verified fact.
  if (family?.context_note) {
    parts.push(`Household context, in the organizer's own words: "${family.context_note}"`)
  }

  // G6: recent life events the family reported, in the reporter's own
  // words — what Ask Keel needs to answer "who's picking up the kids" or
  // "what did we say about the hospital" during a crisis. Reported facts,
  // not verified ones — labeled as such.
  for (const ev of lifeEventContexts) {
    if (!ev.data?.context) continue
    const when = ev.data.reported_at?.slice(0, 10) ?? 'recently'
    const who = ev.data.affected_member_id
      ? memberLabel(family, ev.data.affected_member_id, 'a family member')
      : 'the family'
    parts.push(
      `Life event reported ${when} (${ev.data.event_type?.replace(/_/g, ' ') ?? 'event'}, affecting ${who}), ` +
        `in the reporter's own words: "${ev.data.context}"`,
    )
  }

  if (legacyText) {
    parts.push(
      'Family legacy map (what the family has recorded — completeness, not legal validity):\n' +
        legacyText,
    )
  }

  if (insights.length === 0) {
    parts.push('No open insights currently identified.')
  } else {
    parts.push('Open insights Keel has already identified for this family:')
    for (const insight of insights) {
      parts.push(`- [${insight.category}/${insight.detector_id}] ${insight.reasoning}`)
    }
  }

  if (unreviewedDocs.length > 0) {
    parts.push(
      'Documents uploaded but not yet reviewed or added to the profile (mention if relevant, but note they are unconfirmed):',
    )
    for (const doc of unreviewedDocs) {
      parts.push(
        `- "${doc.filename ?? 'a document'}" (${doc.category ?? 'uncategorized'}), uploaded ${doc.uploaded_at?.toISOString().slice(0, 10) ?? 'recently'}.`,
      )
    }
  }

  return parts.join('\n')
}

// PRD-122: the member-scoped counterpart to buildContext — grounds the
// answer on a single member's twin read model (same assembly the member
// page renders) plus a shared-household background line, since questions
// like "can Sam afford uni" implicate family-level figures too.
function buildMemberContext(twin: MemberTwinResult, profile: FinancialProfileDoc | null): string {
  const m = twin.member
  const parts: string[] = []

  parts.push(
    `This question is specifically about ${m.name} ` +
      `(role ${m.role}${m.age !== null ? `, age ${m.age}` : ''}` +
      `${m.status === 'pending' ? ', profile pending — their figures were entered by someone else and are unconfirmed' : ''}). ` +
      `Answer about them specifically; household-level figures are background only.`,
  )

  if (twin.readiness) {
    parts.push(
      `${m.name}'s member readiness: ${twin.readiness.score !== null ? `${twin.readiness.score}/100` : 'not enough data to score'}.`,
    )
    for (const c of twin.readiness.components) {
      parts.push(
        `- ${c.label}: ${c.gated ? 'restricted' : c.score !== null ? `${c.score}/100` : 'unscored'} — ${c.detail}`,
      )
    }
  }

  const e = twin.financial.earner
  parts.push(
    e
      ? `${m.name}'s income: employment status ${e.employment_status ?? 'unknown'}, salary £${toMajor(e.monthly_salary_minor)}/month, ` +
          `income protection £${toMajor(e.income_protection_monthly_minor)}/month, ` +
          `pension balance £${toMajor(e.pension_balance_minor)}, pension contribution £${toMajor(e.monthly_pension_contribution_minor)}/month.`
      : `${m.name} has no income or employment figures on file (not a household earner, or details not entered yet).`,
  )

  for (const p of twin.financial.policies) {
    parts.push(
      `${p.type ?? 'Insurance'} policy with ${p.provider ?? 'unknown provider'} held by ${m.name}: ` +
        `cover £${toMajor(p.coverage_amount_minor)}, premium £${toMajor(p.monthly_premium_minor)}/month` +
        `${p.renewal_date ? `, renews ${p.renewal_date}` : ''}.`,
    )
  }
  for (const f of twin.financial.education_funds) {
    parts.push(
      `Education fund for ${f.child_name ?? m.name}: £${toMajor(f.current_savings_minor)} saved against a ` +
        `£${toMajor(f.target_savings_minor)} target, ${f.years_remaining} years remaining ` +
        `(needs £${toMajor(f.needed_monthly_minor)}/month to stay on pace).`,
    )
  }

  const memberInsights = twin.financial.insights
  if (memberInsights.length === 0) {
    parts.push(`No open insights currently flagged for ${m.name}.`)
  } else {
    parts.push(`Open insights about ${m.name}:`)
    for (const i of memberInsights) {
      parts.push(
        `- ${typeof i['reasoning'] === 'string' ? i['reasoning'] : (i['hypothesis'] ?? '')}`,
      )
    }
  }

  if (profile?.emergency_fund || profile?.household) {
    parts.push(
      `Shared household background: annual living expenses £${toMajor(profile?.household?.annual_living_expenses_minor)}, ` +
        `emergency fund £${toMajor(profile?.emergency_fund?.emergency_savings_minor)} against ` +
        `£${toMajor(profile?.emergency_fund?.monthly_expenses_minor)}/month expenses.`,
    )
  }

  return parts.join('\n')
}

// Shared by /ask and /simulate — both ground the LLM in the same tenant
// data (profile, roster, open insights, unreviewed documents, and recent
// life events the family described in their own words).
async function loadAssistantData(db: Db, tenant_id: string, user_id: string) {
  const lifeEventCutoff = new Date(Date.now() - 90 * 86_400_000)
  const [profileDoc, familyDoc, insightDocs, unreviewedDocs, lifeEventContexts] = await Promise.all(
    [
      getTenantCollection<FinancialProfileDoc>(db, 'family_financial_profile', tenant_id).findOne(
        {},
      ),
      getTenantCollection<FamilyGroupDoc>(db, 'family_groups', tenant_id).findOne({}),
      getInsightsCollection().then((col) =>
        col
          .find({ tenant_id, state: { $in: ['identified', 'sent'] } })
          .sort({ created_at: -1 })
          .limit(10)
          .toArray(),
      ),
      getTenantCollection<UnreviewedDocumentDoc>(db, 'documents', tenant_id)
        .find({ status: 'extracted' })
        .sort({ uploaded_at: -1 })
        .limit(5)
        .toArray(),
      getSignalsCollection().then((col) =>
        col
          .find({
            tenant_id,
            signal_type: 'family.life_event',
            'data.context': { $exists: true },
            created_at: { $gte: lifeEventCutoff },
          })
          .sort({ created_at: -1 })
          .limit(5)
          .toArray(),
      ),
    ],
  )

  // PRD-137 §5: the legacy register joins the context only for adults —
  // the same gate estate data already has (member-scoped asks never reach
  // it at all; buildMemberContext doesn't take it). Best-effort: a broken
  // or partial legacy collection means no block, never a failed answer.
  let legacyText: string | null = null
  try {
    if (await isFamilyAdult(db, tenant_id, user_id)) {
      const member = familyDoc?.members.find((m) => memberMatchesUser(m, user_id)) ?? null
      const isOrganizer =
        member?.role === 'organizer' ||
        (await isFamilyOrganizer(db, tenant_id, user_id).catch(() => false))
      const graph = await buildLegacyGraph(db, tenant_id, {
        user_id,
        is_organizer: isOrganizer,
        member_id: member?.id ?? null,
        youth: false,
      })
      if (graph.nodes.some((n) => n.kind === 'document' || n.kind === 'asset')) {
        legacyText = renderLegacyGraphForAssistant(graph)
      }
    }
  } catch {
    // legacy grounding is background color — never blocks an answer
  }

  return {
    profileDoc,
    familyDoc,
    insightDocs,
    unreviewedDocs,
    lifeEventContexts: lifeEventContexts as LifeEventContextDoc[],
    legacyText,
  }
}

// toScenarioProfileInput moved to ../scenarios/profile-input.ts for
// PRD-115 — the saved-scenario routes reuse the same mapping.

function formatScenarioResult(result: ScenarioResult): string {
  const lines = [
    `Current total household monthly income: £${toMajor(result.currentMonthlyIncomeMinor)}.`,
    `Projected monthly income under this scenario: £${toMajor(result.projectedMonthlyIncomeMinor)}.`,
    `Current monthly surplus (income minus expenses): £${toMajor(result.currentMonthlySurplusMinor)}.`,
    `Projected monthly surplus under this scenario: £${toMajor(result.projectedMonthlySurplusMinor)}.`,
    result.currentRunwayMonths === null
      ? 'Current emergency-fund runway: not applicable — income currently covers expenses.'
      : `Current emergency-fund runway: ${result.currentRunwayMonths} months.`,
    result.projectedRunwayMonths === null
      ? 'Projected emergency-fund runway under this scenario: not applicable — income would cover expenses.'
      : `Projected emergency-fund runway under this scenario: ${result.projectedRunwayMonths} months.`,
    // PRD-115: say when the change lands so the LLM narrates "in 6 months
    // you'd have X" instead of implying today's balance carries it.
    result.monthsUntilChange > 0
      ? `Timing: this change takes effect in ${result.monthsUntilChange} months — by then the emergency fund would have reached £${toMajor(result.savingsAtChangeMinor)}, and the projected runway above is measured from that balance.`
      : 'Timing: this change takes effect immediately.',
  ]
  if (result.educationFundProjection) {
    const p = result.educationFundProjection
    lines.push(
      p.projectedMonthsToTarget === null
        ? `${p.childName}'s education fund: no new monthly saving directed at it in this scenario, so no projection.`
        : `${p.childName}'s education fund at this new saving rate: reaches its target in ${p.projectedMonthsToTarget} months, ` +
            `versus ${p.yearsRemaining * 12} months remaining — ${p.onTrack ? 'on track' : 'not on track'} at this pace.`,
    )
  }
  if (result.timeline && result.timeline.length > 0) {
    lines.push('This is a multi-step scenario — the regime changes over time:')
    lines.push(formatTimeline(result))
  }
  return lines.join('\n')
}

/**
 * PRD-132/G14: describe each regime boundary in the raw-numbers fallback
 * ("months 1–3: income −£2,400/mo, runway 4.1 mo; from month 4: …") — the
 * same narration the LLM prompt hands it, since the fallback IS this text.
 */
function formatTimeline(result: ScenarioResult): string {
  const timeline = result.timeline!
  const segments: string[] = []
  let prevIncome = result.currentMonthlyIncomeMinor
  let prevExpenses =
    result.currentMonthlySurplusMinor !== undefined
      ? result.currentMonthlyIncomeMinor - result.currentMonthlySurplusMinor
      : 0
  timeline.forEach((t: ScenarioTimelinePoint, i: number) => {
    const next = timeline[i + 1]
    const start = t.atMonth === 0 ? 1 : t.atMonth
    const range =
      next && next.atMonth - 1 >= start
        ? `months ${start}–${next.atMonth - 1}`
        : t.atMonth === 0
          ? 'from now'
          : `from month ${t.atMonth}`
    const dIncome = t.monthlyIncomeMinor - prevIncome
    const dExpenses = t.monthlyExpensesMinor - prevExpenses
    const changes: string[] = []
    if (dIncome !== 0)
      changes.push(`income ${dIncome < 0 ? '−' : '+'}£${toMajor(Math.abs(dIncome))}/mo`)
    if (dExpenses !== 0)
      changes.push(`expenses ${dExpenses < 0 ? '−' : '+'}£${toMajor(Math.abs(dExpenses))}/mo`)
    const runway = t.runwayMonths === null ? 'self-funding' : `runway ${t.runwayMonths} mo`
    segments.push(`${range}: ${changes.length > 0 ? changes.join(', ') + ', ' : ''}${runway}`)
    prevIncome = t.monthlyIncomeMinor
    prevExpenses = t.monthlyExpensesMinor
  })
  if (result.fundDepletedAtMonth !== null) {
    segments.push(`the emergency fund runs out in month ${result.fundDepletedAtMonth}`)
  }
  return segments.join('; ')
}

export function registerAssistantRoutes(app: FastifyInstance, db: Db): void {
  // Governed per request: assistant.answer.v1 / assistant.scenario_narration.v1
  // (intent 01) — model allowlist, input ceiling, deadline, breaker, guards.

  app.post<{ Body: { query?: string } }>(
    '/assistant/ask',
    // KEEL-015: this route calls an LLM on every request — the shared
    // global rate limit (100/min per tenant in cloud mode) was the only
    // ceiling on it, same as any plain CRUD route. A tighter, dedicated
    // limit bounds LLM spend/abuse specifically on the routes that
    // actually invoke one.
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = AskSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
      }
      const { tenant_id, user_id } = req.authContext
      const { query, member_id } = parsed.data

      const { profileDoc, familyDoc, insightDocs, unreviewedDocs, lifeEventContexts, legacyText } =
        await loadAssistantData(db, tenant_id, user_id)

      let context: string
      if (member_id) {
        const twin = await getMemberTwin(db, tenant_id, member_id, user_id)
        if (!twin) return reply.status(404).send({ error: 'Family member not found' })
        context = buildMemberContext(twin, profileDoc)
      } else {
        context = buildContext(
          profileDoc,
          familyDoc,
          insightDocs.map((i) => ({
            reasoning: i.reasoning,
            category: i.category,
            detector_id: i.detector_id,
          })),
          unreviewedDocs,
          lifeEventContexts,
          legacyText,
        )
      }
      const prompt = `Family data:\n${context}\n\nQuestion: ${query}`

      try {
        const content = await taskLlm('assistant.answer.v1', tenant_id)(SYSTEM_PROMPT, prompt)
        getAuditLogger()?.fromRequest(req, 'assistant.ask', 'assistant', 'ask', {
          is_live: true,
          ...(member_id ? { member_id } : {}),
        })
        return reply.send({ content, isLive: true })
      } catch (err) {
        req.log.warn({ err }, 'Assistant LLM call failed — falling back')
        getAuditLogger()?.fromRequest(req, 'assistant.ask', 'assistant', 'ask', {
          is_live: false,
          ...(member_id ? { member_id } : {}),
        })
        return reply.send({ content: FALLBACK_CONTENT, isLive: false })
      }
    },
  )

  app.post<{ Body: z.infer<typeof SimulateSchema> }>(
    '/assistant/simulate',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = SimulateSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request', issues: parsed.error.issues })
      }
      const { tenant_id, user_id } = req.authContext
      const {
        monthlyIncomeDeltaMinor,
        monthlyExtraSavingsMinor,
        targetChildName,
        monthsUntilChange,
        steps,
        member_id,
        question,
      } = parsed.data

      const { profileDoc, familyDoc, insightDocs, unreviewedDocs, lifeEventContexts, legacyText } =
        await loadAssistantData(db, tenant_id, user_id)
      // projectScenario is the same path /family/scenarios uses — member
      // scoping, "enough data to project" honesty, and multi-step timelines
      // all resolve there rather than being re-implemented here.
      const outcome = await projectScenario(db, tenant_id, {
        monthlyIncomeDeltaMinor,
        monthlyExtraSavingsMinor,
        targetChildName,
        monthsUntilChange,
        ...(steps !== undefined ? { steps } : {}),
        ...(member_id !== undefined ? { member_id } : {}),
      })
      if (outcome.status === 'bad_member') {
        return reply.status(400).send({ error: 'Family member not found for member_id' })
      }
      const scenario = outcome.result
      if (!scenario) {
        return reply.send({
          content:
            "There isn't enough on your Financial Profile yet (income or expenses) to project a scenario — fill that in first and this will work.",
          isLive: false,
          scenario: null,
        })
      }

      const context = buildContext(
        profileDoc,
        familyDoc,
        insightDocs.map((i) => ({
          reasoning: i.reasoning,
          category: i.category,
          detector_id: i.detector_id,
        })),
        unreviewedDocs,
        lifeEventContexts,
        legacyText,
      )
      const prompt =
        `Family data:\n${context}\n\n` +
        `Keel's calculator has already computed this scenario (these numbers are exact — narrate them, do not recompute or second-guess them):\n${formatScenarioResult(scenario)}\n\n` +
        `Question: ${question ?? 'What does this scenario mean for our finances?'}`

      try {
        const content = await taskLlm('assistant.scenario_narration.v1', tenant_id)(
          SYSTEM_PROMPT,
          prompt,
        )
        getAuditLogger()?.fromRequest(req, 'assistant.simulate', 'assistant', 'simulate', {
          is_live: true,
        })
        return reply.send({ content, isLive: true, scenario })
      } catch (err) {
        req.log.warn({ err }, 'Assistant simulate LLM call failed — falling back to raw numbers')
        getAuditLogger()?.fromRequest(req, 'assistant.simulate', 'assistant', 'simulate', {
          is_live: false,
        })
        return reply.send({ content: formatScenarioResult(scenario), isLive: false, scenario })
      }
    },
  )
}
