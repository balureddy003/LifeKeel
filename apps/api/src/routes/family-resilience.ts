/**
 * GET /family/resilience — what the household's own figures say happens if the main income stops
 * (intent 94, thin first slice B9). Runs the pure engine in `resilience/` over the financial profile.
 *
 * Access: an active adult in the family (A5, `canSeeEngineOutput`). Anyone else gets a 403 with no figures.
 * Tier 0: read-only, no write, no model call, nothing leaves the house. Output is information and an
 * estimate: a range of months, what it leaves out, and what to check next, never a product or a "buy".
 * A figure that is not on file is listed as missing, never guessed.
 */
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { NO_END } from '../resilience/cashflow.js'
import { LEFT_OUT, describeRange, runwayRange, type RangeInput } from '../resilience/range.js'
import { CLOSING_ACTION, rankInformationActions } from '../resilience/rank.js'
import {
  confirmersOf,
  firstConfirmedAt,
  recordFact,
  type EngineFactDoc,
  type FactKey,
} from '../resilience/fact-store.js'
import { confirmLatencyBucket, emitEngineMetric } from '../resilience/engine-metrics.js'
import { SCENARIO_FACTS, scenarioVersion, type Scenario } from '../resilience/dependencies.js'
import { ratesVersion } from '../resilience/event-rates.js'
import { canSeeEngineOutput, type VisibilityMember } from '../resilience/visibility.js'

