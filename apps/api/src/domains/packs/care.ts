import type { DomainPack } from '../types.js'

/**
 * Care for a parent or partner. Added as data alone: who cares, the main contact, and where the
 * care plan is kept. It holds facts the household entered; it says nothing about the person's
 * condition, entitlements or what care they need.
 */
export const care: DomainPack = {
  id: 'care',
  title: 'Care for someone',
  summary: 'Who looks after a parent or partner, who to call, and where the care plan is kept.',
  records: [
    {
      key: 'arrangement',
      label: 'Care arrangement',
      person_attribution: 'none',
      source: { kind: 'store' },
      fields: [
        { key: 'cared_for', label: 'Who is cared for', kind: 'text', sensitive: false },
        { key: 'carer', label: 'Who looks after them', kind: 'member', sensitive: false },
        { key: 'main_contact', label: 'Main contact', kind: 'text', sensitive: false },
        { key: 'phone', label: 'Phone', kind: 'text', sensitive: false },
        { key: 'plan_kept', label: 'Where the care plan is kept', kind: 'text', sensitive: false },
      ],
    },
  ],
  planning: [],
  confirm: 'both_adults',
  entitlement: null,
  external: {
    enabled: false,
    permitted: { arrangement: ['main_contact', 'phone'] },
  },
}
