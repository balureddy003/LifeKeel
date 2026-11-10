import type { DomainPack } from '../types.js'

/**
 * Life & income protection: which policies exist, whom each one covers, and
 * what the employer provides. States what is on the family list. It never judges whether
 * the cover is enough, and never names a product to buy.
 */
export const lifeProtection: DomainPack = {
  id: 'life_protection',
  title: 'Life and income protection',
  summary: 'Which policies are on the family list, who each one covers, and who is named on them.',
  records: [
    {
      key: 'policy',
      label: 'Policy',
      person_attribution: 'holder',
      source: { kind: 'adapter', adapter: 'financial_profile_policies' },
      fields: [
        {
          key: 'type',
          label: 'Type',
          kind: 'choice',
          choices: ['life', 'income_protection', 'critical_illness'],
          sensitive: false,
        },
        { key: 'provider', label: 'Provider', kind: 'text', sensitive: false },
        { key: 'holder', label: 'Held by', kind: 'member', sensitive: false },
        { key: 'covers', label: 'Covers', kind: 'member', sensitive: false },
        { key: 'nominated', label: 'Nominated person', kind: 'text', sensitive: false },
        { key: 'renewal_date', label: 'Renewal date', kind: 'date', sensitive: false },
        { key: 'claims_contact', label: 'Claims contact', kind: 'text', sensitive: false },
        { key: 'policy_number', label: 'Policy number', kind: 'text', sensitive: true },
      ],
    },
    {
      key: 'employer_cover',
      label: 'Cover through an employer',
      person_attribution: 'holder',
      source: { kind: 'adapter', adapter: 'employer_cover_facts' },
      fields: [
        { key: 'holder', label: 'Employee', kind: 'member', sensitive: false },
        { key: 'type', label: 'Type', kind: 'text', sensitive: false },
        { key: 'name_as_printed', label: 'Name on the document', kind: 'text', sensitive: false },
        {
          key: 'ends_with_employment',
          label: 'Ends with the job',
          kind: 'choice',
          choices: ['yes', 'no'],
          sensitive: false,
        },
      ],
    },
  ],
  matrix: { record: 'policy', also: ['employer_cover'], label: 'Who is covered by what' },
  playbook: {
    playbook: 'bereavement',
    show_records: ['policy', 'employer_cover'],
    label: 'If someone dies: what is on the family list',
  },
  planning: [
    {
      key: 'renewal',
      label: 'A policy renewal date is coming up',
      on: { kind: 'date_field', record: 'policy', field: 'renewal_date' },
      lead_days: 30,
    },
    {
      key: 'new_child',
      label: 'A child joined the family',
      on: { kind: 'life_event', event: 'new_child' },
      lead_days: 0,
    },
    {
      key: 'marriage',
      label: 'Marriage or a new partner',
      on: { kind: 'life_event', event: 'marriage' },
      lead_days: 0,
    },
  ],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: {
      policy: ['type', 'provider', 'covers', 'claims_contact'],
      employer_cover: ['type', 'name_as_printed'],
    },
  },
}
