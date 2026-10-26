/**
 * Verified-answer resolver (PRD-212) — the deterministic tier of Ask Keel.
 *
 * A factual question ("how much emergency savings", "when does the car policy
 * renew") is resolved by pattern-matched intent → an approved read operation
 * over the tenant's profile → arithmetic in code → a reviewed template with
 * provenance. No model call: cheaper, faster, and every figure is auditable.
 *
 * Precision over recall by design: patterns match only unambiguous factual
 * asks. Anything that misses falls through to the generative path — a wrong
 * confident answer is far worse than an expensive one. Ambiguous matches
 * produce a clarification, never a guess.
 *
 * The output guard is inverted here: `ungroundedNumbers` normally *forbids*
 * figures not in the prompt; on this path every figure in the rendered answer
 * must be *present* in the grounding the renderer computed. A template bug
 * that lets a stray number through fails the check and the ask falls back to
 * generation instead of shipping it (ARCHITECTURE.md §8.4b).
 */

import { calculateScenario } from '../scenarios/calculate.js'
import { toScenarioProfileInput, type MemberScope } from '../scenarios/profile-input.js'
import { formatScenarioResult } from '../scenarios/format.js'
import { computeReadiness } from '../readiness/score.js'
import { ungroundedNumbers } from '../local-model.js'
import type { MemberTwinResult } from '../routes/member-twin.js'
import type { EstateSignalData } from '../legacy/estate-signal.js'

// ── Data shapes (structural mirrors of the route's profile/roster docs) ──

interface VerifiedProfile extends Record<string, unknown> {
  household?: {
    monthly_salary_minor?: number
    annual_living_expenses_minor?: number
    members?: Array<{ member_id?: string }>
  }
  emergency_fund?: {
    emergency_savings_minor?: number
    monthly_expenses_minor?: number
    has_high_interest_debt?: boolean
  }
  education_funds?: Array<{
    child_name?: string
    current_savings_minor?: number
    target_savings_minor?: number
    years_remaining?: number
  }>
  policies?: Array<{
    type?: string
    provider?: string
    coverage_amount_minor?: number
    monthly_premium_minor?: number
    renewal_date?: string
    member_id?: string
  }>
  updated_at?: Date | string
}

interface VerifiedFamily {
  members: Array<{ id: string; name: string; role: string; status?: string }>
}

export interface VerifiedAnswerData {
  profile: VerifiedProfile | null
  family: VerifiedFamily | null
  /** member_id from the ask, when the question is scoped to one roster member. */
  memberId?: string
  /** The member twin — loaded by the caller only for member-scoped asks. */
  twin?: MemberTwinResult | null
  /**
   * The same vault-side estate inputs /family/readiness computes with —
   * loaded by the caller via loadEstateReadinessInputs for readiness asks
   * (the vault is adult-gated, so the caller resolves gated-vs-scored).
   * Without them the composite silently re-weights the other four
   * components and the verified answer can disagree with the home score.
   */
  estateInputs?: {
    estateDocTypes: string[] | null
    estateSignal: EstateSignalData | null
  }
}

// ── Intent classification ────────────────────────────────────────────────

export type VerifiedOperationId =
  | 'emergency_fund'
  | 'policy_renewals'
  | 'policies'
  | 'readiness'
  | 'education_funds'
  | 'income_stops'

export const VERIFIED_OP_LABELS: Record<VerifiedOperationId, string> = {
  emergency_fund: 'Emergency fund',
  policy_renewals: 'Policy renewal dates',
  policies: 'Insurance policies on file',
  readiness: 'Family readiness score',
  education_funds: 'Education savings',
  income_stops: 'What happens if income stops',
}

