/**
 * Stale profile evaluation sweep — finds profiles autosaved but never
 * finally submitted (or edited since their last evaluation) and runs the
 * same Tier-0 detector pass POST /family/financial-profile/evaluate runs
 * on demand. Covers the completeness heuristic specifically (case 5): the
 * codebase already fixed a bug once where evaluating against a wizard
 * step's zero defaults produced a misleading insight, so a naive "edited
 * since last eval" trigger alone must not reintroduce it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, type Insight } from '@agentoak/engine'
import { runStaleProfileEvaluationSweep, isSubstantivelyComplete } from '../stale-profile-evaluation.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

vi.mock('../../signals.js', () => ({
  persistSignal: vi.fn(async () => 'stub-signal-id'),
}))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(__dirname, '../../../../../detectors')

const TENANT_A = 'tenant-stale-sweep-a'
const TENANT_B = 'tenant-stale-sweep-b'

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

// A complete, substantively-filled-in profile — passes both
// FinancialProfileSchema and isSubstantivelyComplete. Shaped to trip
// retirement-gap.yaml's no_retirement_savings rule (pension_balance_minor
// === 0) so onInsightsGenerated has something real to assert on.
function makeCompleteProfile(overrides: Partial<FinancialProfile> = {}): Record<string, unknown> {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 250000,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 10_000_000,
      income_protection_monthly_minor: 400000,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 900000,
      monthly_expenses_minor: 300000,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 40,
      target_retirement_age: 65,
      pension_balance_minor: 0,
      monthly_contribution_minor: 0,
      target_retirement_income_minor: 3_000_000,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies: [],
    ...overrides,
  }
}

// Only the first wizard step (household) has real numbers — emergency
// fund and retirement are still at their zero defaults. Still a
// structurally-valid FinancialProfile (every field has a default), which
// is exactly why FinancialProfileSchema.safeParse alone can't catch it.
function makeAbandonedProfile(): Record<string, unknown> {
  return {
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 0,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
      members: [],
    },
    emergency_fund: {
      emergency_savings_minor: 0,
      monthly_expenses_minor: 0,
      has_high_interest_debt: false,
      high_interest_debt_balance_minor: 0,
    },
    retirement: {
      current_age: 0,
      target_retirement_age: 0,
      pension_balance_minor: 0,
      monthly_contribution_minor: 0,
      target_retirement_income_minor: 0,
      expected_annual_growth_pct: 5,
    },
    education_funds: [],
    policies: [],
  }
}

function matchesFilter(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as Record<string, unknown>[]).some((c) => matchesFilter(doc, c))
    if (key === '$expr') {
      const [a, b] = (cond as { $gt: [string, string] }).$gt
      const val = (k: string) => doc[k.replace('$', '')] as Date | undefined
      const av = val(a)
      const bv = val(b)
      return av !== undefined && (bv === undefined || av.getTime() > bv.getTime())
    }
    if (cond && typeof cond === 'object' && '$exists' in (cond as Record<string, unknown>)) {
      const exists = doc[key] !== undefined
      return exists === (cond as { $exists: boolean }).$exists
    }
    return doc[key] === cond
  })
}

function makeProfileCollection(docs: Record<string, unknown>[]) {
  return {
    find: (filter: Record<string, unknown> = {}) => ({
      limit: (n: number) => ({
        toArray: async () => docs.filter((d) => matchesFilter(d, filter)).slice(0, n),
      }),
    }),
    updateOne: vi.fn(async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
      const doc = docs.find((d) => matchesFilter(d, filter))
      if (!doc) return { matchedCount: 0 }
      Object.assign(doc, update.$set)
      return { matchedCount: 1 }
    }),
  }
}

let profileDocs: Record<string, unknown>[]

function makeDb() {
  const insightsCol = { find: () => ({ toArray: async () => [] }), updateMany: vi.fn(async () => ({ modifiedCount: 0 })) }
  const familyGroupsCol = { findOne: async () => null }
  const documentsCol = { find: () => ({ toArray: async () => [] }) }
  const profileCol = makeProfileCollection(profileDocs)
  return {
    collection: (name: string) =>
      name === 'family_financial_profile' ? profileCol
        : name === 'insights' ? insightsCol
        : name === 'family_groups' ? familyGroupsCol
        : name === 'documents' ? documentsCol
        : profileCol,
  } as never
}

type DeliveryHook = (insights: Insight[], tenantId: string) => Promise<void>

let engine: Engine
let onInsightsGenerated: DeliveryHook & ReturnType<typeof vi.fn>

beforeEach(() => {
  engine = new Engine({ detectorsDir: DETECTORS_DIR, strictValidation: false })
  onInsightsGenerated = vi.fn(async (_insights: Insight[], _tenantId: string) => {})
  profileDocs = []
})

describe('isSubstantivelyComplete', () => {
  it('requires real signal from household, emergency fund, and retirement', () => {
    expect(isSubstantivelyComplete(makeCompleteProfile() as unknown as FinancialProfile)).toBe(true)
    expect(isSubstantivelyComplete(makeAbandonedProfile() as unknown as FinancialProfile)).toBe(false)
  })
})

describe('runStaleProfileEvaluationSweep', () => {
  it('evaluates a never-evaluated, substantively complete profile and stamps it', async () => {
    profileDocs = [{ tenant_id: TENANT_A, ...makeCompleteProfile(), updated_at: daysAgo(1) }]
    const summary = await runStaleProfileEvaluationSweep(makeDb(), engine, onInsightsGenerated)

    expect(summary).toMatchObject({ candidates: 1, evaluated: 1, skippedIncomplete: 0, failed: 0 })
    expect(onInsightsGenerated).toHaveBeenCalledTimes(1)
    const [insights, tenantId] = onInsightsGenerated.mock.calls[0]!
    expect(tenantId).toBe(TENANT_A)
    expect((insights as Insight[]).some((i) => i.rule_id === 'no_retirement_savings')).toBe(true)
    expect(profileDocs[0]!['insights_evaluated_at']).toBeInstanceOf(Date)
  })

  it('leaves an already-current profile untouched', async () => {
    profileDocs = [{
      tenant_id: TENANT_A,
      ...makeCompleteProfile(),
      updated_at: daysAgo(5),
      insights_evaluated_at: daysAgo(1),
    }]
    const summary = await runStaleProfileEvaluationSweep(makeDb(), engine, onInsightsGenerated)

    expect(summary).toMatchObject({ candidates: 0, evaluated: 0 })
    expect(onInsightsGenerated).not.toHaveBeenCalled()
  })

  it('re-evaluates a profile edited since its last evaluation', async () => {
    profileDocs = [{
      tenant_id: TENANT_A,
      ...makeCompleteProfile(),
      updated_at: daysAgo(1),
      insights_evaluated_at: daysAgo(5),
    }]
    const summary = await runStaleProfileEvaluationSweep(makeDb(), engine, onInsightsGenerated)

    expect(summary).toMatchObject({ candidates: 1, evaluated: 1 })
    expect(onInsightsGenerated).toHaveBeenCalledTimes(1)
  })

  it('skips (and stamps) a profile that fails schema validation, without evaluating it', async () => {
    profileDocs = [{ tenant_id: TENANT_A, household: 'not-an-object', updated_at: daysAgo(1) }]
    const summary = await runStaleProfileEvaluationSweep(makeDb(), engine, onInsightsGenerated)

    expect(summary).toMatchObject({ candidates: 1, evaluated: 0, skippedIncomplete: 1, failed: 0 })
    expect(onInsightsGenerated).not.toHaveBeenCalled()
    expect(profileDocs[0]!['insights_evaluated_at']).toBeInstanceOf(Date)
  })

  it('skips (and stamps) a schema-valid but substantively-incomplete profile — the abandoned-wizard case', async () => {
    profileDocs = [{ tenant_id: TENANT_A, ...makeAbandonedProfile(), updated_at: daysAgo(1) }]
    const summary = await runStaleProfileEvaluationSweep(makeDb(), engine, onInsightsGenerated)

    expect(summary).toMatchObject({ candidates: 1, evaluated: 0, skippedIncomplete: 1, failed: 0 })
    expect(onInsightsGenerated).not.toHaveBeenCalled()
    expect(profileDocs[0]!['insights_evaluated_at']).toBeInstanceOf(Date)
  })

  it('isolates a per-tenant failure — one tenant throwing does not stop the others', async () => {
    profileDocs = [
      { tenant_id: TENANT_A, ...makeCompleteProfile(), updated_at: daysAgo(1) },
      { tenant_id: TENANT_B, ...makeCompleteProfile(), updated_at: daysAgo(1) },
    ]
    const failing = vi.fn(async (_insights: Insight[], tenantId: string) => {
      if (tenantId === TENANT_A) throw new Error('delivery boom')
    })
    const summary = await runStaleProfileEvaluationSweep(makeDb(), engine, failing)

    expect(summary.candidates).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.evaluated).toBe(1)
    // The failing tenant's stamp is never written (its try block throws
    // before the updateOne) — only the successful one is.
    const stampedTenants = profileDocs.filter((d) => d['insights_evaluated_at'] !== undefined).map((d) => d['tenant_id'])
    expect(stampedTenants).toEqual([TENANT_B])
  })

  it('finds zero candidates on a second run with no changes in between', async () => {
    profileDocs = [{ tenant_id: TENANT_A, ...makeCompleteProfile(), updated_at: daysAgo(1) }]
    const db = makeDb()
    await runStaleProfileEvaluationSweep(db, engine, onInsightsGenerated)
    onInsightsGenerated.mockClear()

    const second = await runStaleProfileEvaluationSweep(db, engine, onInsightsGenerated)
    expect(second).toMatchObject({ candidates: 0, evaluated: 0 })
    expect(onInsightsGenerated).not.toHaveBeenCalled()
  })
})
