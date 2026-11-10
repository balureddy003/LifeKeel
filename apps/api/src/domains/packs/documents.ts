import type { DomainPack } from '../types.js'

/**
 * Papers and where they are kept. Added as data alone: this records WHERE a will, a power of
 * attorney, the passports or the deeds are kept, not their contents. It states what is on the
 * family list and when it was last looked at; it never says what a paper should contain.
 */
export const documents: DomainPack = {
  id: 'documents',
  title: 'Papers and where they are kept',
  summary: 'Where the will, power of attorney, passports and other key papers are kept.',
  records: [
    {
      key: 'document',
      label: 'Paper',
      person_attribution: 'holder',
      source: { kind: 'store' },
      fields: [
        {
          key: 'kind',
          label: 'What it is',
          kind: 'choice',
          choices: [
            'will',
            'lasting_power_of_attorney',
            'passports',
            'deeds',
            'insurance_papers',
            'other',
          ],
          sensitive: false,
        },
        { key: 'where', label: 'Where it is kept', kind: 'text', sensitive: false },
        { key: 'who_has_a_copy', label: 'Who has a copy', kind: 'text', sensitive: false },
        { key: 'looked_at_on', label: 'Last looked at', kind: 'date', sensitive: false },
      ],
    },
  ],
  planning: [],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: { document: ['kind', 'where'] },
  },
}
