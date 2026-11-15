/**
 * Bank statement as the first document (owner decision 2026-11-15, intent 93 A8). A statement only yields
 * suggestions when its own figures reconcile and it covers about one month; the person still confirms them.
 */
import { describe, expect, it } from 'vitest'
import { CATEGORIES, FIELD_KEYS } from '../../extraction/schema.js'
import { mapExtractedFieldsToProfileSuggestions } from '../profile-mapping.js'

const good = {
  statement_opening_balance: '£2,000.00',
  statement_money_in: '£3,000.00',
  statement_money_out: '£2,500.00',
  statement_closing_balance: '£2,500.00',
  statement_period_start: '1 October 2026',
  statement_period_end: '31 October 2026',
}

describe('banking category', () => {
  it('is a known category with the six statement fields', () => {
    expect(CATEGORIES).toContain('banking')
    for (const k of Object.keys(good)) expect(FIELD_KEYS).toContain(k)
  })
})

describe('statement suggestions', () => {
  it('suggests monthly spend and income, with labels that say what they are', () => {
    const s = mapExtractedFieldsToProfileSuggestions('banking', good)
    expect(s.map((x) => [x.path, x.valueMinor, x.sourceField])).toEqual([
      ['emergency_fund.monthly_expenses_minor', 250000, 'statement_money_out'],
      ['household.monthly_salary_minor', 300000, 'statement_money_in'],
    ])
    expect(s[1]!.label).toMatch(/check it is your income/i)
  })

  it('accepts ISO and day/month/year dates', () => {
    const iso = {
      ...good,
      statement_period_start: '2026-10-01',
      statement_period_end: '2026-10-31',
    }
    const dmy = {
      ...good,
      statement_period_start: '01/10/2026',
      statement_period_end: '31/10/2026',
    }
    expect(mapExtractedFieldsToProfileSuggestions('banking', iso)).toHaveLength(2)
    expect(mapExtractedFieldsToProfileSuggestions('banking', dmy)).toHaveLength(2)
  })

  it('gives nothing when the balance does not reconcile', () => {
    expect(
      mapExtractedFieldsToProfileSuggestions('banking', {
        ...good,
        statement_closing_balance: '£2,600.00',
      }),
    ).toEqual([])
  })

  it('gives nothing when the period is not about one month', () => {
    const quarter = {
      ...good,
      statement_period_start: '1 August 2026',
      statement_period_end: '31 October 2026',
    }
    expect(mapExtractedFieldsToProfileSuggestions('banking', quarter)).toEqual([])
  })

  it('gives nothing when a date cannot be read or a figure is missing', () => {
    expect(
      mapExtractedFieldsToProfileSuggestions('banking', {
        ...good,
        statement_period_end: 'end of month',
      }),
    ).toEqual([])
    const { statement_money_in: _drop, ...noIn } = good
    expect(mapExtractedFieldsToProfileSuggestions('banking', noIn)).toEqual([])
  })

  it('does not touch other categories', () => {
    expect(mapExtractedFieldsToProfileSuggestions('income', good)).toEqual([])
  })
})
