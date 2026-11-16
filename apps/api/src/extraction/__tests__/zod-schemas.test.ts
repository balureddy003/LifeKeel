import { describe, expect, it } from 'vitest'
import { CATEGORIES, FIELD_SPECS, SPEC_BY_KEY } from '../schema.js'
import {
  DOCUMENT_SCHEMAS,
  checkExtraction,
  type DocumentType,
} from '../../resilience/extraction-checks.js'
import { CATEGORY_SCHEMAS, DOCUMENT_ZOD_SCHEMAS } from '../zod-schemas.js'

describe('category Zod schemas (intent 97, slice 5)', () => {
  it('every category has a schema covering exactly its FIELD_SPECS keys', () => {
    for (const cat of CATEGORIES) {
      const schema = CATEGORY_SCHEMAS[cat]
      expect(schema, cat).toBeDefined()
      const shapeKeys = Object.keys(schema.shape).sort()
      const expected = FIELD_SPECS.filter((f) => (f.categories as readonly string[]).includes(cat))
        .map((f) => f.key)
        .sort()
      expect(shapeKeys).toEqual(expected)
    }
  })

  it('accepts representative values for every field kind', () => {
    const insurance = CATEGORY_SCHEMAS.insurance
    const ok = insurance.safeParse({
      policy_type: 'Life', // enum normalises to 'life'
      provider: 'Example Assurance plc',
      policy_number: 'POL-12345',
      coverage_amount: '£500,000',
      premium: '42.50',
      renewal_date: '2027-03-01',
      has_beneficiary: 'yes',
      claims_phone: '+44 20 7946 0958',
      claims_email: 'claims@example.com',
      document_date: '2026-01-15',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects values normaliseValue would drop', () => {
    const s = CATEGORY_SCHEMAS.insurance
    expect(s.safeParse({ policy_type: 'not_a_type' }).success).toBe(false)
    expect(s.safeParse({ has_beneficiary: 'maybe' }).success).toBe(false)
    expect(s.safeParse({ claims_email: 'not-an-email' }).success).toBe(false)
    expect(s.safeParse({ claims_phone: 'abc' }).success).toBe(false)
    expect(s.safeParse({ coverage_amount: 'no digits here' }).success).toBe(false)
    expect(s.safeParse({ provider: 42 }).success).toBe(false)
  })

  it('unknown keys pass through — the pipeline drops them, it does not reject the document', () => {
    expect(
      CATEGORY_SCHEMAS.banking.safeParse({ statement_money_in: '£1,000', a_free_text_field: 'x' })
        .success,
    ).toBe(true)
  })

  it('every FIELD_SPECS key belongs to at least one category schema', () => {
    const covered = new Set(CATEGORIES.flatMap((c) => Object.keys(CATEGORY_SCHEMAS[c].shape)))
    for (const f of FIELD_SPECS) expect(covered.has(f.key), f.key).toBe(true)
    expect(SPEC_BY_KEY.provider?.kind).toBe('text')
  })
})

const VALID: Record<DocumentType, Record<string, unknown>> = {
  payslip: { gross_minor: 300_000, net_minor: 240_000, tax_minor: 60_000, pay_date: '2026-01-31' },
  mortgage_statement: {
    balance_minor: 20_000_000,
    monthly_payment_minor: 150_000,
    fix_end_date: '2027-06-30',
    statement_date: '2026-01-01',
  },
  home_insurance: {
    monthly_premium_minor: 5_000,
    annual_premium_minor: 60_000,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    sum_insured_minor: 30_000_000,
  },
  car_insurance: {
    monthly_premium_minor: 4_000,
    annual_premium_minor: 48_000,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  },
  life_policy: {
    monthly_premium_minor: 3_000,
    annual_premium_minor: 36_000,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
    sum_assured_minor: 50_000_000,
  },
  pension_statement: { value_minor: 1_000_000, statement_date: '2025-12-31' },
  council_tax_bill: {
    annual_charge_minor: 120_000,
    monthly_instalment_minor: 10_000,
    bill_date: '2026-04-01',
  },
  tenancy: {
    monthly_rent_minor: 120_000,
    deposit_minor: 240_000,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  },
  energy_bill: {
    line_items_minor: [50_000, 30_000, 20_000],
    total_minor: 100_000,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
  },
  bank_statement: {
    opening_minor: 500_000,
    closing_minor: 550_000,
    credits_minor: 200_000,
    debits_minor: 150_000,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
  },
}

describe('document Zod schemas (intent 97, slice 5)', () => {
  it('every document type has a schema', () => {
    for (const t of Object.keys(DOCUMENT_SCHEMAS) as DocumentType[]) {
      expect(DOCUMENT_ZOD_SCHEMAS[t], t).toBeDefined()
    }
  })

  it('parity: safeParse succeeds exactly when checkExtraction finds no problems', () => {
    for (const [type, raw] of Object.entries(VALID) as [DocumentType, Record<string, unknown>][]) {
      const zodOk = DOCUMENT_ZOD_SCHEMAS[type].safeParse(raw).success
      const problems = checkExtraction(type, raw)
      expect(zodOk, `${type}: ${JSON.stringify(problems)}`).toBe(problems.length === 0)
    }
  })

  it('fails on missing required, bad kinds and failed cross-checks', () => {
    expect(DOCUMENT_ZOD_SCHEMAS.payslip.safeParse({ net_minor: 1 }).success).toBe(false) // missing required
    expect(
      DOCUMENT_ZOD_SCHEMAS.payslip.safeParse({ ...VALID.payslip, gross_minor: -5 }).success,
    ).toBe(false)
    expect(
      DOCUMENT_ZOD_SCHEMAS.payslip.safeParse({ ...VALID.payslip, pay_date: '2026-13-40' }).success,
    ).toBe(false)
    // net > gross trips not_above.
    expect(
      DOCUMENT_ZOD_SCHEMAS.payslip.safeParse({ ...VALID.payslip, net_minor: 400_000 }).success,
    ).toBe(false)
    // energy line items must add to the total.
    expect(
      DOCUMENT_ZOD_SCHEMAS.energy_bill.safeParse({ ...VALID.energy_bill, total_minor: 1 }).success,
    ).toBe(false)
    // bank statement must reconcile.
    expect(
      DOCUMENT_ZOD_SCHEMAS.bank_statement.safeParse({ ...VALID.bank_statement, closing_minor: 1 })
        .success,
    ).toBe(false)
  })

  it('unknown keys are dropped downstream, not rejected — matching keepSchemaFields', () => {
    const raw = { ...VALID.payslip, unexpected_field: 'x', nested: { a: 1 } }
    const res = DOCUMENT_ZOD_SCHEMAS.payslip.safeParse(raw)
    expect(res.success).toBe(true)
  })
})
