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
import { BRIEF_CATALOGUE, solveCatalogueBrief } from '../catalogue.js'

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

describe('absurd horizons and zero savings', () => {
  it('does not print a date 40,000 years away for a 1p-a-month shortfall', () => {
    const out = solveCatalogueBrief(
      'earning_less',
      {
        monthly_income_minor: 300_000,
        monthly_essentials_minor: 300_000,
        liquid_savings_minor: 500_000,
        new_income_minor: 299_999,
        change_date: '2026-11-02',
      },
      AS_OF,
    )
    expect(out.template_sentence).toContain('savings last more than 50 years')
    expect(out.template_sentence).not.toContain('run out')
    expect(out.template_sentence).not.toMatch(/\d{5}/)
  })

  it('says plainly when there are no savings', () => {
    const out = solveCatalogueBrief(
      'earning_less',
      {
        monthly_income_minor: 0,
        monthly_essentials_minor: 200_000,
        liquid_savings_minor: 0,
        new_income_minor: 0,
        change_date: '2026-11-28',
      },
      AS_OF,
    )
    expect(out.template_sentence).toContain('there are no savings to draw on')
  })
})

describe('the secret guard rail is about secrets, not ordinary words', () => {
  const run = (value: string) => () =>
    solveCatalogueBrief(
      'joint_bill',
      { change_date: '2026-11-28', facts: { 'Bill or account': value } },
      AS_OF,
    )

  it.each([
    'bus pass renewal',
    'my passport is in the drawer',
    'the password manager is 1Password on the shared iPad',
    'password is in the kitchen drawer',
    'tapping a pin on the map',
    'Dr Test 01234 567890',
    'token gesture to the neighbours',
    'recovery codes are printed and in the safe',
  ])('allows %s', (value) => {
    expect(run(value)).not.toThrow()
  })

  it.each([
    'password: Summer2024!',
    'passcode is 482913',
    'pin 4821',
    'PIN is 123456',
    'card 4111 1111 1111 1111',
    'aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY',
  ])('rejects %s', (value) => {
    expect(run(value)).toThrow(/looks like it contains a password or code/)
  })

  it('says whole pence when an amount has a fraction', () => {
    expect(() =>
      solveCatalogueBrief(
        'earning_less',
        {
          monthly_income_minor: 500_000.5,
          monthly_essentials_minor: 300_000,
          liquid_savings_minor: 0,
          new_income_minor: 0,
          change_date: '2026-11-28',
        },
        AS_OF,
      ),
    ).toThrow('Take-home income needs to be a whole number of pence')
  })
})

describe('first number from the minimum (PRD-230)', () => {
  const minimum = { ...base, change_date: '2026-12-01' }
  const moneyTypes = BRIEF_CATALOGUE.filter((e) => e.mode !== 'handover')

  it.each(moneyTypes.map((e) => [e.id]))('%s solves from three money fields and a date', (id) => {
    const out = solveCatalogueBrief(id!, minimum, AS_OF)
    expect(out.template_sentence.length).toBeGreaterThan(10)
  })

  it('says what was assumed and names what to add', () => {
    const out = solveCatalogueBrief('job_change', minimum, AS_OF)
    expect(out.facts).toContainEqual({
      label: 'Assumed: income after the change',
      value: 'Not entered, shown the same as today',
    })
    expect(out.template_sentence).toContain('partial answer')
  })

  it('does not assume zero income for a stop: baseline until entered', () => {
    const out = solveCatalogueBrief('income_stops', minimum, AS_OF)
    expect(out.template_sentence).not.toMatch(/run out/)
    expect(out.template_sentence).toContain('partial answer')
  })

  it('a cash brief without the one-off amount shows the baseline', () => {
    const out = solveCatalogueBrief('windfall', minimum, AS_OF)
    expect(out.facts.some((f) => f.label === 'Assumed: one-off amount')).toBe(true)
  })

  it('explicit values win and no partial-answer note appears', () => {
    const out = solveCatalogueBrief(
      'earning_less',
      { ...minimum, new_income_minor: 200_000 },
      AS_OF,
    )
    expect(out.facts.some((f) => f.label.startsWith('Assumed'))).toBe(false)
    expect(out.template_sentence).not.toContain('partial answer')
  })
})
