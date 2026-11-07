import type { DomainPack } from '../types.js'

/**
 * Car and transport. Added as data alone: vehicles are household-entered
 * (generic store) and car policies are read from the financial profile. It
 * states what is on file and which dates are coming; it never compares
 * insurers or says what to buy.
 */
export const car: DomainPack = {
  id: 'car',
  title: 'Car and transport',
  summary: 'Which vehicles and car policies are on file, and when the next dates fall.',
  records: [
    {
      key: 'vehicle',
      label: 'Vehicle',
      person_attribution: 'holder',
      source: { kind: 'store' },
      fields: [
        { key: 'reg', label: 'Registration', kind: 'text', sensitive: false },
        { key: 'make_model', label: 'Make and model', kind: 'text', sensitive: false },
        { key: 'mot_due', label: 'MOT due', kind: 'date', sensitive: false },
        { key: 'recovery_contact', label: 'Recovery contact', kind: 'text', sensitive: false },
      ],
    },
    {
      key: 'policy',
      label: 'Car policy',
      person_attribution: 'holder',
      source: { kind: 'adapter', adapter: 'financial_profile_policies' },
      fields: [
        { key: 'type', label: 'Type', kind: 'choice', choices: ['car'], sensitive: false },
        { key: 'provider', label: 'Provider', kind: 'text', sensitive: false },
        { key: 'holder', label: 'Held by', kind: 'member', sensitive: false },
        { key: 'renewal_date', label: 'Renewal date', kind: 'date', sensitive: false },
        { key: 'claims_contact', label: 'Claims contact', kind: 'text', sensitive: false },
      ],
    },
  ],
  playbook: {
    playbook: 'car',
    show_records: ['vehicle', 'policy'],
    label: 'If there is an accident or breakdown: what is on file',
  },
  planning: [
    {
      key: 'mot',
      label: 'An MOT is due',
      on: { kind: 'date_field', record: 'vehicle', field: 'mot_due' },
      lead_days: 30,
    },
    {
      key: 'renewal',
      label: 'A car policy renewal date is coming up',
      on: { kind: 'date_field', record: 'policy', field: 'renewal_date' },
      lead_days: 30,
    },
  ],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: {
      vehicle: ['reg', 'make_model', 'recovery_contact'],
      policy: ['provider', 'claims_contact'],
    },
  },
}
