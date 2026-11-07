import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { DOMAINS, getDomain, validateDomains } from '../registry.js'
import { DomainPackSchema, type DomainPack } from '../types.js'
import { lifeProtection } from '../packs/life-protection.js'

const ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..')
const PLAYBOOKS = path.join(ROOT, 'playbooks', 'family')

describe('domain registry', () => {
  it('ships valid packs with no cross-reference problems', () => {
    expect(validateDomains(DOMAINS, PLAYBOOKS)).toEqual([])
  })

  it('looks a pack up by id', () => {
    expect(getDomain('life_protection')?.title).toBe('Life and income protection')
    expect(getDomain('nope')).toBeUndefined()
  })

  it('refuses a pack that turns external access on', () => {
    const bad = { ...lifeProtection, external: { enabled: true, permitted: {} } }
    expect(DomainPackSchema.safeParse(bad).success).toBe(false)
  })

  it('names every problem: unknown playbook, record, date field, sensitive external', () => {
    const bad: DomainPack = {
      ...lifeProtection,
      id: 'broken',
      playbook: { playbook: 'does_not_exist', show_records: ['ghost'], label: 'x' },
      matrix: { record: 'ghost', label: 'x' },
      planning: [
        {
          key: 't',
          label: 'x',
          on: { kind: 'date_field', record: 'policy', field: 'provider' },
          lead_days: 1,
        },
      ],
      external: { enabled: false, permitted: { policy: ['policy_number'] } },
    }
    const problems = validateDomains([bad], PLAYBOOKS).join('\n')
    expect(problems).toMatch(/playbook does_not_exist.yaml not found/)
    expect(problems).toMatch(/playbook shows unknown record ghost/)
    expect(problems).toMatch(/matrix names unknown record ghost/)
    expect(problems).toMatch(/not a date field/)
    expect(problems).toMatch(/sensitive field cannot be externally visible/)
  })

  it('refuses a sensitive field on a stored record, but allows it on an adapter record', () => {
    const stored = DomainPackSchema.parse({
      ...lifeProtection,
      id: 'health_x',
      records: [
        {
          key: 'condition',
          label: 'Condition',
          person_attribution: 'subject',
          source: { kind: 'store' },
          fields: [{ key: 'note', label: 'Note', kind: 'text', sensitive: true }],
        },
      ],
      matrix: undefined,
      playbook: undefined,
      planning: [],
      external: { enabled: false, permitted: {} },
    })
    expect(validateDomains([stored], PLAYBOOKS).join()).toMatch(/cannot hold a sensitive field/)
    // life protection keeps a sensitive policy number on an adapter record
    expect(validateDomains([lifeProtection], PLAYBOOKS)).toEqual([])
  })

  it('rejects duplicate domain ids', () => {
    expect(validateDomains([lifeProtection, lifeProtection], PLAYBOOKS).join()).toMatch(
      /duplicate domain id/,
    )
  })

  it('accepts a new pack added as data alone (extension proof)', () => {
    const extra = DomainPackSchema.parse({
      id: 'pets',
      title: 'Pets',
      summary: 'Which pets and vets are on the family list.',
      records: [
        {
          key: 'vehicle',
          label: 'Vehicle',
          person_attribution: 'holder',
          source: { kind: 'store' },
          fields: [
            { key: 'reg', label: 'Registration', kind: 'text' },
            { key: 'mot_due', label: 'MOT due', kind: 'date' },
          ],
        },
      ],
      planning: [
        {
          key: 'mot',
          label: 'MOT due soon',
          on: { kind: 'date_field', record: 'vehicle', field: 'mot_due' },
        },
      ],
      confirm: 'both_adults',
      external: { enabled: false, permitted: { vehicle: ['reg'] } },
    })
    expect(validateDomains([lifeProtection, extra], PLAYBOOKS)).toEqual([])
  })
})