const OP_PATTERNS: Array<{ op: VerifiedOperationId; patterns: RegExp[] }> = [
  {
    op: 'emergency_fund',
    patterns: [
      /emergency (fund|saving)/i,
      /how (many )?months.*(cover|expenses|last|survive)/i,
      /how long (would|could|will).*(saving|money|fund|cover)/i,
      /months? of (cover|expenses)/i,
      /rainy.?day/i,
    ],
  },
  {
    op: 'policy_renewals',
    patterns: [
      /when do(es)? .*(renew|expire|run out)/i,
      /renew(al|ing|s? soon)/i,
      /(polic(y|ies)|insurance|cover).*(due|renew|expir|lapse)/i,
    ],
  },
  {
    op: 'income_stops',
    patterns: [
      /(lose|lost|losing|without|stop|end)s?\b.*(job|income|salary|work|wage|earn)/i,
      /(job|income|salary)\b.*(lose|lost|stop|end|gone)/i,
      /job loss/i,
      /what if.*(can't|cannot|couldn't).*(work|earn)/i,
    ],
  },
  {
    op: 'education_funds',
    patterns: [
      /(education|college|university|uni) (fund|saving|cost|fee)/i,
      /saving.*(child|kid|son|daughter|education|school|uni)/i,
      /(school|uni|college) fees?/i,
    ],
  },
  {
    op: 'readiness',
    patterns: [
      /readiness/i,
      /(protection|preparedness|resilience) score/i,
      /how (protected|prepared|ready|resilient) (are we|am i|is (our|the|my) family)/i,
    ],
  },
  {
    op: 'policies',
    patterns: [
      /what (policies|insurance|cover|coverage)/i,
      /(list|show|tell me about) .*(polic|insur|cover)/i,
      /do (we|i) have.*(insurance|cover|policy)/i,
      /what('s| is) covered/i,
    ],
  },
]

export type VerifiedIntent =
  | { kind: 'operation'; operation: VerifiedOperationId }
  | { kind: 'clarify'; options: VerifiedOperationId[] }

/**
 * Pattern-match the query to an approved read operation. Returns null when
 * nothing matches — the caller falls through to generation. Multiple matched
 * operations produce a clarification, not a coin flip.
 */
export function classifyVerifiedIntent(query: string): VerifiedIntent | null {
  const matched = OP_PATTERNS.filter(({ patterns }) => patterns.some((p) => p.test(query))).map(
    ({ op }) => op,
  )
  // policies vs policy_renewals overlap: "what insurance do we have and when
  // does it renew" is a renewal question — keep renewals only.
  const ops =
    matched.includes('policy_renewals') && matched.includes('policies')
      ? matched.filter((op) => op !== 'policies')
      : matched
  if (ops.length === 0) return null
  if (ops.length > 1) return { kind: 'clarify', options: ops }
  return { kind: 'operation', operation: ops[0]! }
}

// ── Rendering ────────────────────────────────────────────────────────────

interface RenderedAnswer {
  content: string
  operation: VerifiedOperationId
  provenance: { source: string; updated_at: string | null }
  /** Display-unit figures the content is allowed to state — the require-side
   *  of the ungroundedNumbers check. Not sent to the client. */
  grounding: string
}

export type VerifiedAnswer = Omit<RenderedAnswer, 'grounding'>

function money(minor: number | undefined): string {
  return typeof minor === 'number' ? `£${(minor / 100).toFixed(2)}` : 'not provided'
}

function profileFreshness(profile: VerifiedProfile | null): string | null {
  const raw = profile?.updated_at
  if (!raw) return null
  const d = raw instanceof Date ? raw : new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function provenance(source: string, profile: VerifiedProfile | null) {
  return { source, updated_at: profileFreshness(profile) }
}

function freshnessLine(profile: VerifiedProfile | null): string {
  const updated = profileFreshness(profile)
  return updated
    ? `\n\n_From your financial profile, last updated ${updated}._`
    : '\n\n_From your financial profile._'
}

function memberName(data: VerifiedAnswerData, memberId: string | undefined): string {
  const member = data.family?.members.find((m) => m.id === memberId)
  if (!member) return 'a household member'
  return member.status === 'pending' ? `${member.name} (profile pending)` : member.name
}

function renderEmergencyFund(data: VerifiedAnswerData): RenderedAnswer {
  const ef = data.profile?.emergency_fund
  if (
    !ef ||
    (ef.emergency_savings_minor === undefined && ef.monthly_expenses_minor === undefined)
  ) {
    return {
      content:
        "There's no emergency fund filled in on your financial profile yet — once you add your savings and monthly expenses there, I can tell you exactly how many months of cover you have." +
        freshnessLine(data.profile),
      operation: 'emergency_fund',
      provenance: provenance('financial profile — emergency fund (not entered)', data.profile),
      grounding: '',
    }
  }
  const months =
    ef.emergency_savings_minor !== undefined &&
    ef.monthly_expenses_minor !== undefined &&
    ef.monthly_expenses_minor > 0
      ? Math.round((ef.emergency_savings_minor / ef.monthly_expenses_minor) * 10) / 10
      : null
  return {
    content:
      `Your emergency fund has ${money(ef.emergency_savings_minor)} saved against ` +
      `${money(ef.monthly_expenses_minor)}/month in expenses` +
      (months !== null ? ` — that's **${months} months of cover**.` : '.') +
      (ef.has_high_interest_debt
        ? ' Your profile also flags high-interest debt, which affects how far that cushion goes.'
        : '') +
      freshnessLine(data.profile),
    operation: 'emergency_fund',
    provenance: provenance('financial profile — emergency fund', data.profile),
    grounding: [money(ef.emergency_savings_minor), money(ef.monthly_expenses_minor)].join(' '),
  }
}

function policiesFor(data: VerifiedAnswerData) {
  const all = data.profile?.policies ?? []
  return data.memberId ? all.filter((p) => p.member_id === data.memberId) : all
}

function describePolicy(
  p: NonNullable<VerifiedProfile['policies']>[number],
  data: VerifiedAnswerData,
): string {
  const holder = p.member_id ? ` held by ${memberName(data, p.member_id)}` : ''
  return (
    `- **${p.type ?? 'Insurance'}**${p.provider ? ` with ${p.provider}` : ''}${holder}: ` +
    `cover ${money(p.coverage_amount_minor)}, premium ${money(p.monthly_premium_minor)}/month` +
    (p.renewal_date ? `, renews ${p.renewal_date}` : '')
  )
}

function renderPolicies(data: VerifiedAnswerData): RenderedAnswer {
  const scope = data.memberId ? ` for ${memberName(data, data.memberId)}` : ''
  const list = policiesFor(data)
  const items = list.map((p) => describePolicy(p, data))
  return {
    content:
      list.length === 0
        ? `There are no insurance policies recorded${scope} on your financial profile yet — add them there and I can list cover, premiums and renewal dates.` +
          freshnessLine(data.profile)
        : `You have ${list.length} ${list.length === 1 ? 'policy' : 'policies'} on file${scope}:\n` +
          items.join('\n') +
          freshnessLine(data.profile),
    operation: 'policies',
    provenance: provenance('financial profile — policies', data.profile),
    grounding: items.join(' '),
  }
}

function renderPolicyRenewals(data: VerifiedAnswerData): RenderedAnswer {
  const scope = data.memberId ? ` for ${memberName(data, data.memberId)}` : ''
  const dated = policiesFor(data)
    .filter((p) => p.renewal_date)
    .slice()
    .sort((a, b) => (a.renewal_date! < b.renewal_date! ? -1 : 1))
  const items = dated.map(
    (p) =>
      `- **${p.type ?? 'Insurance'}**${p.provider ? ` (${p.provider})` : ''}: renews ${p.renewal_date}`,
  )
  return {
    content:
      dated.length === 0
        ? `No renewal dates are recorded${scope} on your profile yet — when you add a policy's renewal date, I can tell you what's coming up.` +
          freshnessLine(data.profile)
        : `Renewal dates on file${scope}, soonest first:\n` +
          items.join('\n') +
          freshnessLine(data.profile),
    operation: 'policy_renewals',
    provenance: provenance('financial profile — policies', data.profile),
    grounding: items.join(' '),
  }
}

function renderReadiness(data: VerifiedAnswerData): RenderedAnswer | null {
  // Member-scoped asks read the twin's member readiness (same model the
  // member page renders); household asks compute the composite here. Estate
  // doc types aren't in scope for this resolver — that component is scored
  // gated rather than guessed.
  let readiness: MemberTwinResult['readiness'] | ReturnType<typeof computeReadiness> | null = null
  if (data.memberId && data.twin?.readiness) {
    readiness = data.twin.readiness
  } else if (data.profile) {
    try {
      readiness = computeReadiness(
        data.profile as never,
        data.estateInputs?.estateDocTypes ?? null,
        data.estateInputs?.estateSignal ?? null,
      )
    } catch {
      // A partial profile (e.g. no retirement section yet) can make a
      // component crash — decline to the generative path, never 500.
      return null
    }
  }
  if (!readiness) return null
  const who = data.memberId ? `${memberName(data, data.memberId)}'s` : "Your family's"
  // A partial profile can produce NaN component scores — never ship
  // "NaN/100" to a family; a non-finite score reads as unscored.
  const finite = (n: number | null | undefined): n is number =>
    typeof n === 'number' && Number.isFinite(n)
  const lines = readiness.components.map((c) => {
    if (c.gated) return `- ${c.label}: restricted — ${c.detail}`
    if (finite(c.score)) return `- ${c.label}: ${c.score}/100 — ${c.detail}`
    // The detail string can itself carry NaN-derived text for unscorable
    // sections — replace it rather than echo it.
    return `- ${c.label}: not scored yet — fill in this section of the profile`
  })
  const total = finite(readiness.score) ? readiness.score : null
  return {
    content:
      (total !== null
        ? `${who} readiness score is **${total}/100**, from ${lines.length} components:\n`
        : `${who} readiness can't be fully scored yet — some sections of the profile aren't filled in. Components:\n`) +
      lines.join('\n') +
      freshnessLine(data.profile),
    operation: 'readiness',
    provenance: provenance('readiness score — computed from financial profile', data.profile),
    grounding: `${readiness.score ?? ''} ${lines.join(' ')}`,
  }
}

function renderEducationFunds(data: VerifiedAnswerData): RenderedAnswer {
  const funds = data.memberId
    ? (data.twin?.financial.education_funds ?? [])
    : (data.profile?.education_funds ?? [])
  if (funds.length === 0) {
    return {
      content:
        "There are no education savings funds on your financial profile yet — add a child's fund there and I can show target, progress and pacing." +
        freshnessLine(data.profile),
      operation: 'education_funds',
      provenance: provenance('financial profile — education funds (none on file)', data.profile),
      grounding: '',
    }
  }
  const items = funds.map((f) => {
    const pacing =
      'needed_monthly_minor' in f && typeof f.needed_monthly_minor === 'number'
        ? ` — needs ${money(f.needed_monthly_minor)}/month to stay on pace`
        : ''
    return (
      `- **${f.child_name ?? 'a child'}**: ${money(f.current_savings_minor)} saved against a ` +
      `${money(f.target_savings_minor)} target, ${f.years_remaining ?? 'unknown'} years remaining` +
      pacing
    )
  })
  return {
    content: `Education savings on file:\n${items.join('\n')}${freshnessLine(data.profile)}`,
    operation: 'education_funds',
    provenance: provenance('financial profile — education funds', data.profile),
    grounding: items.join(' '),
  }
}

function renderIncomeStops(data: VerifiedAnswerData): RenderedAnswer {
  const member = data.memberId
    ? data.family?.members.find((m) => m.id === data.memberId)
    : undefined
  const scope: MemberScope | undefined = data.memberId
    ? { member_id: data.memberId, is_organizer: member?.role === 'organizer' }
    : undefined
  const input = toScenarioProfileInput(data.profile as never, scope)
  if (!input) {
    return {
      content:
        "There isn't enough on your financial profile yet (income or expenses) to project what happens if income stops — fill in the income and expenses sections and I can compute it exactly." +
        freshnessLine(data.profile),
      operation: 'income_stops',
      provenance: provenance('scenario engine — insufficient profile data', data.profile),
      grounding: '',
    }
  }
  // "Income stops" = a delta of minus the whole current monthly income, from
  // now on — the same one-step shorthand /assistant/simulate uses.
  const result = calculateScenario(input, {
    monthlyIncomeDeltaMinor: -input.monthlyIncomeMinor,
    ...(data.memberId ? { member_id: data.memberId } : {}),
  })
  const numbers = formatScenarioResult(result)
  const runway = result.projectedRunwayMonths
  return {
    content:
      `Here's what the scenario calculator projects if household income stopped now — ` +
      `computed from your profile, not estimated:\n\n` +
      numbers +
      (runway !== null
        ? `\n\nSo the emergency fund would cover **${runway < 1 ? 'less than a month' : runway > 60 ? 'more than five years' : `about ${Math.round(runway)} ${Math.round(runway) === 1 ? 'month' : 'months'}`}** of the current gap.`
        : "\n\nUnder this scenario income would still cover expenses — the fund isn't drawn down.") +
      freshnessLine(data.profile),
    operation: 'income_stops',
    provenance: provenance('scenario engine — computed from financial profile', data.profile),
    grounding: numbers,
  }
}

/**
 * Render one resolved operation. Returns null when the operation can't be
 * rendered honestly from the data — or when the presence check finds a
 * figure in the content that isn't in the computed grounding (a template
 * bug must never ship a number we can't vouch for). The caller falls
 * through to generation either way.
 */
export function renderVerifiedAnswer(
  operation: VerifiedOperationId,
  data: VerifiedAnswerData,
): VerifiedAnswer | null {
  const rendered =
    operation === 'emergency_fund'
      ? renderEmergencyFund(data)
      : operation === 'policies'
        ? renderPolicies(data)
        : operation === 'policy_renewals'
          ? renderPolicyRenewals(data)
          : operation === 'readiness'
            ? renderReadiness(data)
            : operation === 'education_funds'
              ? renderEducationFunds(data)
              : renderIncomeStops(data)
  if (!rendered) return null
  if (ungroundedNumbers(rendered.content, rendered.grounding).length > 0) return null
  const { grounding: _grounding, ...answer } = rendered
  return answer
}
