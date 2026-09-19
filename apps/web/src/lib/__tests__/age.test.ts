import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { calculateAge, yearsUntil } from '../age'

describe('calculateAge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('counts a full elapsed year when the birthday already passed this year', () => {
    expect(calculateAge('2016-03-01')).toBe(10)
  })

  it('does not count this year until the birthday arrives', () => {
    expect(calculateAge('2016-12-25')).toBe(9)
  })

  it('counts the birthday itself as the new age', () => {
    expect(calculateAge('2016-09-19')).toBe(10)
  })

  it('never returns a negative age', () => {
    expect(calculateAge('2027-01-01')).toBe(0)
  })
})

describe('yearsUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns years remaining until the target age', () => {
    expect(yearsUntil('2016-03-01', 18)).toBe(8)
  })

  it('floors at 0 once the target age has already passed', () => {
    expect(yearsUntil('2000-01-01', 18)).toBe(0)
  })
})
