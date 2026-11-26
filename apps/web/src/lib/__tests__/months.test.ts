/** One month format on every screen: whole months, rounded down, matching the server. */
import { describe, expect, it } from 'vitest'
import { coverMonths } from '../months'
import { coverMonths as serverCoverMonths } from '../../../../api/src/format/months'

describe('coverMonths', () => {
  it('rounds down to whole months, so 2.5 reads as about 2 everywhere', () => {
    expect(coverMonths(2.5)).toBe('about 2 months')
    expect(coverMonths(1.9)).toBe('about 1 month')
    expect(coverMonths(0.6)).toBe('less than a month')
    expect(coverMonths(Number.NaN)).toBe('less than a month')
    expect(coverMonths(61)).toBe('more than five years')
  })

  it('says the same as the server for anything up to five years', () => {
    for (const m of [0.4, 1, 1.5, 2.5, 3, 7.9, 12.2, 59.9])
      expect(coverMonths(m)).toBe(serverCoverMonths(m))
  })
})
