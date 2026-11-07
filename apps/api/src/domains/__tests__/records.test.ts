import { describe, it, expect } from 'vitest'
import { checkRecordValues } from '../records.js'
import { car } from '../packs/car.js'
import { lifeProtection } from '../packs/life-protection.js'

const ROSTER = new Set(['sam', 'alex'])
const vehicle = car.records[0]!
const policy = lifeProtection.records[0]!

describe('checkRecordValues', () => {
  it('passes real values and blanks', () => {
    expect(
      checkRecordValues(vehicle, { reg: 'AB12', mot_due: '2027-02-28' }, ROSTER, 'sam', null),
    ).toBeNull()
    expect(checkRecordValues(vehicle, { reg: '' }, ROSTER, null, null)).toBeNull()
  })

  it('refuses dates that are not real days', () => {
    expect(checkRecordValues(vehicle, { mot_due: '2027-02-30' }, ROSTER, null, null)).toMatch(
      /real date/,
    )
    expect(checkRecordValues(vehicle, { mot_due: '28/02/2027' }, ROSTER, null, null)).toMatch(
      /real date/,
    )
  })

  it('refuses people who are not in the family', () => {
    expect(checkRecordValues(vehicle, {}, ROSTER, 'ghost', null)).toMatch(/in the family/)
    expect(checkRecordValues(policy, { holder: 'ghost' }, ROSTER, null, null)).toMatch(
      /in the family/,
    )
  })

  it('refuses a choice that is not one of the options', () => {
    expect(checkRecordValues(policy, { type: 'pension' }, ROSTER, null, null)).toMatch(/options/)
    expect(checkRecordValues(policy, { type: 'life' }, ROSTER, null, null)).toBeNull()
  })

  it('refuses a money value that is not an amount', () => {
    const money = {
      ...vehicle,
      fields: [{ key: 'fee', label: 'Fee', kind: 'money' as const, sensitive: false }],
    }
    expect(checkRecordValues(money, { fee: '12.50' }, ROSTER, null, null)).toBeNull()
    expect(checkRecordValues(money, { fee: '12.505' }, ROSTER, null, null)).toMatch(/amount/)
    expect(checkRecordValues(money, { fee: 'lots' }, ROSTER, null, null)).toMatch(/amount/)
  })
})