interface ProfileShape {
  household?: {
    monthly_salary_minor?: number
    income_protection_monthly_minor?: number
    life_cover_minor?: number
  }
  emergency_fund?: { emergency_savings_minor?: number; monthly_expenses_minor?: number }
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

export interface Figure {
  label: string
  valueMinor: number
  key: FactKey
}

/** The figures the estimate used, in a fixed order. Empty when any required figure is missing. */
export function figuresOf(profile: ProfileShape | null): Figure[] {
  const savings = profile?.emergency_fund?.emergency_savings_minor
  const spend = profile?.emergency_fund?.monthly_expenses_minor
  const income = profile?.household?.monthly_salary_minor
  if (!positive(savings) || !positive(spend) || !positive(income)) return []
  const protection = profile?.household?.income_protection_monthly_minor
  const cover = profile?.household?.life_cover_minor
  return [
    { label: 'Savings', valueMinor: savings, key: 'savings_minor' },
    { label: 'Monthly spend', valueMinor: spend, key: 'monthly_spend_minor' },
    { label: 'Monthly income', valueMinor: income, key: 'monthly_inflow_minor' },
    {
      label: 'Income protection per month',
      valueMinor: positive(protection) ? protection : 0,
      key: 'income_protection_monthly_minor',
    },
    // Only when entered: the "if the main earner dies" estimate uses it, so it is confirmed with the rest.
    ...(positive(cover)
      ? [
          {
            label: 'Life cover amount',
            valueMinor: cover,
            key: 'life_cover_lump_sum_minor' as const,
          },
        ]
      : []),
  ]
}

/** A hash of the exact figures: any change gives a new version, so earlier confirmations stop counting. */
export function figuresVersion(figures: Figure[]): string {
  return createHash('sha256')
    .update(figures.map((f) => `${f.key}=${f.valueMinor}`).join(';'))
    .digest('hex')
    .slice(0, 16)
}

/** Owner decision 2026-11-15: a life-cover payout arrives 1 to 2 months after the death, shown as a range. */
export const PAYOUT_TIMING = { lowMonths: 1, highMonths: 2 } as const

export interface Confirmation {
  confirmedBy: string[]
  youConfirmed: boolean
  adultsTotal: number
  allAdultsConfirmed: boolean
}

/** The estimates this household has figures for: income stops always, earner dies once life cover is entered. */
function scenariosFor(figures: Figure[]): Scenario[] {
  return figures.some((f) => f.key === 'life_cover_lump_sum_minor')
    ? ['income_stops', 'earner_dies']
    : ['income_stops']
}

export type ResilienceView =
  | { status: 'needs_figures'; missing: string[] }
  | {
      status: 'ready'
      scenario: 'income_stops'
      range: { lowMonths: number | null; highMonths: number | null }
      text: string
      left_out: string[]
      next_checks: string[]
      /** Things the profile does not hold, stated as facts about what is on file. Never a suggestion to buy. */
      not_on_file?: string[]
      earner_dies?: {
        range: { lowMonths: number | null; highMonths: number | null }
        text: string
        assumptions: string[]
      }
      figures?: { label: string; valueMinor: number }[]
      confirmation?: Confirmation
      /** One confirmation per estimate, so a changed figure only unconfirms the estimates that read it. */
      scenarios?: Partial<Record<Scenario, Confirmation>>
      /** Hash of the population event-rate rows this build carries (intent 97, slice 6). */
      rates_version?: string
    }

export function buildResilienceView(profile: ProfileShape | null): ResilienceView {
  const savings = profile?.emergency_fund?.emergency_savings_minor
  const spend = profile?.emergency_fund?.monthly_expenses_minor
  const income = profile?.household?.monthly_salary_minor
  const missing: string[] = []
  if (!positive(savings)) missing.push('savings')
  if (!positive(spend)) missing.push('monthly spend')
  if (!positive(income)) missing.push('monthly income')
  if (missing.length > 0 || !positive(savings) || !positive(spend) || !positive(income))
    return { status: 'needs_figures', missing }

  const protection = profile?.household?.income_protection_monthly_minor
  const input: RangeInput = {
    savingsMinor: savings,
    monthlyInflowMinor: income,
    monthlySpendMinor: spend,
    events: [
      {
        kind: 'income_stops',
        fromMonth: 0,
        monthlyIncomeLostMinor: income,
        ...(positive(protection)
          ? { protection: { monthlyMinor: protection, waitMonths: 0 } }
          : {}),
      },
    ],
  }
  const r = runwayRange(input)
  const open = (n: number) => (n >= NO_END ? null : n)
  const cover = profile?.household?.life_cover_minor
  const deathInput: RangeInput | null = positive(cover)
    ? {
        ...input,
        events: [
          {
            kind: 'earner_dies',
            fromMonth: 0,
            monthlyIncomeLostMinor: income,
            lumpSumOnFileMinor: cover,
            payoutAfterMonths: PAYOUT_TIMING,
          },
        ],
      }
    : null
  const dr = deathInput ? runwayRange(deathInput) : null
  const checks = [
    ...new Set([
      ...rankInformationActions(input).map((a) => a.action),
      ...(deathInput ? rankInformationActions(deathInput).map((a) => a.action) : []),
    ]),
  ]
  return {
    status: 'ready',
    scenario: 'income_stops',
    range: { lowMonths: open(r.lowMonths), highMonths: open(r.highMonths) },
    text: describeRange(r),
    // The estimate says which rate set it was produced against; a rate PR
    // changes this hash, so an estimate can be traced to its rates.
    rates_version: ratesVersion(),
    left_out: [...LEFT_OUT],
    next_checks: [...checks, CLOSING_ACTION],
    not_on_file: [
      ...(positive(protection) ? [] : ['No income protection payout is recorded in your profile.']),
      ...(positive(cover)
        ? []
        : [
            'No life cover amount is recorded in your profile, so there is no estimate for if the main earner dies.',
          ]),
    ],
    ...(dr
      ? {
          earner_dies: {
            range: { lowMonths: open(dr.lowMonths), highMonths: open(dr.highMonths) },
            text: describeRange(dr, 'Savings and the cover payout'),
            assumptions: [
              'Assumes the main income stops and the cover amount you entered is on the main earner.',
              'Assumes the cover pays out 1 to 2 months after a claim.',
            ],
          },
        }
      : {}),
  }
}

type Family = { members?: (VisibilityMember & { name?: string })[] } | null

/**
 * What a signed-in user may see: null when they are not an adult in the family (fails closed), otherwise the
 * estimate with the figures used and each estimate's confirmation. Shared by the web route and the MCP tool
 * so both apply the same visibility rule.
 */
export async function resilienceForUser(
  db: Db,
  tenant_id: string,
  user_id: string,
): Promise<ResilienceView | null> {
  const family = (await db.collection('family_groups').findOne({ tenant_id })) as Family
  const profile = (await db
    .collection('family_financial_profile')
    .findOne({ tenant_id })) as ProfileShape | null
  const members = family?.members ?? []
  if (!canSeeEngineOutput(members, user_id)) return null
  const view = buildResilienceView(profile)
  if (view.status !== 'ready') return view
  const figures = figuresOf(profile)
  const adults = members.filter((m) => canSeeEngineOutput(members, m.id))
  const confirmationFor = async (version: string): Promise<Confirmation> => {
    const confirmers = await confirmersOf(db, tenant_id, version)
    const isConfirmer = (m: (typeof adults)[number]) =>
      confirmers.includes(m.id) || (m.user_id !== undefined && confirmers.includes(m.user_id))
    const me = adults.find((m) => m.id === user_id || m.user_id === user_id)
    return {
      confirmedBy: adults.filter(isConfirmer).map((m) => m.name ?? 'An adult'),
      youConfirmed: me ? isConfirmer(me) : false,
      adultsTotal: adults.length,
      allAdultsConfirmed: adults.length > 0 && adults.every(isConfirmer),
    }
  }
  const scenarios: Partial<Record<Scenario, Confirmation>> = {}
  for (const sc of scenariosFor(figures))
    scenarios[sc] = await confirmationFor(scenarioVersion(figures, sc))
  return {
    ...view,
    figures: figures.map(({ label, valueMinor }) => ({ label, valueMinor })),
    confirmation: await confirmationFor(figuresVersion(figures)),
    scenarios,
  }
}

const FACT_LABELS: Partial<Record<FactKey, string>> = {
  savings_minor: 'Savings',
  monthly_spend_minor: 'Monthly spend',
  monthly_inflow_minor: 'Monthly income',
  income_protection_monthly_minor: 'Income protection per month',
  life_cover_lump_sum_minor: 'Life cover amount',
}

export interface ConfirmationHistoryEntry {
  scenario: Scenario
  current: boolean
  confirmedBy: { name: string; at: string }[]
  figures: { label: string; valueMinor: number }[]
}

/**
 * Every set of figures an adult confirmed, newest first: who, when, and the exact figures. A set stays here
 * after a figure changes (it is just no longer `current`), so the family can see what each adult agreed to
 * and on what date. Null when the caller is not an adult in the family (fails closed).
 */
export async function confirmationHistory(
  db: Db,
  tenant_id: string,
  user_id: string,
): Promise<ConfirmationHistoryEntry[] | null> {
  const family = (await db.collection('family_groups').findOne({ tenant_id })) as Family
  const members = family?.members ?? []
  if (!canSeeEngineOutput(members, user_id)) return null
  const profile = (await db
    .collection('family_financial_profile')
    .findOne({ tenant_id })) as ProfileShape | null
  const figures = figuresOf(profile)
  const currentVersions = new Set(scenariosFor(figures).map((sc) => scenarioVersion(figures, sc)))
  const rows = (await db
    .collection<EngineFactDoc>('engine_facts')
    .find({ tenant_id })
    .toArray()) as EngineFactDoc[]
  const byVersion = new Map<string, EngineFactDoc[]>()
  for (const r of rows) {
    if (!r.figures_version || !(r.confirmed_at instanceof Date)) continue
    byVersion.set(r.figures_version, [...(byVersion.get(r.figures_version) ?? []), r])
  }
  const nameOf = (id: string) =>
    members.find((m) => m.id === id || m.user_id === id)?.name ?? 'An adult'
  const entries = [...byVersion.entries()].map(([version, facts]) => {
    const latest = new Map<string, Date>()
    for (const r of facts) {
      const c = r.confirmed_at as Date
      const prev = latest.get(r.entered_by)
      if (!prev || c > prev) latest.set(r.entered_by, c)
    }
    const newest = Math.max(...[...latest.values()].map((d) => d.getTime()))
    const entry: ConfirmationHistoryEntry = {
      scenario: facts.some((r) => r.key === 'life_cover_lump_sum_minor')
        ? 'earner_dies'
        : 'income_stops',
      current: currentVersions.has(version),
      confirmedBy: [...latest.entries()]
        .sort((a, b) => a[1].getTime() - b[1].getTime())
        .map(([id, at]) => ({ name: nameOf(id), at: at.toISOString() })),
      figures: (Object.keys(FACT_LABELS) as FactKey[])
        .map((k) => facts.find((r) => r.key === k))
        .filter((r): r is EngineFactDoc => r !== undefined)
        .map((r) => ({ label: FACT_LABELS[r.key] ?? r.key, valueMinor: r.value_minor })),
    }
    return { entry, newest }
  })
  return entries
    .sort((a, b) => b.newest - a.newest || Number(b.entry.current) - Number(a.entry.current))
    .slice(0, 20)
    .map((e) => e.entry)
}

export function registerFamilyResilienceRoutes(app: FastifyInstance, db: Db): void {
  // Confirmations are looked up by tenant and version on every read.
  db.collection('engine_facts')
    .createIndex({ tenant_id: 1, figures_version: 1 })
    .catch(() => {})
  const load = async (tenant_id: string) => {
    const family = (await db.collection('family_groups').findOne({ tenant_id })) as Family
    const profile = (await db
      .collection('family_financial_profile')
      .findOne({ tenant_id })) as ProfileShape | null
    return { members: family?.members ?? [], profile }
  }

  app.get('/family/resilience', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const view = await resilienceForUser(db, tenant_id, user_id)
    if (!view) return reply.status(403).send({ error: 'Only adults in this family can see this' })
    return view
  })

