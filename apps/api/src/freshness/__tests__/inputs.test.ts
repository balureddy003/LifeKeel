/**
 * PRD-145: every family detector declares its inputs, and freshness is
 * computed deterministically from names and dates, never values.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FinancialProfileSchema,
  type FinancialProfile,
} from '../../routes/family-financial-profile.js'
import { DETECTOR_INPUTS, evaluateFreshness, freshnessShare } from '../inputs.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const DETECTORS_DIR = path.resolve(here, '../../../../../detectors/family')
const NOW = new Date('2026-10-20T06:45:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

function profile(over: Record<string, unknown> = {}): FinancialProfile {
  return FinancialProfileSchema.parse({
    household: {
      employment_status: 'employed',
      monthly_salary_minor: 400000,
      annual_living_expenses_minor: 250000,
      mortgage_outstanding_minor: 0,
      life_cover_minor: 0,
      income_protection_monthly_minor: 0,
    },
    emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 300000 },
    retirement: {
      current_age: 40,
      target_retirement_age: 65,
      pension_balance_minor: 0,
      monthly_contribution_minor: 0,
      target_retirement_income_minor: 3_000_000,
    },
    education_funds: [],
    policies: [],
    ...over,
  })
}

const stateOf = (rows: ReturnType<typeof evaluateFreshness>, id: string) =>
  rows.find((r) => r.detector_id === id)!

describe('detector input registry', () => {
  it('has an entry for every detector in detectors/family and no extras', () => {
    const ids = fs
      .readdirSync(DETECTORS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => /^id:\s*(\S+)/m.exec(fs.readFileSync(path.join(DETECTORS_DIR, f), 'utf8'))![1]!)
      .sort()
    expect(DETECTOR_INPUTS.map((d) => d.detector_id).sort()).toEqual(ids)
  })

  it('every declared input path names a real profile section', () => {
    const sections = new Set(Object.keys(FinancialProfileSchema.shape))
    for (const d of DETECTOR_INPUTS)
      for (const r of d.required) expect(sections.has(r.field.split('.')[0]!)).toBe(true)
  })
})

describe('evaluateFreshness', () => {
  it('a current, complete profile runs every applicable check and skips the rest', () => {
    const rows = evaluateFreshness(profile(), daysAgo(10), NOW)
    expect(stateOf(rows, 'family_protection_gap').state).toBe('running')
    expect(stateOf(rows, 'family_education_shortfall').state).toBe('not_applicable')
    expect(stateOf(rows, 'family_policy_review').state).toBe('not_applicable')
    expect(freshnessShare(rows)).toBe(1)
  })

  it('a missing input pauses the check and names the field, not its value', () => {
    const p = profile({
      emergency_fund: { emergency_savings_minor: 900000, monthly_expenses_minor: 0 },
    })
    const r = stateOf(evaluateFreshness(p, daysAgo(10), NOW), 'family_emergency_fund_adequacy')
    expect(r.state).toBe('paused_missing')
    expect(r.input).toEqual(['emergency_fund.monthly_expenses_minor'])
    expect(JSON.stringify(r)).not.toMatch(/\d{5,}/)
  })

  it('uses a shorter age limit for savings checks than for cover checks', () => {
    const rows = evaluateFreshness(profile(), daysAgo(200), NOW)
    expect(stateOf(rows, 'family_emergency_fund_adequacy').state).toBe('paused_stale')
    expect(stateOf(rows, 'family_protection_gap').state).toBe('running')
    expect(stateOf(rows, 'family_protection_gap').input).toEqual([])
    const old = evaluateFreshness(profile(), daysAgo(400), NOW)
    expect(stateOf(old, 'family_protection_gap').state).toBe('paused_stale')
  })

  it('a renewal date already in the past pauses the policy check, even on a fresh profile', () => {
    const p = profile({
      policies: [{ type: 'life', provider: 'x', renewal_date: '2026-09-01' }],
    })
    const r = stateOf(evaluateFreshness(p, daysAgo(1), NOW), 'family_policy_review')
    expect(r.state).toBe('paused_stale')
    expect(r.input).toEqual(['policies.renewal_date'])
    const future = profile({
      policies: [{ type: 'life', provider: 'x', renewal_date: '2027-01-01' }],
    })
    expect(stateOf(evaluateFreshness(future, daysAgo(1), NOW), 'family_policy_review').state).toBe(
      'running',
    )
  })

  it('no profile pauses everything except the vault-based estate check', () => {
    const rows = evaluateFreshness(null, null, NOW)
    expect(stateOf(rows, 'family_estate_readiness').state).toBe('running')
    expect(stateOf(rows, 'family_protection_gap').state).toBe('paused_missing')
    expect(freshnessShare(rows)).toBeCloseTo(1 / 9)
  })

  it('share is null when nothing applies', () => {
    expect(freshnessShare([{ state: 'not_applicable' }])).toBeNull()
  })
})
