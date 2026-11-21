/** Which of a brief's figures are worth offering to save onto the family list. */
import { describe, expect, it } from 'vitest'
import { pendingFigures, saveBody } from '../brief-figures'

const profile = (savings?: number, spend?: number, income?: number) =>
  ({
    emergency_fund: { emergency_savings_minor: savings, monthly_expenses_minor: spend },
    household: { monthly_salary_minor: income },
  }) as never

const inputs = {
  monthly_income_minor: 420000,
  monthly_essentials_minor: 360000,
  liquid_savings_minor: 900000,
}

describe('pendingFigures', () => {
  it('offers every figure when nothing is on file, with plain labels', () => {
    const rows = pendingFigures(inputs, null)
    expect(rows.map((r) => [r.key, r.label, r.minor, r.current])).toEqual([
      ['savings_minor', 'Savings', 900000, null],
      ['monthly_spend_minor', 'Monthly spending', 360000, null],
      ['monthly_inflow_minor', 'Monthly income', 420000, null],
    ])
  })

  it('offers only the figures that differ, and says what is on file now', () => {
    const rows = pendingFigures(inputs, profile(900000, 200000, 420000))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'monthly_spend_minor', minor: 360000, current: 200000 })
  })

  it('offers nothing when the list already holds the same figures', () => {
    expect(pendingFigures(inputs, profile(900000, 360000, 420000))).toEqual([])
  })

  it('keeps zero savings and income protection (real answers) but skips zero spending or income', () => {
    const rows = pendingFigures(
      {
        liquid_savings_minor: 0,
        income_protection_monthly_minor: 0,
        monthly_income_minor: 0,
        monthly_essentials_minor: 0,
      },
      null,
    )
    expect(rows.map((r) => r.key)).toEqual(['savings_minor', 'income_protection_monthly_minor'])
  })

  it('ignores missing, negative, fractional and non-number values, never NaN', () => {
    expect(
      pendingFigures(
        {
          liquid_savings_minor: Number.NaN,
          monthly_income_minor: -5,
          monthly_essentials_minor: 12.5,
          income_protection_monthly_minor: 'x' as never,
        },
        null,
      ),
    ).toEqual([])
    expect(pendingFigures({}, null)).toEqual([])
    expect(pendingFigures(undefined, null)).toEqual([])
  })
})

describe('saveBody', () => {
  it('turns the offered rows into the request body', () => {
    expect(saveBody(pendingFigures(inputs, null))).toEqual({
      savings_minor: 900000,
      monthly_spend_minor: 360000,
      monthly_inflow_minor: 420000,
    })
  })
})
