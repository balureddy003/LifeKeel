/**
 * Household briefs — PRD-222 (Stage 1 of the brief platform pivot).
 *
 * One problem, a few inputs, one deterministic solver call, a fixed
 * template sentence, a share link, two timestamps:
 *
 *   link_fetched_at      first GET of the public result endpoint —
 *                        telemetry only; link unfurlers and mail scanners
 *                        set this, so it is NEVER shown as "opened".
 *   confirmed_opened_at  set only by POST /b/:token/confirm after an
 *                        explicit "view the numbers" action on the share
 *                        page. The product promise uses this.
 *
 * The brief hot path never loads the full profile, never runs the
 * detector sweep, and never calls a model. The solver is the only
 * source of numbers; template_sentence is generated only from solver
 * payload fields (intent 65 numeral-presence invariant applies to the
 * template itself, not just narration).
 *
 *   household_briefs = {
 *     id, tenant_id, problem_type, inputs, result, template_sentence,
 *     narrated_sentence, solver_version, data_version, stale,
 *     share: { token_hash, for_member_id, for_member_name, expires_at,
 *              revoked_at } | null,
 *     link_fetched_at, confirmed_opened_at, confirmed_by,
 *     created_by, created_at, updated_at
 *   }
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { getTenantCollection } from '@lifekeel/platform'
import { calculateScenario, type ScenarioResult } from '../scenarios/calculate.js'

export const BRIEF_SOLVER_VERSION = 'brief-v1'
export const BRIEF_PROBLEM_TYPES = ['income_stops', 'earning_less', 'handover_gap'] as const
export type BriefProblemType = (typeof BRIEF_PROBLEM_TYPES)[number]

export const SHARE_TOKEN_TTL_DAYS = 30

export interface BriefInputs {
  /** `income_stops` / `earning_less`: earner's take-home per month. */
  monthly_income_minor?: number
  /** Essential monthly spending the brief measures runway against. */
  monthly_essentials_minor?: number
  /** Liquid savings available today. */
  liquid_savings_minor?: number
  /** `income_stops`: recorded income-protection cover paying out monthly. */
  income_protection_monthly_minor?: number
  /** `income_stops`: months the recorded cover waits before paying. */
  deferred_period_months?: number
  /** `earning_less`: income after the known drop takes effect. */
  new_income_minor?: number
  /** `earning_less`: months until the drop takes effect. */
  months_until_change?: number
}

export interface BriefShare {
  token_hash: string
  for_member_id: string | null
  for_member_name: string | null
  expires_at: Date
  revoked_at: Date | null
}

export interface HouseholdBriefDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  problem_type: BriefProblemType
  inputs: BriefInputs
  result: ScenarioResult | null
  /** Rendered only from `result` + inputs — the numeral-presence invariant. */
  template_sentence: string
  narrated_sentence: string | null
  solver_version: string
  data_version: string
  stale: boolean
  share: BriefShare | null
  link_fetched_at: Date | null
  confirmed_opened_at: Date | null
  /** user_id of the confirmer when they had a session; null for anonymous. */
  confirmed_by: string | null
  created_by: string
  created_at: Date
  updated_at: Date
}

export const briefsFor = (db: Db, tenantId: string) =>
  getTenantCollection<HouseholdBriefDoc>(db, 'household_briefs', tenantId)

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function briefDataVersion(problem: BriefProblemType, inputs: BriefInputs): string {
  const canon = JSON.stringify({ problem, inputs: sortKeys(inputs) })
  return createHash('sha256').update(canon).digest('hex').slice(0, 16)
}
function sortKeys(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortKeys)
  if (o && typeof o === 'object' && !(o instanceof Date))
    return Object.fromEntries(
      Object.keys(o as object)
        .sort()
        .map((k) => [k, sortKeys((o as Record<string, unknown>)[k])]),
    )
  return o
}

const gbp = (minor: number) =>
  `${minor < 0 ? '-' : ''}£${Math.round(Math.abs(minor) / 100).toLocaleString('en-GB')}`
/** null runway means income covers spending — savings keep growing. */
const lastFor = (m: number | null) =>
  m === null
    ? 'indefinitely — income still covers spending'
    : `about ${Math.max(m, 0).toFixed(1)} months`

/**
 * The deterministic template — every numeral comes from the solver
 * `result` or the declared `inputs`, never from constants. The
 * numeral-presence test enforces this (intent 65, applied to the
 * template itself per PRD-222).
 */
