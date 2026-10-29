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
import { BRIEF_CATALOGUE } from './catalogue.js'
import { calculateScenario, type ScenarioResult } from '../scenarios/calculate.js'
import type { BriefFact } from './catalogue.js'

export const BRIEF_SOLVER_VERSION = 'brief-v1'
export const BRIEF_PROBLEM_TYPES = ['income_stops', 'earning_less', 'handover_gap'] as const
export type BriefProblemType = (typeof BRIEF_PROBLEM_TYPES)[number]

export const SHARE_TOKEN_TTL_DAYS = 30

export interface BriefInputs extends Record<string, unknown> {
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
  /** user_id of the roster member this link is bound to (contract v2). */
  for_user_id?: string
}

export interface HouseholdBriefDoc extends Record<string, unknown> {
  id: string
  tenant_id: string
  problem_type: string
  inputs: BriefInputs
  result: ScenarioResult | null
  /** Rendered only from `result` + inputs — the numeral-presence invariant. */
  template_sentence: string
  narrated_sentence: string | null
  narrated_solver_version: string | null
  narrated_data_version: string | null
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
  /** 2 = immutable catalogue snapshot with per-adult acknowledgements. */
  contract_version?: 2
  title?: string
  facts?: BriefFact[]
  /** Health/care handover facts are envelope-encrypted at rest (UK GDPR);
   *  facts stays empty on those docs and readers decrypt via facts_encrypted. */
  sensitive?: boolean
  facts_encrypted?: string
  /** Content-free access log: who opened sensitive facts and when (Intent 79). */
  sensitive_access?: Array<{ user_id: string; at: Date }>
  /** Sensitive facts hard-expire this long after creation (DPIA retention). */
  facts_expire_at?: Date
  result_version?: string
  as_of_date?: string
  acknowledgements?: Array<{ user_id: string; result_version: string; confirmed_at: Date }>
}

export const briefsFor = (db: Db, tenantId: string) =>
  getTenantCollection<HouseholdBriefDoc>(db, 'household_briefs', tenantId)

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export function briefDataVersion(problem: string, inputs: Record<string, unknown>): string {
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

// ─── Optional governed narration (brief.narrate.v1) ─────────────────────────
//
// PRD-222: narration is a separate, budgeted, optional step. The model only
// rephrases the deterministic template — it may never supply or adjust a
// number. Every numeral in its output must appear in the solver payload or
// the output is rejected and the template is used. The stored sentence is
// cached by solver_version + data_version so a hit costs zero model calls.

export interface NarrateOutcome {
  sentence: string
  narrated: boolean
  from_cache: boolean
}

/** Numbers a narration is allowed to contain — derived from result + inputs. */
function allowedNumerals(result: unknown, inputs: unknown): Set<number> {
  const allowed = new Set<number>()
  const collect = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) allowed.add(Math.round(v))
    else if (Array.isArray(v)) v.forEach(collect)
    else if (v && typeof v === 'object' && !(v instanceof Date)) Object.values(v).forEach(collect)
  }
  collect(result)
  collect(inputs)
  return allowed
}

/**
 * Server-side numeral-presence guard (Intent 65 invariant): every numeral
 * in `text` must exist in the solver payload — £-values compare as pounds
 * (payload is minor units), plain numbers match within rounding or as the
 * pounds value of a minor figure.
 */
export function numeralsGrounded(text: string, result: unknown, inputs: unknown): boolean {
  const allowed = allowedNumerals(result, inputs)
  const digits = text.match(/£?[\d,]+(?:\.\d+)?/g) ?? []
  return digits.every((d) => {
    const money = d.startsWith('£')
    const n = Number(d.replace(/[£,]/g, ''))
    return money
      ? [...allowed].some((a) => Math.round(a / 100) === n)
      : [...allowed].some((a) => Math.abs(a - n) < 0.15 || Math.round(a / 100) === n)
  })
}

const NARRATE_SYSTEM =
  'You rephrase a household financial brief. Use ONLY the facts and numbers given — never add, remove, or change any number, and never name or suggest a product or provider. Return one short, calm paragraph.'

type LlmFn = (system: string, prompt: string, model?: string) => Promise<string>

/**
 * Narrate a stored brief with a governed LlmFn (taskLlm('brief.narrate.v1')).
 * Falls back to the template on call failure, budget exhaustion, or any
 * numeral absent from the solver payload. Cached on the brief by versions.
 */
export async function narrateBrief(
  db: Db,
  brief: HouseholdBriefDoc,
  llm: LlmFn,
): Promise<NarrateOutcome> {
  // Catalogue briefs are factual snapshots. Handover/health content must
  // never leave this store through the optional narration path.
  if (brief.contract_version === 2)
    return { sentence: brief.template_sentence, narrated: false, from_cache: false }
  if (
    brief.narrated_sentence &&
    brief.narrated_solver_version === brief.solver_version &&
    brief.narrated_data_version === brief.data_version
  ) {
    return { sentence: brief.narrated_sentence, narrated: true, from_cache: true }
  }
  const prompt =
    `Template sentence (the only facts you may use):\n${brief.template_sentence}\n\n` +
    `Solver figures, minor units (pence):\n${JSON.stringify(brief.result)}\n\n` +
    'Rephrase the template sentence for the partner opening the shared brief.'
  try {
    const text = (await llm(NARRATE_SYSTEM, prompt)).trim()
    if (!text || !numeralsGrounded(text, brief.result, brief.inputs))
      return { sentence: brief.template_sentence, narrated: false, from_cache: false }
    await briefsFor(db, brief.tenant_id).updateOne(
      { id: brief.id },
      {
        $set: {
          narrated_sentence: text,
          narrated_solver_version: brief.solver_version,
          narrated_data_version: brief.data_version,
          updated_at: new Date(),
        },
      },
    )
    return { sentence: text, narrated: true, from_cache: false }
  } catch {
    return { sentence: brief.template_sentence, narrated: false, from_cache: false }
  }
}

// ─── One-off migration: encrypt plaintext facts on sensitive briefs ─────────
// Idempotent: skips docs already carrying facts_encrypted. Never logs content.
export async function migrateSensitiveBriefFacts(db: Db): Promise<{
  migrated: number
  skipped: number
}> {
  const sensitiveIds = new Set(BRIEF_CATALOGUE.filter((e) => e.sensitive).map((e) => e.id))
  const { encryptForTenant } = await import('../crypto/envelope.js')
  let migrated = 0
  let skipped = 0
  const docs = await db
    .collection<HouseholdBriefDoc>('household_briefs')
    .find({ facts: { $exists: true, $ne: [] } })
    .toArray()
  for (const doc of docs) {
    if (!sensitiveIds.has(doc.problem_type) || doc.facts_encrypted) {
      skipped++
      continue
    }
    await db.collection<HouseholdBriefDoc>('household_briefs').updateOne(
      { id: doc.id },
      {
        $set: {
          facts: [],
          sensitive: true,
          facts_encrypted: await encryptForTenant(db, doc.tenant_id, JSON.stringify(doc.facts)),
          facts_expire_at: doc.facts_expire_at ?? new Date(Date.now() + SENSITIVE_FACTS_TTL_MS),
          updated_at: new Date(),
        },
      },
    )
    migrated++
  }
  return { migrated, skipped }
}

/** DPIA-set retention for sensitive handover facts (~24 months). */
export const SENSITIVE_FACTS_TTL_MS = 24 * 30 * 24 * 60 * 60 * 1000
