/**
 * PRD-137 §4 — the estate readiness component on the legacy register:
 * pro-rata checks, inapplicable populations dropped with weights
 * renormalised, and the mandatory "not legal validity" caption. With no
 * legacy records the original vault-boolean behaviour holds.
 */
import { describe, expect, it } from 'vitest'
import { computeReadiness } from '../score.js'
import type { EstateSignalData } from '../../legacy/estate-signal.js'
import type { FinancialProfile } from '../../routes/family-financial-profile.js'

const CAPTION = "Completeness and freshness of what's recorded — not legal validity."

const PROFILE: FinancialProfile = {
  household: {
    employment_status: 'employed',
    monthly_salary_minor: 400_000,
    annual_living_expenses_minor: 3_000_000,
    mortgage_outstanding_minor: 0,
    life_cover_minor: 0,
    income_protection_monthly_minor: 0,
    monthly_debt_payments_minor: 0,
    members: [],
  },
  emergency_fund: {
    emergency_savings_minor: 1_500_000,
    monthly_expenses_minor: 250_000,
    has_high_interest_debt: false,
    high_interest_debt_balance_minor: 0,
  },
  retirement: {
    current_age: 40,
    target_retirement_age: 65,
    pension_balance_minor: 10_000_000,
    monthly_contribution_minor: 50_000,
    target_retirement_income_minor: 2_000_000,
    expected_annual_growth_pct: 5,
  },
  education_funds: [],
  policies: [],
}

function signal(overrides: Partial<EstateSignalData>): EstateSignalData {
  return {
    has_will: 1,
    has_power_of_attorney: 1,
    estate_doc_count: 2,
    adults_total: 0,
    adults_with_will: 0,
    adults_with_poa: 0,
    adults_with_directive: 0,
    wills_stale: 0,
    wills_with_dead_or_missing_executor: 0,
    minors_total: 0,
    minors_with_guardian_nomination: 0,
    properties_total: 0,
    properties_without_title_evidence: 0,
    properties_ownership_unknown: 0,
    properties_foreign_without_contact: 0,
    properties_disputed: 0,
    properties_uninsured_or_unknown: 0,
    documents_without_original_location: 0,
    assets_unreferenced_by_any_will: 0,
    beneficiary_conflicts: 0,
    businesses_without_successor: 0,
    has_legacy_records: 1,
    wills_total: 0,
    original_location_total: 0,
    ...overrides,
  }
}

const estateOf = (result: ReturnType<typeof computeReadiness>) =>
  result.components.find((c) => c.key === 'estate')!

describe('estate component — legacy register scoring', () => {
  it('scores pro-rata per adult and produces a driver per check', () => {
    // 1 of 2 adults has a will → 25 * 0.5 = 12.5; same for PoA.
    // One will, executor resolvable, reviewed recently, location known.
    const legacy = signal({
      adults_total: 2,
      adults_with_will: 1,
      adults_with_poa: 1,
      wills_total: 1,
      wills_stale: 0,
      wills_with_dead_or_missing_executor: 0,
      original_location_total: 1,
      documents_without_original_location: 0,
    })
    const estate = estateOf(computeReadiness(PROFILE, ['will', 'power_of_attorney'], legacy))
    // Applicable: will 25*0.5 + poa 20*0.5 + executor 10 + location 10 + reviewed 5 = 47.5 / 70 → 68
    expect(estate.score).toBe(68)
    expect(estate.caption).toBe(CAPTION)
    expect(estate.drivers).toEqual([
      { label: 'Wills recorded', value: '1 of 2 adults' },
      { label: 'Powers of attorney recorded', value: '1 of 2 adults' },
      { label: 'Executors resolvable', value: '1 of 1 wills' },
      { label: 'Original location known', value: '1 of 1 documents' },
      { label: 'Reviewed within 3 years', value: '1 of 1 wills' },
    ])
  })

  it('drops checks with no applicable population and renormalises', () => {
    // No minors → guardianship dropped; no properties → title check
    // dropped; no location-eligible docs → location dropped.
    const legacy = signal({
      adults_total: 2,
      adults_with_will: 2,
      adults_with_poa: 2,
      wills_total: 1,
    })
    const estate = estateOf(computeReadiness(PROFILE, ['will', 'power_of_attorney'], legacy))
    // Applicable: will 25 + poa 20 + executor 10 + reviewed 5 = 60/60 → 100
    expect(estate.score).toBe(100)
    expect(estate.drivers?.map((d) => d.label)).not.toContain('Guardian nominations')
    expect(estate.drivers?.map((d) => d.label)).not.toContain('Property title evidence')
    expect(estate.caption).toBe(CAPTION)
  })

  it('counts gaps when records are incomplete', () => {
    const legacy = signal({
      adults_total: 2,
      adults_with_will: 1,
      adults_with_poa: 0,
      minors_total: 1,
      minors_with_guardian_nomination: 0,
      wills_total: 1,
      wills_stale: 1,
      wills_with_dead_or_missing_executor: 1,
      properties_total: 1,
      properties_without_title_evidence: 1,
      original_location_total: 1,
      documents_without_original_location: 1,
    })
    const estate = estateOf(computeReadiness(PROFILE, ['will', 'power_of_attorney'], legacy))
    // will 25*0.5=12.5, poa 0, guardian 0, executor 0, title 0, location 0, reviewed 0
    // → 12.5 / 100 → 13 (rounds)
    expect(estate.score).toBe(13)
    expect(estate.detail).toContain('legacy checks need attention')
  })
})

describe('estate component — vault-boolean fallback', () => {
  it('scores on vault doc types when there are no legacy records', () => {
    const estate = estateOf(
      computeReadiness(PROFILE, ['will'], signal({ has_legacy_records: 0 })),
    )
    expect(estate.score).toBe(50)
    expect(estate.detail).toBe('Missing from the vault: power of attorney.')
    expect(estate.caption).toBe(CAPTION)
    expect(estate.drivers).toBeUndefined()
  })

  it('treats a null signal as no legacy records', () => {
    const estate = estateOf(computeReadiness(PROFILE, ['will', 'power_of_attorney'], null))
    expect(estate.score).toBe(100)
    expect(estate.caption).toBe(CAPTION)
  })

  it('stays gated and uncaptioned for non-adult viewers', () => {
    const estate = estateOf(computeReadiness(PROFILE, null))
    expect(estate.score).toBeNull()
    expect(estate.gated).toBe(true)
    expect(estate.caption).toBeUndefined()
  })
})