export function renderBriefTemplate(
  problem: BriefProblemType,
  inputs: BriefInputs,
  r: ScenarioResult,
): string {
  const essentials = gbp(inputs.monthly_essentials_minor ?? 0)
  const depleted =
    r.fundDepletedAtMonth !== null ? ` — the fund runs out at month ${r.fundDepletedAtMonth}` : ''
  switch (problem) {
    case 'income_stops': {
      const runway = lastFor(r.projectedRunwayMonths)
      const ip = inputs.income_protection_monthly_minor
      const defer = inputs.deferred_period_months ?? 0
      const clause = ip
        ? defer > 0
          ? `once cover starts paying ${gbp(ip)} a month after a ${defer}-month wait, savings would be down to ${gbp(r.savingsAtChangeMinor)} and last ${runway}`
          : `with cover of ${gbp(ip)} a month paying from the start, savings of ${gbp(r.savingsAtChangeMinor)} would last ${runway}`
        : `savings of ${gbp(r.savingsAtChangeMinor)} against essentials of ${essentials} a month would last ${runway}`
      return `If that income stopped tomorrow, ${clause}${depleted}.`
    }
    case 'earning_less': {
      const runway = lastFor(r.projectedRunwayMonths)
      return `In ${r.monthsUntilChange} months, when income drops to ${gbp(r.projectedMonthlyIncomeMinor)} a month, savings would stand at ${gbp(r.savingsAtChangeMinor)} and last ${runway} against essentials of ${essentials} a month${depleted}.`
    }
    case 'handover_gap': {
      if (r.currentRunwayMonths === null)
        return `Right now income covers essentials of ${essentials} a month — savings of ${gbp(inputs.liquid_savings_minor ?? 0)} sit on top. The key people, papers and policies are listed below.`
      return `Right now, savings of ${gbp(inputs.liquid_savings_minor ?? 0)} cover essentials of ${essentials} a month for about ${Math.max(r.currentRunwayMonths, 0).toFixed(1)} months. The key people, papers and policies are listed below.`
    }
  }
}

/** Build the solver input + change for a problem, then run it once. */
export function solveBrief(
  problem: BriefProblemType,
  inputs: BriefInputs,
): { result: ScenarioResult; template_sentence: string } | { error: string } {
  const income = inputs.monthly_income_minor ?? 0
  const essentials = inputs.monthly_essentials_minor ?? 0
  const savings = inputs.liquid_savings_minor ?? 0
  if (income <= 0 && problem !== 'handover_gap')
    return { error: 'A monthly take-home income is required for this brief' }
  if (essentials <= 0) return { error: 'Monthly essentials are required for this brief' }
  if (savings < 0) return { error: 'Savings cannot be negative' }

  const profile = {
    monthlyIncomeMinor: income,
    monthlyExpensesMinor: essentials,
    emergencySavingsMinor: savings,
    educationFunds: [],
  }
  let change
  switch (problem) {
    case 'income_stops': {
      const ip = inputs.income_protection_monthly_minor ?? 0
      const defer = inputs.deferred_period_months ?? 0
      change =
        ip > 0 && defer > 0
          ? {
              steps: [
                { atMonth: 0, monthlyIncomeDeltaMinor: -income },
                { atMonth: defer, monthlyIncomeDeltaMinor: ip },
              ],
            }
          : { monthlyIncomeDeltaMinor: ip - income }
      break
    }
    case 'earning_less': {
      const nxt = inputs.new_income_minor ?? 0
      const until = inputs.months_until_change ?? 0
      if (nxt >= income) return { error: 'The new income must be lower than the current income' }
      change = { monthlyIncomeDeltaMinor: nxt - income, monthsUntilChange: until }
      break
    }
    case 'handover_gap':
      change = {}
      break
  }
  const result = calculateScenario(profile, change)
  return { result, template_sentence: renderBriefTemplate(problem, inputs, result) }
}

/**
 * Change-driven invalidation (PRD-226 change 3): a write to the inputs a
 * brief depends on marks that tenant's briefs stale. Stale briefs are
 * recomputed once on next read — sweeps stay off the hot path.
 */
export async function markBriefsStale(db: Db, tenantId: string): Promise<number> {
  const res = await briefsFor(db, tenantId).updateMany(
    { stale: { $ne: true } },
    { $set: { stale: true, updated_at: new Date() } },
  )
  return (res as { modifiedCount?: number }).modifiedCount ?? 0
}

/** Emit a brief funnel event (content-free enum only). */
export async function emitBriefEvent(
  db: Db,
  tenantId: string,
  event:
    | 'brief_created'
    | 'brief_share_link_generated'
    | 'brief_link_fetched'
    | 'brief_confirmed_open'
    | 'brief_gate_hit'
    | 'brief_gate_converted',
  meta: Record<string, unknown> | null = null,
): Promise<void> {
  await db
    .collection('growth_events')
    .insertOne({ tenant_id: tenantId, event, meta, created_at: new Date() })
    .catch(() => {})
}
