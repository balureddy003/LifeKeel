import { describe, expect, it } from 'vitest'
import { childHomeCopy } from '../childHomeCopy'

describe('live-verification finding: childHomeCopy no longer claims things unconditionally', () => {
  it('shows a loading state while the profile is still loading', () => {
    expect(childHomeCopy({ loading: true, hasLiveData: false })).toEqual({ subheadline: 'Checking in...' })
  })

  it('shows a neutral "just getting started" subheadline before any financial profile exists', () => {
    expect(childHomeCopy({ loading: false, hasLiveData: false })).toEqual({
      subheadline: "Your family's just getting started",
    })
  })

  it('shows the reassuring subheadline once a family plan actually exists', () => {
    expect(childHomeCopy({ loading: false, hasLiveData: true })).toEqual({
      subheadline: 'Your future is looking bright',
    })
  })
})
