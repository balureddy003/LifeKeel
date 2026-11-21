import { describe, it, expect } from 'vitest'
import {
  visibleSetupSteps,
  readDismissed,
  withDismissed,
  SETUP_DISMISSED_KEY,
} from '../setup-cards'

const steps = [
  { id: 'brief', done: false },
  { id: 'upload', done: true },
  { id: 'profile', done: false },
]

describe('visibleSetupSteps', () => {
  it('hides finished steps', () => {
    expect(visibleSetupSteps(steps, []).map((s) => s.id)).toEqual(['brief', 'profile'])
  })
  it('hides dismissed steps', () => {
    expect(visibleSetupSteps(steps, ['brief']).map((s) => s.id)).toEqual(['profile'])
  })
  it('is empty when every step is done or dismissed', () => {
    expect(visibleSetupSteps(steps, ['brief', 'profile'])).toEqual([])
  })
})

describe('dismissed storage', () => {
  it('reads a stored list and ignores junk', () => {
    expect(
      readDismissed({ getItem: (k) => (k === SETUP_DISMISSED_KEY ? '["a","b"]' : null) }),
    ).toEqual(['a', 'b'])
    expect(readDismissed({ getItem: () => '{oops' })).toEqual([])
    expect(readDismissed({ getItem: () => '{"a":1}' })).toEqual([])
    expect(readDismissed(null)).toEqual([])
  })
  it('adds an id once', () => {
    expect(withDismissed(['a'], 'b')).toEqual(['a', 'b'])
    expect(withDismissed(['a'], 'a')).toEqual(['a'])
  })
})
