import { describe, expect, it } from 'vitest'
import type { BriefCatalogueEntry } from '@/lib/api'
import { buildInputs, inputsToForm, needs, validate } from '../brief-form'

const entry = (over: Partial<BriefCatalogueEntry>): BriefCatalogueEntry => ({
  id: 'earning_less',
  title: 'Someone is about to earn less',
  group: 'Money and income',
  mode: 'income',
  trigger: 'Pay change date',
  ...over,
})

const medical = entry({
  id: 'medical_contacts',
  mode: 'handover',
  sensitive: true,
  fields: ['GP and contact details'],
})

describe('buildInputs', () => {
  it('sends sensitive_consent for a sensitive handover once the box is ticked', () => {
    const inputs = buildInputs(medical, {
      change_date: '2026-11-01',
      'fact:GP and contact details': 'Dr A',
      consent: 'yes',
    })
    expect(inputs.sensitive_consent).toBe(true)
    expect(inputs.facts).toEqual({ 'GP and contact details': 'Dr A' })
  })

  it('never sends consent for a handover that is not sensitive, or when unticked', () => {
    const plain = entry({ id: 'joint_bill', mode: 'handover', fields: ['Bill or account'] })
    expect(
      buildInputs(plain, { change_date: '2026-11-01', consent: 'yes' }).sensitive_consent,
    ).toBeUndefined()
    expect(buildInputs(medical, { change_date: '2026-11-01' }).sensitive_consent).toBeUndefined()
  })

  it('converts pounds to pence and drops empty optional fields', () => {
    const i = buildInputs(entry({}), {
      income: '5000',
      essentials: '3000.50',
      savings: '9000',
      new_income: '2000',
      change_date: '2026-11-28',
    })
    expect(i.monthly_essentials_minor).toBe(300050)
    expect(i.new_income_minor).toBe(200000)
    expect(i.cash_out_minor).toBeUndefined()
  })
})

describe('validate', () => {
  const ok = {
    income: '5000',
    essentials: '3000',
    savings: '9000',
    new_income: '2000',
    change_date: '2026-11-28',
  }

  it('accepts a complete brief', () => {
    expect(validate(entry({}), ok)).toEqual({})
  })

  it('names each missing field', () => {
    const errors = validate(entry({}), {})
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(['change_date', 'income', 'essentials', 'savings', 'new_income']),
    )
  })

  it('treats zero savings and zero income as valid but zero spending as not', () => {
    expect(validate(entry({}), { ...ok, savings: '0', income: '0' })).toEqual({})
    expect(validate(entry({}), { ...ok, essentials: '0' })['essentials']).toMatch(/more than zero/)
  })

  it('rejects negatives', () => {
    expect(validate(entry({}), { ...ok, savings: '-1' })['savings']).toMatch(/zero or more/)
  })

  it('needs a one-off amount for cash entries', () => {
    const cash = entry({ id: 'windfall', mode: 'cash' })
    expect(validate(cash, { ...ok, new_essentials: '3000' })['cash_out']).toBeTruthy()
    expect(
      validate(cash, { ...ok, new_essentials: '3000', cash_in: '20000' })['cash_out'],
    ).toBeUndefined()
  })

  it('requires consent for sensitive handovers and at least one detail', () => {
    const errors = validate(medical, { change_date: '2026-11-01' })
    expect(errors['facts']).toBeTruthy()
    expect(errors['consent']).toBeTruthy()
    expect(
      validate(medical, {
        change_date: '2026-11-01',
        'fact:GP and contact details': 'Dr A',
        consent: 'yes',
      }),
    ).toEqual({})
  })

  it('wants income and spending when a later change date is given', () => {
    expect(validate(entry({}), { ...ok, return_date: '2027-06-01' })['return_date']).toBeTruthy()
  })
})

describe('needs', () => {
  it('matches the API rules for which after-change fields are required', () => {
    expect(needs(entry({ mode: 'income' }))).toMatchObject({
      newIncome: true,
      newEssentials: false,
    })
    expect(needs(entry({ mode: 'cost' }))).toMatchObject({ newIncome: false, newEssentials: true })
    expect(needs(entry({ mode: 'mixed' }))).toMatchObject({ newIncome: true, newEssentials: true })
    expect(needs(entry({ mode: 'stop' })).cover).toBe(true)
  })
})

describe('inputsToForm', () => {
  it('round-trips a money brief so an update starts from last time', () => {
    const e = entry({ id: 'pregnancy', mode: 'mixed' })
    const form = {
      income: '5000',
      essentials: '3000.5',
      savings: '9000',
      new_income: '4500',
      new_essentials: '3000',
      change_date: '2026-11-28',
      return_date: '2027-10-01',
      return_income: '5000',
      return_essentials: '3200',
      decision_deadline: '2026-12-01',
      steps_n: '2',
      'step_date:0': '2027-01-28',
      'step_income:0': '1500',
      'step_date:1': '2027-12-28',
      'step_income:1': '800',
      'step_cash:1': '250',
    }
    const inputs = buildInputs(e, form)
    expect(buildInputs(e, inputsToForm(e, inputs))).toEqual(inputs)
  })

  it('shows pence as pounds and skips empty values', () => {
    const f = inputsToForm(entry({}), {
      monthly_income_minor: 500000,
      monthly_essentials_minor: 300050,
      change_date: '2026-11-28',
    })
    expect(f['essentials']).toBe('3000.5')
    expect(f['savings']).toBeUndefined()
  })

  it('never pre-fills handover facts', () => {
    expect(
      inputsToForm(medical, {
        change_date: '2026-11-01',
        facts: { 'GP and contact details': 'Dr A' },
      }),
    ).toEqual({})
  })
})
