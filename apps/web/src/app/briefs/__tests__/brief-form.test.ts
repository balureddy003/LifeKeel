import { describe, expect, it } from 'vitest'
import type { BriefCatalogueEntry } from '@/lib/api'
import {
  buildInputs,
  dateChips,
  inputsToForm,
  needs,
  previewForm,
  remainingFields,
  validate,
  validateStep,
} from '../brief-form'

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

describe('two-step form', () => {
  const e = entry({})
  it('step one asks for three money fields and the date, nothing else (PRD-230)', () => {
    const errors = validateStep(e, {}, 1)
    expect(Object.keys(errors).sort()).toEqual(['change_date', 'essentials', 'income', 'savings'])
  })
  it('step one passes once today and the date are filled, with the change still empty', () => {
    const first = { income: '5000', essentials: '3000', savings: '0', change_date: '2027-01-01' }
    expect(validateStep(e, first, 1)).toEqual({})
  })
  it('step one alone is enough for a first number, for every money mode', () => {
    const first = { income: '5000', essentials: '3000', savings: '0', change_date: '2027-01-01' }
    for (const mode of ['stop', 'income', 'cost', 'mixed', 'cash'] as const)
      expect(previewForm(entry({ mode }), first)).not.toBeNull()
  })
  it('step two asks about the change', () => {
    expect(
      Object.keys(validateStep(e, { income: '5000', essentials: '3000', savings: '0' }, 2)),
    ).toEqual(expect.arrayContaining(['change_date', 'new_income']))
  })
  it('handover briefs stay on one screen', () => {
    expect(Object.keys(validateStep(medical, {}, 1))).toEqual(
      expect.arrayContaining(['change_date', 'facts', 'consent']),
    )
  })
  it('counts what is left before an answer can be shown', () => {
    expect(remainingFields(e, {})).toBe(5)
    expect(
      remainingFields(e, {
        income: '5000',
        essentials: '3000',
        savings: '0',
        new_income: '1',
        change_date: '2026-11-01',
      }),
    ).toBe(0)
  })
})

describe('dateChips', () => {
  it('offers already started and a few months ahead', () => {
    const chips = dateChips('2026-10-29')
    expect(chips.map((c) => c.label)).toEqual([
      'Already started',
      'In 1 month',
      'In 3 months',
      'In 6 months',
    ])
    expect(chips.map((c) => c.value)).toEqual([
      '2026-10-29',
      '2026-11-29',
      '2027-01-29',
      '2027-04-29',
    ])
  })
})

describe('previewForm (a partial answer is allowed, a blocked one is not)', () => {
  const today = { income: '5000', essentials: '3000', savings: '9000', change_date: '2026-11-28' }

  it('shows an answer from today figures alone, assuming nothing else changes', () => {
    const p = previewForm(entry({}), today)
    expect(p?.assumed).toEqual(['income after the change'])
    expect(p?.form['new_income']).toBe('5000')
  })

  it('needs no assumption once everything is in', () => {
    const p = previewForm(entry({}), { ...today, new_income: '2000' })
    expect(p?.assumed).toEqual([])
    expect(p?.form['new_income']).toBe('2000')
  })

  it('stays quiet while today figures or the date are missing', () => {
    expect(previewForm(entry({}), { income: '5000' })).toBeNull()
    expect(previewForm(entry({}), { ...today, change_date: '' })).toBeNull()
  })

  it('shows the baseline for a one-off brief, assuming no amount yet', () => {
    const p = previewForm(entry({ id: 'windfall', mode: 'cash' }), today)
    expect(p).not.toBeNull()
    expect(p?.form['cash_out']).toBe('0')
    expect(p?.assumed).toEqual(['spending after the change', 'one-off amount'])
  })

  it('never previews handover or sensitive briefs', () => {
    expect(previewForm(medical, { change_date: '2026-11-01' })).toBeNull()
  })
})
