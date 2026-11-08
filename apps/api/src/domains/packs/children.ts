import type { DomainPack } from '../types.js'

/**
 * Children and school. Added as data alone: school and fee dates are
 * household-entered (generic store), and the cover shown beside them is read
 * from the same policies the life-protection pack reads, so nothing is typed
 * twice. It states which dates are coming and which policies name each child;
 * it never says whether the cover is enough or what to buy.
 */
export const children: DomainPack = {
  id: 'children',
  title: 'Children and school',
  summary: 'Which school and fee dates are coming for each child, and which policies cover them.',
  records: [
    {
      key: 'milestone',
      label: 'School or fees date',
      person_attribution: 'none',
      source: { kind: 'store' },
      fields: [
        { key: 'child', label: 'Child', kind: 'member', sensitive: false },
        {
          key: 'type',
          label: 'What happens',
          kind: 'choice',
          choices: ['school_start', 'school_change', 'fees_start', 'university_start', 'other'],
          sensitive: false,
        },
        { key: 'date', label: 'Date', kind: 'date', sensitive: false },
      ],
    },
    {
      key: 'policy',
      label: 'Policy that covers a child',
      person_attribution: 'holder',
      source: {
        kind: 'adapter',
        adapter: 'financial_profile_policies',
        filter: { covers: 'minor' },
      },
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
        { key: 'renewal_date', label: 'Renewal date', kind: 'date', sensitive: false },
        { key: 'claims_contact', label: 'Claims contact', kind: 'text', sensitive: false },
      ],
    },
  ],
  matrix: { record: 'policy', label: 'Who is covered by what' },
  planning: [
    {
      key: 'child_date',
      label: 'A school or fees date is coming up',
      on: { kind: 'date_field', record: 'milestone', field: 'date' },
      lead_days: 60,
    },
    {
      key: 'renewal',
      label: 'A policy renewal date is coming up',
      on: { kind: 'date_field', record: 'policy', field: 'renewal_date' },
      lead_days: 30,
    },
  ],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: {
      milestone: ['type', 'date'],
      policy: ['type', 'provider', 'covers', 'claims_contact'],
    },
  },
}
