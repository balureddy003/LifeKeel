import { describe, expect, it } from 'vitest'
import {
  NEVER_AUTO_ACCEPT,
  SELECTIVE_RISK_PARAMS,
  classCountsFromEvents,
  selectiveRiskDecision,
  wilsonUpperBound,
} from '../selective-risk.js'

/** Owner-set parameters the tests exercise — the shipped defaults stay unset. */
const PARAMS = { alpha: 0.01, minSample: 300, confidence: 0.95, eligibleClasses: ['provider'] }

const decide = (over: Partial<Parameters<typeof selectiveRiskDecision>[0]> = {}) =>
  selectiveRiskDecision(
    {
      fieldClass: 'provider',
      counts: { confirmedUnchanged: 400, corrected: 0 },
      verifierSetReady: true,
      mechanicalChecksPassed: true,
      ...over,
    },
    PARAMS,
  )

describe('wilsonUpperBound', () => {
  it('is 0 errors → a small positive bound that shrinks with n', () => {
    const n300 = wilsonUpperBound(0, 300)
    const n3000 = wilsonUpperBound(0, 3000)
    expect(n300).toBeGreaterThan(0)
    expect(n300).toBeLessThan(0.02)
    expect(n3000).toBeLessThan(n300)
  })
  it('rises with the observed error rate', () => {
    expect(wilsonUpperBound(3, 300)).toBeGreaterThan(wilsonUpperBound(0, 300))
  })
})

describe('selectiveRiskDecision', () => {
  it('review-by-default: shipped params are unset so everything is review', () => {
    expect(
      selectiveRiskDecision({
        fieldClass: 'provider',
        counts: { confirmedUnchanged: 10_000, corrected: 0 },
        verifierSetReady: true,
        mechanicalChecksPassed: true,
      }),
    ).toBe('review')
    expect(SELECTIVE_RISK_PARAMS.alpha).toBeNull()
    expect(SELECTIVE_RISK_PARAMS.minSample).toBeNull()
  })

  it('accepts a clean eligible class with enough verified samples', () => {
    // Wilson upper bound for 0/400 at 95% ≈ 0.95% < alpha 1%.
    expect(decide()).toBe('accept')
  })

  it('an unknown class is always review', () => {
    expect(decide({ fieldClass: 'some_new_field' })).toBe('review')
  })

  it('money-in and money-out classes are permanently review', () => {
    for (const c of [
      'statement_money_in',
      'statement_money_out',
      'net_pay',
      'gross_pay',
      'coverage_amount',
      'premium',
      'balance',
    ]) {
      expect(NEVER_AUTO_ACCEPT.has(c)).toBe(true)
      expect(decide({ fieldClass: c })).toBe('review')
    }
  })

  it('below the minimum sample is review even when the bound would pass', () => {
    // alpha raised so only the sample gate can block: 200 < minSample 300.
    const p = { ...PARAMS, alpha: 0.05 }
    expect(
      selectiveRiskDecision(
        {
          fieldClass: 'provider',
          counts: { confirmedUnchanged: 200, corrected: 0 },
          verifierSetReady: true,
          mechanicalChecksPassed: true,
        },
        p,
      ),
    ).toBe('review')
  })

  it('without a verifier set or passed mechanical checks is review', () => {
    expect(decide({ verifierSetReady: false })).toBe('review')
    expect(decide({ mechanicalChecksPassed: false })).toBe('review')
  })

  it('mutation: raising alpha or lowering minSample flips the boundary tests', () => {
    // 3 corrections in 303 → upper bound ≈ 2.2% — review at alpha 1%, accept at alpha 5%.
    const counts = { confirmedUnchanged: 300, corrected: 3 }
    const input = {
      fieldClass: 'provider',
      counts,
      verifierSetReady: true,
      mechanicalChecksPassed: true,
    }
    expect(selectiveRiskDecision(input, PARAMS)).toBe('review')
    expect(selectiveRiskDecision(input, { ...PARAMS, alpha: 0.05 })).toBe('accept')
    // Same clean counts: minSample 500 blocks, lowering it to 400 accepts.
    expect(decide({ counts: { confirmedUnchanged: 400, corrected: 0 } })).toBe('accept')
    expect(
      selectiveRiskDecision(
        {
          fieldClass: 'provider',
          counts: { confirmedUnchanged: 400, corrected: 0 },
          verifierSetReady: true,
          mechanicalChecksPassed: true,
        },
        { ...PARAMS, minSample: 500 },
      ),
    ).toBe('review')
  })

  it('a single recent correction can flip a class back to review', () => {
    // 0/400 bound ≈ 0.95% — just under alpha. One correction in 401 pushes it over.
    expect(decide()).toBe('accept')
    expect(decide({ counts: { confirmedUnchanged: 400, corrected: 1 } })).toBe('review')
  })

  it('more confirmed-unchanged data never makes a class less safe', () => {
    expect(decide({ counts: { confirmedUnchanged: 5000, corrected: 0 } })).toBe('accept')
    // Adding corrections can flip it — that is the point of the bound.
    expect(decide({ counts: { confirmedUnchanged: 5000, corrected: 60 } })).toBe('review')
  })

  it('the bound is monotone in sample size at a fixed error rate', () => {
    // 1% observed error rate: bound shrinks as n grows.
    const small = wilsonUpperBound(1, 100)
    const large = wilsonUpperBound(10, 1000)
    expect(large).toBeLessThan(small)
  })
})

describe('classCountsFromEvents', () => {
  it('aggregates confirmed-unchanged and corrected events per field class', () => {
    const counts = classCountsFromEvents([
      { event: 'extraction_confirmed_unchanged', field_class: 'provider' },
      { event: 'extraction_confirmed_unchanged', field_class: 'provider' },
      { event: 'extraction_corrected', field_class: 'provider' },
      { event: 'extraction_confirmed_unchanged', field_class: 'premium' },
      { event: 'extraction_suggested', field_class: 'provider' }, // not a verdict
      { event: 'extraction_corrected', field_class: 'none' }, // no class → ignored
    ])
    expect(counts.get('provider')).toEqual({ confirmedUnchanged: 2, corrected: 1 })
    expect(counts.get('premium')).toEqual({ confirmedUnchanged: 1, corrected: 0 })
    expect(counts.size).toBe(2)
  })
})
