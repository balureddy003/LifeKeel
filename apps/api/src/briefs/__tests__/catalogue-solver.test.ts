/**
 * Brief wording and error messages. Pure function tests: no database, no model.
 *
 * Regression targets from the end-to-end run on 2026-10-29:
 *  - savings that keep draining after the last entered change must still be
 *    reported ("savings run out around …"), not only draining between steps;
 *  - a windfall must say what savings become, not only "income covers spending";
 *  - input errors name the field instead of one generic line.
 */
import { describe, expect, it } from 'vitest'
import { solveCatalogueBrief } from '../catalogue.js'

const AS_OF = '2026-10-29'
const base = {
  monthly_income_minor: 500_000,
  monthly_essentials_minor: 300_000,
  liquid_savings_minor: 900_000,
}

describe('savings running out', () => {
  it('reports when savings run out after the last entered change', () => {
    const out = solveCatalogueBrief(
      'earning_less',
      { ...base, new_income_minor: 200_000, change_date: '2026-11-28' },
      AS_OF,
    )
    expect(out.template_sentence).toMatch(/savings would run out around \w+ 20\d\d/)
    expect(out.template_sentence).toContain('about month 12.0')
  })

  it('says nothing about running out when income covers spending', () => {
    const out = solveCatalogueBrief(
      'earning_less',
      { ...base, new_income_minor: 400_000, change_date: '2026-11-28' },
      AS_OF,
    )
    expect(out.template_sentence).not.toContain('run out')
  })

  it('still reports the earlier date when a middle stage drains the fund first', () => {
    const out = solveCatalogueBrief(
      'pregnancy',
      {
        ...base,
        new_income_minor: 450_000,
        new_essentials_minor: 300_000,
        change_date: '2026-11-28',
        income_steps: [
          { date: '2027-12-28', monthly_income_minor: 80_000 },
          { date: '2027-01-28', monthly_income_minor: 150_000 },
        ],
      },
      AS_OF,
    )
    const m = out.template_sentence.match(/about month ([\d.]+)/)
    expect(m).not.toBeNull()
    // The last stage starts about 14 months out; the fund is gone before it.
    expect(Number(m![1])).toBeLessThan(14)
  })
})

describe('windfall wording', () => {
  it('states what savings become after the one-off amount', () => {
    const out = solveCatalogueBrief(
      'windfall',
      {
        ...base,
        new_income_minor: 500_000,
        new_essentials_minor: 300_000,
        cash_in_minor: 2_000_000,
        change_date: '2026-11-08',
      },
      AS_OF,
    )
    expect(out.template_sentence).toMatch(
      /Just after the one-off amount, savings are about £2\d,\d{3}\.\d\d \(£9,000\.00 today\)/,
    )
  })

  it('does not claim savings when the payment exceeds them', () => {
    const out = solveCatalogueBrief(
      'debt_payoff',
      {
        ...base,
        new_essentials_minor: 300_000,
        cash_out_minor: 5_000_000,
        change_date: '2026-11-08',
      },
      AS_OF,
    )
    expect(out.template_sentence).not.toContain('Just after the one-off amount')
    expect(out.template_sentence).toContain('exceed available savings')
  })
})

describe('input errors name the field', () => {
  const run =
    (inputs: Record<string, unknown>, problem = 'earning_less') =>
    () =>
      solveCatalogueBrief(problem, inputs, AS_OF)
  const ok = { ...base, new_income_minor: 100_000, change_date: '2026-11-28' }

  it('negative amount', () => {
    expect(run({ ...ok, monthly_income_minor: -5 })).toThrow(
      'Take-home income must be zero or more',
    )
  })
  it('bad date', () => {
    expect(run({ ...ok, change_date: '2026-13-45' })).toThrow(
      'The change date needs to be a real date',
    )
  })
  it('unknown field', () => {
    expect(run({ ...ok, bogus: 1 })).toThrow(/Unexpected detail/)
  })
  it('too many later changes', () => {
    const steps = Array.from({ length: 7 }, (_, i) => ({
      date: `2027-0${i + 1}-01`,
      monthly_income_minor: 1000,
    }))
    expect(run({ ...ok, income_steps: steps })).toThrow('You can add up to 6 later changes')
  })
  it('missing change date', () => {
    const { change_date: _omit, ...rest } = ok
    expect(run(rest)).toThrow('Enter the date of the change')
  })
  it('sensitive consent given as false', () => {
    expect(
      run(
        {
          change_date: '2026-11-01',
          sensitive_consent: false,
          facts: { 'GP and contact details': 'Dr A' },
        },
        'medical_contacts',
      ),
    ).toThrow('Permission to record and share these details is required')
  })
})
