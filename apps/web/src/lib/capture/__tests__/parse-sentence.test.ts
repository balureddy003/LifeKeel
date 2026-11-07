/**
 * Sentence to draft: local, deterministic, driven only by what a pack declares
 * and the family roster. It reads real dates, plates, amounts, choices and a
 * family member's name; it reports what it left out; it never invents a value.
 */
import { describe, it, expect } from 'vitest'
import { parseSentence } from '../parse-sentence'
import type { DomainView } from '@/lib/api'

type Pack = DomainView['pack']
const NOW = new Date('2026-11-07T00:00:00Z')
const ROSTER = [
  { id: 'sam', name: 'Sam Reddy' },
  { id: 'alex', name: 'Alex Reddy' },
]

const car: Pack = {
  id: 'car',
  title: 'Car and transport',
  summary: 's',
  records: [
    {
      key: 'vehicle',
      label: 'Vehicle',
      person_attribution: 'holder',
      source: { kind: 'store' },
      fields: [
        { key: 'reg', label: 'Registration', kind: 'text' },
        { key: 'make_model', label: 'Make and model', kind: 'text' },
        { key: 'mot_due', label: 'MOT due', kind: 'date' },
        { key: 'tax_due', label: 'Tax due', kind: 'date' },
      ],
    },
    {
      key: 'policy',
      label: 'Car policy',
      person_attribution: 'holder',
      source: { kind: 'adapter', adapter: 'financial_profile_policies' },
      fields: [{ key: 'renewal_date', label: 'Renewal date', kind: 'date' }],
    },
  ],
}

const cover: Pack = {
  id: 'cover',
  title: 'Cover',
  summary: 's',
  records: [
    {
      key: 'plan',
      label: 'Plan',
      person_attribution: 'holder',
      source: { kind: 'store' },
      fields: [
        { key: 'type', label: 'Type', kind: 'choice', choices: ['life', 'income_protection'] },
        { key: 'premium', label: 'Premium', kind: 'money' },
        { key: 'renewal_date', label: 'Renewal date', kind: 'date' },
        { key: 'covers', label: 'Covers', kind: 'member' },
      ],
    },
  ],
}

const parse = (s: string, pack: Pack = car) => parseSentence(s, pack, ROSTER, NOW)

describe('parseSentence', () => {
  it('reads a plate, a date and whose it is from one sentence', () => {
    const r = parse("MOT due 9 May on AB12 CDE, Sam's car")
    expect(r.drafts).toHaveLength(1)
    expect(r.drafts[0]).toMatchObject({
      record: 'vehicle',
      holderMemberId: 'sam',
      values: { mot_due: '2027-05-09', reg: 'AB12 CDE' },
    })
    expect(r.unused).not.toMatch(/mot|due|sam/)
  })

  it('understands the ways people say a date, and refuses days that do not exist', () => {
    const dates = (s: string) => parse(s).drafts[0]?.values['mot_due']
    expect(dates('MOT due 9th of May 2027')).toBe('2027-05-09')
    expect(dates('MOT due May 9 2027')).toBe('2027-05-09')
    expect(dates('MOT due 09/05/2027')).toBe('2027-05-09')
    expect(dates('MOT due 2027-05-09')).toBe('2027-05-09')
    expect(dates('MOT due 31 February 2027')).toBeUndefined()
  })

  it('a date with no year means its next occurrence', () => {
    expect(parse('MOT due 3 March').drafts[0]!.values['mot_due']).toBe('2027-03-03')
    expect(parse('MOT due 7 November').drafts[0]!.values['mot_due']).toBe('2026-11-07') // today
    expect(parse('MOT due 6 November').drafts[0]!.values['mot_due']).toBe('2027-11-06') // yesterday
  })

  it('puts each date on the field its words are nearest to', () => {
    const v = parse('MOT due 9 May and tax due 1 June').drafts[0]!.values
    expect(v['mot_due']).toBe('2027-05-09')
    expect(v['tax_due']).toBe('2027-06-01')
    expect(parse('tax is due 1 June, MOT 9 May').drafts[0]!.values).toMatchObject({
      mot_due: '2027-05-09',
      tax_due: '2027-06-01',
    })
  })

  it('never invents a value: fields it cannot read stay empty and the leftover is reported', () => {
    const r = parse('MOT due 9 May and my cousin likes jazz')
    expect(r.drafts[0]!.values['make_model']).toBeUndefined()
    expect(r.unused).toBe('cousin likes jazz')
  })

  it('does not assign a name that is not in the family', () => {
    const r = parse("MOT due 9 May, Pat's car")
    expect(r.drafts[0]!.holderMemberId).toBeNull()
    expect(r.unused).toContain('pat')
  })

  it('reads a choice, an amount and a family member for a pack that has them', () => {
    const r = parse('life plan renewal 1 March premium £1,200.50 covers Alex', cover)
    expect(r.drafts[0]!.values).toEqual({
      type: 'life',
      renewal_date: '2027-03-01',
      premium: '1200.50',
      covers: 'alex',
    })
    expect(parse('income protection plan £80', cover).drafts[0]!.values['type']).toBe(
      'income_protection',
    )
  })

  it('drafts nothing when the pack has no record a person types in, or nothing was understood', () => {
    const adapterOnly: Pack = { ...car, records: [car.records[1]!] }
    expect(parse('renewal 9 May', adapterOnly).drafts).toEqual([])
    expect(parse('   ').drafts).toEqual([])
    expect(parse('hello there how are you').drafts).toEqual([])
  })

  it('works for a pack added later with no code: only the manifest matters', () => {
    const pets: Pack = {
      id: 'pets',
      title: 'Pets',
      summary: 's',
      records: [
        {
          key: 'pet',
          label: 'Pet',
          person_attribution: 'holder',
          source: { kind: 'store' },
          fields: [{ key: 'vaccination_due', label: 'Vaccination due', kind: 'date' }],
        },
      ],
    }
    expect(parse("Alex's pet vaccination due 2 July", pets).drafts[0]).toMatchObject({
      holderMemberId: 'alex',
      values: { vaccination_due: '2027-07-02' },
    })
  })
})