  app.get('/family/resilience/history', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const entries = await confirmationHistory(db, tenant_id, user_id)
    if (!entries)
      return reply.status(403).send({ error: 'Only adults in this family can see this' })
    return { entries }
  })

  // An adult confirms the exact figures the estimate used. Append-only facts; confirming twice writes nothing.
  app.post('/family/resilience/confirm', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const { members, profile } = await load(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can confirm this' })
    const figures = figuresOf(profile)
    if (figures.length === 0)
      return reply.status(400).send({ error: 'Enter your savings, spend and income first' })
    const now = new Date()
    // One set of facts per estimate, each under that estimate's own version.
    let wrote = false
    for (const sc of scenariosFor(figures)) {
      const version = scenarioVersion(figures, sc)
      if ((await confirmersOf(db, tenant_id, version)).includes(user_id)) continue
      for (const f of figures.filter((x) => SCENARIO_FACTS[sc].includes(x.key)))
        await recordFact(db, tenant_id, {
          key: f.key,
          valueMinor: f.valueMinor,
          validFrom: now,
          enteredBy: user_id,
          confirmedAt: now,
          figuresVersion: version,
        })
      wrote = true
    }
    // Engine metrics (intent 97, slice 1): one event per adult's confirmation,
    // plus the all-adults completion and the bucketed time to get there.
    // Emits never throw.
    if (wrote) {
      await emitEngineMetric(db, {
        tenantId: tenant_id,
        event: 'figures_confirmed_one_adult',
        fieldClass: 'figures',
      })
      const version = figuresVersion(figures)
      const confirmers = await confirmersOf(db, tenant_id, version)
      const adults = members.filter((m) => canSeeEngineOutput(members, m.id))
      const isConfirmer = (m: (typeof adults)[number]) =>
        confirmers.includes(m.id) || (m.user_id !== undefined && confirmers.includes(m.user_id))
      if (adults.length > 0 && adults.every(isConfirmer)) {
        await emitEngineMetric(db, {
          tenantId: tenant_id,
          event: 'figures_confirmed_all_adults',
          fieldClass: 'figures',
        })
        const first = await firstConfirmedAt(db, tenant_id, version)
        if (first)
          await emitEngineMetric(db, {
            tenantId: tenant_id,
            event: 'figures_confirm_latency',
            fieldClass: 'figures',
            bucket: confirmLatencyBucket(now.getTime() - first.getTime()),
          })
      }
    }
    return { ok: true }
  })
}
