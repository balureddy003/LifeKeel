/**
 * Mechanical checks on extracted document fields (intent 94, R9). They run BEFORE a person confirms a figure
 * and catch the errors a machine can catch: a date that is not real, an amount that is not whole, line items
 * that do not add to the total, monthly times twelve that does not equal the annual figure. They do not prove
 * a document is right, call no model, and never echo a value back (messages name the field only). A flagged
 * figure is shown to a person to confirm or correct; nothing is changed automatically.
 *
 * Fixed schema per document type: anything outside it is dropped, not stored (see the ingestion note).
 * Amounts are whole, non-negative minor units; an overdrawn balance is therefore flagged for a person to
 * confirm rather than silently accepted.
 */
export type FieldKind = 'money' | 'date' | 'money_list'

export type Check =
  | { type: 'monthly_times_twelve'; monthly: string; annual: string }
  | { type: 'lines_add_up'; lines: string; total: string }
  | { type: 'date_order'; start: string; end: string }
  | { type: 'not_above'; low: string; high: string }
  | { type: 'balance'; opening: string; credits: string; debits: string; closing: string }

export interface DocumentSchema {
  fields: Record<string, FieldKind>
  required: string[]
  checks: Check[]
}

const premium = (extra: Record<string, FieldKind> = {}): DocumentSchema['fields'] => ({
  monthly_premium_minor: 'money',
  annual_premium_minor: 'money',
  start_date: 'date',
  end_date: 'date',
  ...extra,
})
const premiumChecks: Check[] = [
  {
    type: 'monthly_times_twelve',
    monthly: 'monthly_premium_minor',
    annual: 'annual_premium_minor',
  },
  { type: 'date_order', start: 'start_date', end: 'end_date' },
]

export const DOCUMENT_SCHEMAS = {
  payslip: {
    fields: { gross_minor: 'money', net_minor: 'money', tax_minor: 'money', pay_date: 'date' },
    required: ['gross_minor', 'net_minor', 'pay_date'],
    checks: [{ type: 'not_above', low: 'net_minor', high: 'gross_minor' }],
  },
  mortgage_statement: {
    fields: {
      balance_minor: 'money',
      monthly_payment_minor: 'money',
      fix_end_date: 'date',
      statement_date: 'date',
    },
    required: ['balance_minor', 'monthly_payment_minor', 'statement_date'],
    checks: [],
  },
  home_insurance: {
    fields: premium({ sum_insured_minor: 'money' }),
    required: ['annual_premium_minor', 'start_date', 'end_date'],
    checks: premiumChecks,
  },
  car_insurance: {
    fields: premium(),
    required: ['annual_premium_minor', 'start_date', 'end_date'],
    checks: premiumChecks,
  },
  life_policy: {
    fields: premium({ sum_assured_minor: 'money' }),
    required: ['sum_assured_minor', 'start_date'],
    checks: premiumChecks,
  },
  pension_statement: {
    fields: { value_minor: 'money', statement_date: 'date' },
    required: ['value_minor', 'statement_date'],
    checks: [],
  },
  council_tax_bill: {
    fields: { annual_charge_minor: 'money', monthly_instalment_minor: 'money', bill_date: 'date' },
    required: ['annual_charge_minor'],
    checks: [],
  },
  tenancy: {
    fields: {
      monthly_rent_minor: 'money',
      deposit_minor: 'money',
      start_date: 'date',
      end_date: 'date',
    },
    required: ['monthly_rent_minor', 'start_date'],
    checks: [{ type: 'date_order', start: 'start_date', end: 'end_date' }],
  },
  energy_bill: {
    fields: {
      line_items_minor: 'money_list',
      total_minor: 'money',
      period_start: 'date',
      period_end: 'date',
    },
    required: ['total_minor', 'period_start', 'period_end'],
    checks: [
      { type: 'lines_add_up', lines: 'line_items_minor', total: 'total_minor' },
      { type: 'date_order', start: 'period_start', end: 'period_end' },
    ],
  },
  bank_statement: {
    fields: {
      opening_minor: 'money',
      closing_minor: 'money',
      credits_minor: 'money',
      debits_minor: 'money',
      period_start: 'date',
      period_end: 'date',
    },
    required: ['opening_minor', 'closing_minor', 'period_start', 'period_end'],
    checks: [
      {
        type: 'balance',
        opening: 'opening_minor',
        credits: 'credits_minor',
        debits: 'debits_minor',
        closing: 'closing_minor',
      },
      { type: 'date_order', start: 'period_start', end: 'period_end' },
    ],
  },
} as const satisfies Record<string, DocumentSchema>

