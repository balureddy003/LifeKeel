import { describe, it, expect } from 'vitest'
import { describeChange } from '../policy-change-summary'

describe('describeChange', () => {
  it('says old and new, then what stayed the same', () => {
    expect(
      describeChange({
        changed: [{ label: 'Monthly premium', before: 4200, after: 4500 }],
        unchanged: [
          { label: 'Cover', value: 25_000_000 },
          { label: 'Yearly premium', value: 50_400 },
        ],
      }),
    ).toEqual({
      headline: 'Monthly premium was £42, now £45.',
      stays: 'Cover and yearly premium stay the same.',
    })
  })
  it('one unchanged figure reads singular', () => {
    expect(
      describeChange({
        changed: [{ label: 'Cover', before: 100, after: 200 }],
        unchanged: [{ label: 'Monthly premium', value: 4200 }],
      }).stays,
    ).toBe('Monthly premium stays the same.')
  })
  it('a figure entered for the first time is added, not changed', () => {
    expect(
      describeChange({
        changed: [{ label: 'Yearly premium', before: 0, after: 50_400 }],
        unchanged: [],
      }),
    ).toEqual({
      headline: 'Yearly premium added: £504.',
      stays: null,
    })
  })
  it('no change says so plainly', () => {
    expect(describeChange({ changed: [], unchanged: [{ label: 'Cover', value: 1 }] })).toEqual({
      headline: 'Nothing changed.',
      stays: null,
    })
  })
})
