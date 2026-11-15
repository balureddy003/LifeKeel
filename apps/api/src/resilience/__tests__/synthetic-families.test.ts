/**
 * The fictional families used by the staging simulation (scripts/staging-sim/resilience-families.json).
 * Their expected answers are worked out by hand, so this test keeps them honest against the engine and
 * against the profile schema the API will validate them with. If this fails, either the hand-worked
 * answer or the engine is wrong: look at both before changing either.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildResilienceView, figuresOf, figuresVersion } from '../../routes/family-resilience.js'
import { buildBusinessShocks } from '../../routes/family-businesses.js'
import { FinancialProfileSchema } from '../../routes/family-financial-profile.js'
import { scenarioVersion } from '../dependencies.js'
import type { BusinessGraph } from '../business-graph.js'

interface Family {
  id: string
  adults: string[]
  children: string[]
  profile: {
    employment_status: string
    monthly_salary_minor: number
    monthly_expenses_minor: number
    emergency_savings_minor: number
    life_cover_minor: number
    income_protection_monthly_minor: number
  }
  businesses?: { name: string; pays: { adult: number; monthly_minor: number }[] }[]
  expected: {
    income_stops?: { low: number; high: number }
    earner_dies?: { low: number; high: number } | null
    business_stops?: { name: string; low: number; high: number }[]
    needs_figures?: string[]
    scenarios?: string[]
  }
}

const file = fileURLToPath(
  new URL('../../../../../scripts/staging-sim/resilience-families.json', import.meta.url),
)
const families = (JSON.parse(readFileSync(file, 'utf8')) as { families: Family[] }).families

const profileOf = (f: Family) => ({
  household: {
    monthly_salary_minor: f.profile.monthly_salary_minor,
    life_cover_minor: f.profile.life_cover_minor,
    income_protection_monthly_minor: f.profile.income_protection_monthly_minor,
  },
  emergency_fund: {
    emergency_savings_minor: f.profile.emergency_savings_minor,
    monthly_expenses_minor: f.profile.monthly_expenses_minor,
  },
})

describe('synthetic resilience families', () => {
  it('has the families the simulation expects', () => {
    expect(families.map((f) => f.id)).toEqual([
      'okafor',
      'lindqvist',
      'rahman',
      'petrovic',
      'adeyemi',
    ])
  })

  for (const f of families) {
    describe(f.id, () => {
      it('has a profile the API schema accepts when completed with the fixed defaults', () => {
        const parsed = FinancialProfileSchema.safeParse({
          household: {
            employment_status: f.profile.employment_status,
            monthly_salary_minor: f.profile.monthly_salary_minor,
            annual_living_expenses_minor: f.profile.monthly_expenses_minor * 12,
            life_cover_minor: f.profile.life_cover_minor,
            income_protection_monthly_minor: f.profile.income_protection_monthly_minor,
          },
          emergency_fund: {
            emergency_savings_minor: f.profile.emergency_savings_minor,
            monthly_expenses_minor: f.profile.monthly_expenses_minor,
          },
          retirement: {
            current_age: 40,
            target_retirement_age: 67,
            pension_balance_minor: 0,
            monthly_contribution_minor: 0,
            target_retirement_income_minor: 0,
          },
          policies: [],
        })
        expect(parsed.error?.issues ?? []).toEqual([])
      })

      it('gets the hand-worked answer from the engine', () => {
        const view = buildResilienceView(profileOf(f))
        if (f.expected.needs_figures) {
          expect(view).toMatchObject({ status: 'needs_figures', missing: f.expected.needs_figures })
          return
        }
        expect(view.status).toBe('ready')
        if (view.status !== 'ready') return
        expect(view.range).toEqual({
          lowMonths: f.expected.income_stops?.low,
          highMonths: f.expected.income_stops?.high,
        })
        if (f.expected.earner_dies) {
          expect(view.earner_dies?.range).toEqual({
            lowMonths: f.expected.earner_dies.low,
            highMonths: f.expected.earner_dies.high,
          })
        } else {
          expect(view.earner_dies).toBeUndefined()
        }
      })

      it('gets the hand-worked answer if each business stops', () => {
        const graph: BusinessGraph = {
          businesses: (f.businesses ?? []).map((b, i) => ({ id: `b${i}`, name: b.name })),
          incomeEdges: (f.businesses ?? []).flatMap((b, i) =>
            b.pays.map((p) => ({
              businessId: `b${i}`,
              memberId: `m${p.adult}`,
              monthlyMinor: p.monthly_minor,
            })),
          ),
        }
        const shocks = buildBusinessShocks(profileOf(f), graph)
        const expected = f.expected.business_stops ?? []
        expect(
          shocks.map((s) => ({ name: s.name, low: s.range.lowMonths, high: s.range.highMonths })),
        ).toEqual(expected.map((e) => ({ name: e.name, low: e.low, high: e.high })))
      })

      it('lists the estimates that need confirming', () => {
        if (!f.expected.scenarios) return
        const figures = figuresOf(profileOf(f))
        const present = ['income_stops', ...(f.profile.life_cover_minor > 0 ? ['earner_dies'] : [])]
        expect(present).toEqual(f.expected.scenarios)
        // Each estimate has its own version, and they differ exactly when life cover is part of the figures.
        const a = scenarioVersion(figures, 'income_stops')
        const b = scenarioVersion(figures, 'earner_dies')
        expect(a === b).toBe(f.profile.life_cover_minor === 0)
        expect(figuresVersion(figures)).toBe(b)
      })
    })
  }
})
