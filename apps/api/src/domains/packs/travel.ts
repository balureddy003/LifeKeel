import type { DomainPack } from '../types.js'

/**
 * Travel. Trips are household-entered facts (generic store); travel policies are
 * read from the financial profile. A trip holds what the family typed from the
 * paper: dates, country, which policy the family says applies, and the assistance
 * line as printed. LifeKeel never says whether a policy covers the trip, never
 * names or compares insurers, and sends nothing (CLAUDE.md rules 1 and 2).
 */
export const travel: DomainPack = {
  id: 'travel',
  title: 'Travel',
  summary: 'Which trips and travel policies are on the family list, and when the next dates fall.',
  records: [
    {
      key: 'trip',
      label: 'Trip',
      person_attribution: 'subject',
      source: { kind: 'store' },
      fields: [
        { key: 'destination', label: 'Destination country', kind: 'text', sensitive: false },
        { key: 'departs', label: 'Leaving on', kind: 'date', sensitive: false },
        { key: 'returns', label: 'Back on', kind: 'date', sensitive: false },
        { key: 'policy', label: 'Policy that applies', kind: 'text', sensitive: false },
        {
          key: 'assistance_line',
          label: 'Assistance line, as printed',
          kind: 'text',
          sensitive: false,
        },
      ],
    },
    {
      key: 'policy',
      label: 'Travel policy',
      person_attribution: 'holder',
      source: { kind: 'adapter', adapter: 'financial_profile_policies' },
      fields: [
        { key: 'type', label: 'Type', kind: 'choice', choices: ['travel'], sensitive: false },
        { key: 'provider', label: 'Provider', kind: 'text', sensitive: false },
        { key: 'holder', label: 'Held by', kind: 'member', sensitive: false },
        { key: 'renewal_date', label: 'Renewal date', kind: 'date', sensitive: false },
        { key: 'claims_contact', label: 'Claims contact', kind: 'text', sensitive: false },
      ],
    },
  ],
  playbook: {
    playbook: 'travel',
    show_records: ['policy'],
    label: 'If something goes wrong away from home: what is on the family list',
  },
  planning: [
    {
      key: 'trip_starts',
      label: 'A trip starts',
      on: { kind: 'date_field', record: 'trip', field: 'departs' },
      lead_days: 30,
      lookback_days: 0,
    },
    {
      key: 'trip_ends',
      label: 'A trip ends',
      on: { kind: 'date_field', record: 'trip', field: 'returns' },
      lead_days: 30,
      lookback_days: 0,
    },
    {
      key: 'renewal',
      label: 'A travel policy renewal date is coming up',
      on: { kind: 'date_field', record: 'policy', field: 'renewal_date' },
      lead_days: 30,
    },
  ],
  none_on_file: [{ record: 'policy', text: 'No travel policy on file.' }],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: {},
  },
}
