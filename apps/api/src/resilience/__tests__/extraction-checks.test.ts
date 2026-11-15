import { describe, it, expect } from 'vitest'
import {
  DOCUMENT_SCHEMAS,
  checkExtraction,
  keepSchemaFields,
  type DocumentType,
} from '../extraction-checks.js'

// Intent 94, R9. Mechanical checks run before a person confirms anything: they catch errors, they do not
// prove a document is right. They never call a model.
const TYPES = Object.keys(DOCUMENT_SCHEMAS) as DocumentType[]

describe('document schemas', () => {
  it('cover the ten common UK household documents', () => {
    expect(TYPES.sort()).toEqual(
      [
        'bank_statement',
        'car_insurance',
        'council_tax_bill',
        'energy_bill',
        'home_insurance',
        'life_policy',
        'mortgage_statement',
        'payslip',
        'pension_statement',
        'tenancy',
      ].sort(),
    )
  })
})

describe('keepSchemaFields', () => {
  it('drops anything outside the schema (nothing else is stored)', () => {
    const kept = keepSchemaFields('payslip', {
      gross_minor: 300000,
      net_minor: 240000,
      pay_date: '2026-10-31',
      diagnosis: 'x',
      employer_notes: 'y',
    })
    expect(Object.keys(kept).sort()).toEqual(['gross_minor', 'net_minor', 'pay_date'])
  })
})

describe('checkExtraction: amounts and dates', () => {
  const good = { gross_minor: 300000, net_minor: 240000, pay_date: '2026-10-31' }
  it('a clean payslip has no problems', () => {
    expect(checkExtraction('payslip', good)).toEqual([])
  })
  it('flags a fractional, negative or non-number amount', () => {
    for (const bad of [1.5, -1, '2400', NaN]) {
      const p = checkExtraction('payslip', { ...good, net_minor: bad as never })
      expect(p.map((x) => x.code)).toContain('amount_not_whole')
    }
  })
  it('flags a date that is not a real date (30 February, wrong format)', () => {
    for (const bad of ['2026-02-30', '31/10/2026', 'yesterday']) {
      expect(checkExtraction('payslip', { ...good, pay_date: bad }).map((x) => x.code)).toContain(
        'date_not_real',
      )
    }
  })
  it('flags a missing required field', () => {
    expect(checkExtraction('payslip', { gross_minor: 300000 }).map((x) => x.code)).toContain(
      'missing_required',
    )
  })
})

describe('checkExtraction: cross-checks', () => {
  it('monthly times twelve must equal annual (insurance premium)', () => {
    const ok = {
      monthly_premium_minor: 2500,
      annual_premium_minor: 30000,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    }
    expect(checkExtraction('home_insurance', ok)).toEqual([])
    const off = { ...ok, annual_premium_minor: 29000 }
    expect(checkExtraction('home_insurance', off).map((x) => x.code)).toContain(
      'monthly_times_twelve_mismatch',
    )
  })
  it('line items must add up to the total (energy bill)', () => {
    const ok = {
      line_items_minor: [4000, 1500, 500],
      total_minor: 6000,
      period_start: '2026-09-01',
      period_end: '2026-09-30',
    }
    expect(checkExtraction('energy_bill', ok)).toEqual([])
    expect(
      checkExtraction('energy_bill', { ...ok, total_minor: 6100 }).map((x) => x.code),
    ).toContain('lines_do_not_add_up')
  })
  it('a start date after the end date is flagged', () => {
    const p = checkExtraction('car_insurance', {
      monthly_premium_minor: 1000,
      annual_premium_minor: 12000,
      start_date: '2026-12-31',
      end_date: '2026-01-01',
    })
    expect(p.map((x) => x.code)).toContain('dates_out_of_order')
  })
})

describe('problems', () => {
  it('name the field and carry plain wording, never the value', () => {
    const p = checkExtraction('payslip', {
      gross_minor: 300000,
      net_minor: 123456.5,
      pay_date: '2026-10-31',
    })
    expect(p.length).toBeGreaterThan(0)
    for (const x of p) {
      expect(x.field).toBeTruthy()
      expect(x.message).not.toContain('123456')
      expect(x.message).not.toMatch(/\b(buy|switch|should|recommend)\b/i)
    }
  })
  it('every schema accepts an empty object without throwing and reports its required fields', () => {
    for (const t of TYPES) expect(() => checkExtraction(t, {})).not.toThrow()
  })
})
