/**
 * The v1 extraction field set (PRD-143). Only fields a detector or a crisis
 * playbook consumes, each with a fixed kind and length cap. There is no
 * free-text field: no summary, no quoted passages, no names of people. That is
 * what keeps medical text and third parties' details out (amendment 2): the
 * schema cannot carry them, and a test pins the key list.
 *
 * `has_beneficiary` is a yes/no, not a name. `document_date` is the
 * statement, issue or as-of date, for staleness (PRD-145).
 */
export const SCHEMA_VERSION = 'v1-2026-10'

export const CATEGORIES = [
  'insurance',
  'pension',
  'mortgage',
  'income',
  'investment',
  'tax',
  'will',
  'other',
] as const
export type Category = (typeof CATEGORIES)[number]

export const POLICY_TYPE_VALUES = [
  'life',
  'income_protection',
  'critical_illness',
  'health',
  'car',
  'home',
  'travel',
] as const

export type FieldKind = 'text' | 'money' | 'date' | 'bool' | 'phone' | 'email' | 'enum'

export interface FieldSpec {
  key: string
  kind: FieldKind
  /** Categories this field is read for; a value for any other category is dropped. */
  categories: readonly Category[]
  max: number
  /** For an enum field, the only accepted values. */
  values?: readonly string[]
  /** Why the field exists: which detector or playbook reads it. */
  used_by: string
}

const INS: readonly Category[] = ['insurance']

export const FIELD_SPECS = [
  {
    key: 'policy_type',
    kind: 'enum',
    categories: INS,
    max: 30,
    values: POLICY_TYPE_VALUES,
    used_by: 'which cover this policy is (protection and policy-review detectors)',
  },
  {
    key: 'provider',
    kind: 'text',
    categories: INS,
    max: 80,
    used_by: 'policy register, protection and policy-review detectors',
  },
  {
    key: 'policy_number',
    kind: 'text',
    categories: INS,
    max: 40,
    used_by: 'quoting the right reference to an existing provider',
  },
  {
    key: 'coverage_amount',
    kind: 'money',
    categories: INS,
    max: 30,
    used_by: 'protection-gap detector (sum assured)',
  },
  {
    key: 'premium',
    kind: 'money',
    categories: INS,
    max: 30,
    used_by: 'policy-review detector (overlap cost)',
  },
  {
    key: 'renewal_date',
    kind: 'date',
    categories: INS,
    max: 30,
    used_by: 'renewal reminders and protection detector',
  },
  {
    key: 'has_beneficiary',
    kind: 'bool',
    categories: INS,
    max: 3,
    used_by: 'policy-review detector (beneficiary named: yes or no)',
  },
  {
    key: 'claims_phone',
    kind: 'phone',
    categories: INS,
    max: 30,
    used_by: 'crisis playbooks (claims or assistance line)',
  },
  {
    key: 'claims_email',
    kind: 'email',
    categories: INS,
    max: 80,
    used_by: 'crisis playbooks (claims address)',
  },
  {
    key: 'balance',
    kind: 'money',
    categories: ['pension', 'mortgage', 'investment'],
    max: 30,
    used_by: 'retirement-gap detector (pension) and debt health (mortgage)',
  },
  {
    key: 'net_pay',
    kind: 'money',
    categories: ['income'],
    max: 30,
    used_by: 'protection-gap detector (household income)',
  },
  {
    key: 'gross_pay',
    kind: 'money',
    categories: ['income'],
    max: 30,
    used_by: 'protection-gap detector (income fallback)',
  },
  {
    key: 'document_date',
    kind: 'date',
    categories: ['insurance', 'pension', 'mortgage', 'income', 'investment', 'tax', 'will'],
    max: 30,
    used_by: 'staleness: how old the document is (PRD-145)',
  },
] as const satisfies readonly FieldSpec[]

export type FieldKey = (typeof FIELD_SPECS)[number]['key']
export const FIELD_KEYS = FIELD_SPECS.map((f) => f.key) as unknown as readonly FieldKey[]
export const SPEC_BY_KEY: Record<string, FieldSpec> = Object.fromEntries(
  FIELD_SPECS.map((f) => [f.key, f]),
)

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/

/**
 * Validate and normalise one value against its field. Returns null when the
 * value is not acceptable: it is dropped, never repaired into something else.
 */
export function normaliseValue(spec: FieldSpec, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().replace(/\s+/g, ' ')
  if (!v || v.length > spec.max) return null
  switch (spec.kind) {
    case 'enum': {
      const e = v.toLowerCase().replace(/[\s-]+/g, '_')
      return spec.values?.includes(e) ? e : null
    }
    case 'bool': {
      const b = v.toLowerCase()
      return b === 'yes' || b === 'no' ? b : null
    }
    case 'money':
      return /\d/.test(v) ? v : null
    case 'date':
      return /\d/.test(v) ? v : null
    case 'phone':
      return /\d{5,}/.test(v.replace(/\D/g, '')) ? v : null
    case 'email':
      return EMAIL.test(v) ? v : null
    default:
      return v
  }
}
