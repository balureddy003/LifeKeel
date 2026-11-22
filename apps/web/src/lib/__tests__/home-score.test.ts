import { describe, expect, it } from 'vitest'
import { shouldShowScore } from '../home-score'

describe('shouldShowScore', () => {
  it('hides a score of zero, which on a new family means nothing has been read yet', () => {
    expect(shouldShowScore({ score: 0, hasLiveData: true })).toBe(false)
  })
  it('hides it with no live data, however the number reads', () => {
    expect(shouldShowScore({ score: 72, hasLiveData: false })).toBe(false)
  })
  it('hides a score that is not a number', () => {
    expect(shouldShowScore({ score: Number.NaN, hasLiveData: true })).toBe(false)
    expect(shouldShowScore({ score: undefined as unknown as number, hasLiveData: true })).toBe(
      false,
    )
  })
  it('shows a real score once there is data behind it', () => {
    expect(shouldShowScore({ score: 41, hasLiveData: true })).toBe(true)
    expect(shouldShowScore({ score: 100, hasLiveData: true })).toBe(true)
  })
})
