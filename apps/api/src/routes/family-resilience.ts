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
import { confirmersOf, recordFact, type FactKey } from '../resilience/fact-store.js'
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

export type ResilienceView =
  | { status: 'needs_figures'; missing: string[] }
  | {
      status: 'ready'
      scenario: 'income_stops'
      range: { lowMonths: number | null; highMonths: number | null }
      text: string
      left_out: string[]
      next_checks: string[]
      earner_dies?: {
        range: { lowMonths: number | null; highMonths: number | null }
        text: string
        assumptions: string[]
      }
      figures?: { label: string; valueMinor: number }[]
      confirmation?: {
        confirmedBy: string[]
        youConfirmed: boolean
        adultsTotal: number
        allAdultsConfirmed: boolean
      }
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
    left_out: [...LEFT_OUT],
    next_checks: [...checks, CLOSING_ACTION],
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
    const { members, profile } = await load(tenant_id)
    if (!canSeeEngineOutput(members, user_id))
      return reply.status(403).send({ error: 'Only adults in this family can see this' })
    const view = buildResilienceView(profile)
    if (view.status !== 'ready') return view
    const figures = figuresOf(profile)
    const adults = members.filter((m) => canSeeEngineOutput(members, m.id))
    const confirmers = await confirmersOf(db, tenant_id, figuresVersion(figures))
    const isConfirmer = (m: (typeof adults)[number]) =>
      confirmers.includes(m.id) || (m.user_id !== undefined && confirmers.includes(m.user_id))
    const me = adults.find((m) => m.id === user_id || m.user_id === user_id)
    return {
      ...view,
      figures: figures.map(({ label, valueMinor }) => ({ label, valueMinor })),
      confirmation: {
        confirmedBy: adults.filter(isConfirmer).map((m) => m.name ?? 'An adult'),
        youConfirmed: me ? isConfirmer(me) : false,
        adultsTotal: adults.length,
        allAdultsConfirmed: adults.length > 0 && adults.every(isConfirmer),
      },
    }
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
    const version = figuresVersion(figures)
    if ((await confirmersOf(db, tenant_id, version)).includes(user_id)) return { ok: true }
    const now = new Date()
    for (const f of figures)
      await recordFact(db, tenant_id, {
        key: f.key,
        valueMinor: f.valueMinor,
        validFrom: now,
        enteredBy: user_id,
        confirmedAt: now,
        figuresVersion: version,
      })
    return { ok: true }
  })
}
