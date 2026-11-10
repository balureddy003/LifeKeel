import type { DomainPack } from '../types.js'

/**
 * Health contacts. Added as data alone: who to call about each person's health and where the
 * medicines list is kept. It holds contacts and a place, not conditions, medicines or results
 * (nothing sensitive is stored here). It states what is on the family list; it never says what
 * care to seek or what cover applies.
 */
export const health: DomainPack = {
  id: 'health',
  title: 'Health contacts',
  summary: 'Who to call about each person’s health, and where the medicines list is kept.',
  records: [
    {
      key: 'contact',
      label: 'Health contact',
      person_attribution: 'none',
      source: { kind: 'store' },
      fields: [
        { key: 'person', label: 'For', kind: 'member', sensitive: false },
        {
          key: 'kind',
          label: 'Who',
          kind: 'choice',
          choices: ['gp', 'dentist', 'pharmacy', 'specialist', 'other'],
          sensitive: false,
        },
        { key: 'name', label: 'Name or practice', kind: 'text', sensitive: false },
        { key: 'phone', label: 'Phone', kind: 'text', sensitive: false },
        {
          key: 'medicines_list',
          label: 'Where the medicines list is kept',
          kind: 'text',
          sensitive: false,
        },
      ],
    },
  ],
  playbook: {
    playbook: 'medical',
    show_records: ['contact'],
    label: 'If someone is taken ill: what is on the family list',
  },
  planning: [],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: { contact: ['kind', 'name', 'phone'] },
  },
}
