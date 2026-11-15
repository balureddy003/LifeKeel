/**
 * GET /family/resilience — what the household's own figures say happens if the main income stops
 * (intent 94, thin first slice B9). Runs the pure engine in `resilience/` over the financial profile.
 *
 * Access: an active adult in the family (A5, `canSeeEngineOutput`). Anyone else gets a 403 with no figures.
 * Tier 0: read-only, no write, no model call, nothing leaves the house. Output is information and an
 * estimate: a range of months, what it leaves out, and what to check next, never a product or a "buy".
 * A figure that is not on file is listed as missing, never guessed.
 */
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { NO_END } from '../resilience/cashflow.js'
import { LEFT_OUT, describeRange, runwayRange, type RangeInput } from '../resilience/range.js'
import { CLOSING_ACTION, rankInformationActions } from '../resilience/rank.js'
import { canSeeEngineOutput, type VisibilityMember } from '../resilience/visibility.js'

interface ProfileShape {
  household?: { monthly_salary_minor?: number; income_protection_monthly_minor?: number }
  emergency_fund?: { emergency_savings_minor?: number; monthly_expenses_minor?: number }
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

export type ResilienceView =
  | { status: 'needs_figures'; missing: string[] }
  | {
      status: 'ready'
      scenario: 'income_stops'
      range: { lowMonths: number | null; highMonths: number | null }
      text: string
      left_out: string[]
      next_checks: string[]
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
  return {
    status: 'ready',
    scenario: 'income_stops',
    range: { lowMonths: open(r.lowMonths), highMonths: open(r.highMonths) },
    text: describeRange(r),
    left_out: [...LEFT_OUT],
    next_checks: [...rankInformationActions(input).map((a) => a.action), CLOSING_ACTION],
  }
}

export function registerFamilyResilienceRoutes(app: FastifyInstance, db: Db): void {
  app.get('/family/resilience', async (req, reply) => {
    const { tenant_id, user_id } = req.authContext
    const family = (await db.collection('family_groups').findOne({ tenant_id })) as {
      members?: VisibilityMember[]
    } | null
    if (!canSeeEngineOutput(family?.members ?? [], user_id))
      return reply.status(403).send({ error: 'Only adults in this family can see this' })
    const profile = (await db
      .collection('family_financial_profile')
      .findOne({ tenant_id })) as ProfileShape | null
    return buildResilienceView(profile)
  })
}
