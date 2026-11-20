/**
 * Does the yearly premium match twelve monthly ones? Arithmetic only: it never says what to do about a gap,
 * and a missing figure is never a warning.
 */
import { describe, expect, it } from 'vitest'
import { premiumCheck } from '../premium-check.js'

describe('premiumCheck', () => {
  it('matches when twelve months equal the year', () => {
    expect(premiumCheck(4200, 50400)).toEqual({ status: 'match' })
  })

  it('states the gap when the year is lower than twelve months, in plain words', () => {
    const r = premiumCheck(4200, 50000)
    expect(r.status).toBe('mismatch')
    if (r.status !== 'mismatch') return
    expect(r.yearlyFromMonthlyMinor).toBe(50400)
    expect(r.differenceMinor).toBe(-400)
    expect(r.text).toBe(
      '£42 a month adds up to £504 a year. You entered £500 a year, £4 less. ' +
        'Some insurers charge less when you pay yearly, so check both figures against your policy document.',
    )
  })

  it('states the gap when the year is higher than twelve months', () => {
    const r = premiumCheck(4200, 51000)
    expect(r.status).toBe('mismatch')
    if (r.status !== 'mismatch') return
    expect(r.differenceMinor).toBe(600)
    expect(r.text).toMatch(/£6 more/)
    expect(r.text).toMatch(/Check both figures against your policy document\./)
    expect(r.text).not.toMatch(/charge less/)
  })

  it('treats a gap of £1 or less as rounding, not a mismatch', () => {
    expect(premiumCheck(4200, 50500).status).toBe('match') // £1 over
    expect(premiumCheck(4200, 50300).status).toBe('match') // £1 under
    expect(premiumCheck(4200, 50299).status).toBe('mismatch') // just over £1 under
  })

  it('says nothing when either figure is missing or zero', () => {
    expect(premiumCheck(undefined, 50000)).toEqual({ status: 'not_enough' })
    expect(premiumCheck(4200, undefined)).toEqual({ status: 'not_enough' })
    expect(premiumCheck(0, 50000)).toEqual({ status: 'not_enough' })
    expect(premiumCheck(4200, 0)).toEqual({ status: 'not_enough' })
  })

  it('never gives advice or names a product', () => {
    const r = premiumCheck(4200, 50000)
    if (r.status !== 'mismatch') throw new Error('expected a mismatch')
    expect(r.text).not.toMatch(/\b(buy|switch|should|best|cheaper provider)\b/i)
  })
})
