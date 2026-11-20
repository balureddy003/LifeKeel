import { describe, expect, it } from 'vitest'
import { boundedQueryInt } from '../query-int.js'

const LIMIT = { fallback: 50, min: 1, max: 100 }

describe('boundedQueryInt (ISSUES M02)', () => {
  it.each([
    [undefined, 50],
    ['', 50],
    ['abc', 50],
    ['0', 1],
    ['-5', 1],
    ['1', 1],
    ['100', 100],
    ['101', 100],
    ['1e9', 1],
    ['9999999999', 100],
    ['25.9', 25],
  ])('limit %s -> %s', (raw, expected) => {
    const n = boundedQueryInt(raw, LIMIT)
    expect(n).toBe(expected)
    expect(Number.isInteger(n)).toBe(true)
  })

  it('never returns a negative offset', () => {
    expect(boundedQueryInt('-20', { fallback: 0, min: 0, max: 10_000 })).toBe(0)
    expect(boundedQueryInt('NaN', { fallback: 0, min: 0, max: 10_000 })).toBe(0)
  })
})
