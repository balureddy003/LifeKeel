import { describe, expect, it } from 'vitest'
import { buildObligationInput, groupByPerson, validateMapForm } from '../map-form'

describe('validateMapForm', () => {
  it('names each missing required field', () => {
    const e = validateMapForm({})
    expect(e['label']).toBeTruthy()
    expect(e['named_person']).toBeTruthy()
    expect(e['next_due_date']).toBeTruthy()
  })
  it('rejects a malformed date', () => {
    expect(
      validateMapForm({ label: 'x', named_person: 'Sam', next_due_date: 'not-a-date' })[
        'next_due_date'
      ],
    ).toBeTruthy()
  })
  it('passes with the three required fields', () => {
    expect(
      Object.keys(
        validateMapForm({ label: 'x', named_person: 'Sam', next_due_date: '2026-12-14' }),
      ),
    ).toEqual([])
  })
})

describe('buildObligationInput', () => {
  it('drops empty optional fields and trims', () => {
    const i = buildObligationInput({
      label: ' Mortgage ',
      named_person: ' Sam ',
      next_due_date: '2026-12-14',
      pays_from: '',
      notices_to: " Alex's phone ",
      recurrence: 'monthly',
    })
    expect(i).toEqual({
      label: 'Mortgage',
      named_person: 'Sam',
      next_due_date: '2026-12-14',
      notices_to: "Alex's phone",
      recurrence: 'monthly',
    })
    expect('pays_from' in i).toBe(false)
  })
})

describe('groupByPerson', () => {
  it('groups by named person and buckets blanks', () => {
    const g = groupByPerson([
      { named_person: 'Sam' },
      { named_person: 'Alex' },
      { named_person: ' Sam ' },
      { named_person: '' },
    ])
    expect(g.get('Sam')).toHaveLength(2)
    expect(g.get('Alex')).toHaveLength(1)
    expect(g.get('Unassigned')).toHaveLength(1)
  })
})