export type DocumentType = keyof typeof DOCUMENT_SCHEMAS

export interface Problem {
  field: string
  code:
    | 'missing_required'
    | 'amount_not_whole'
    | 'date_not_real'
    | 'monthly_times_twelve_mismatch'
    | 'lines_do_not_add_up'
    | 'dates_out_of_order'
    | 'value_above_limit'
    | 'balance_does_not_reconcile'
  message: string
}

const schemaOf = (t: DocumentType): DocumentSchema => DOCUMENT_SCHEMAS[t]

const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isRealDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v)
}

export function keepSchemaFields(
  type: DocumentType,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(schemaOf(type).fields)) if (k in raw) out[k] = raw[k]
  return out
}

export function checkExtraction(type: DocumentType, raw: Record<string, unknown>): Problem[] {
  const schema = schemaOf(type)
  const data = keepSchemaFields(type, raw)
  const problems: Problem[] = []
  const valid = new Set<string>()

  for (const name of schema.required) {
    if (data[name] === undefined || data[name] === null) {
      problems.push({
        field: name,
        code: 'missing_required',
        message: `A figure for ${name} is needed and was not found.`,
      })
    }
  }
  for (const [name, kind] of Object.entries(schema.fields)) {
    const v = data[name]
    if (v === undefined || v === null) continue
    if (kind === 'money') {
      if (isWhole(v)) valid.add(name)
      else
        problems.push({
          field: name,
          code: 'amount_not_whole',
          message: `${name} needs to be a whole amount, not negative.`,
        })
    } else if (kind === 'date') {
      if (isRealDate(v)) valid.add(name)
      else
        problems.push({
          field: name,
          code: 'date_not_real',
          message: `${name} needs to be a real date written year-month-day.`,
        })
    } else if (Array.isArray(v) && v.every(isWhole)) valid.add(name)
    else
      problems.push({
        field: name,
        code: 'amount_not_whole',
        message: `${name} needs to be a list of whole amounts.`,
      })
  }

  const num = (k: string) => data[k] as number
  for (const c of schema.checks) {
    switch (c.type) {
      case 'monthly_times_twelve':
        if (valid.has(c.monthly) && valid.has(c.annual) && num(c.monthly) * 12 !== num(c.annual)) {
          problems.push({
            field: c.annual,
            code: 'monthly_times_twelve_mismatch',
            message: `The monthly figure times twelve does not equal ${c.annual}; fees or interest can explain this, so please check it.`,
          })
        }
        break
      case 'lines_add_up':
        if (valid.has(c.lines) && valid.has(c.total)) {
          const sum = (data[c.lines] as number[]).reduce((a, b) => a + b, 0)
          if (sum !== num(c.total)) {
            problems.push({
              field: c.total,
              code: 'lines_do_not_add_up',
              message: `The line items do not add up to ${c.total}.`,
            })
          }
        }
        break
      case 'date_order':
        if (
          valid.has(c.start) &&
          valid.has(c.end) &&
          (data[c.start] as string) > (data[c.end] as string)
        ) {
          problems.push({
            field: c.end,
            code: 'dates_out_of_order',
            message: `${c.start} is after ${c.end}.`,
          })
        }
        break
      case 'not_above':
        if (valid.has(c.low) && valid.has(c.high) && num(c.low) > num(c.high)) {
          problems.push({
            field: c.low,
            code: 'value_above_limit',
            message: `${c.low} is higher than ${c.high}, which is unusual.`,
          })
        }
        break
      case 'balance':
        if (
          valid.has(c.opening) &&
          valid.has(c.closing) &&
          valid.has(c.credits) &&
          valid.has(c.debits)
        ) {
          if (num(c.opening) + num(c.credits) - num(c.debits) !== num(c.closing)) {
            problems.push({
              field: c.closing,
              code: 'balance_does_not_reconcile',
              message: `Opening plus credits minus debits does not equal ${c.closing}.`,
            })
          }
        }
        break
    }
  }
  return problems
}
