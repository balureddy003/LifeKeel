import { describe, expect, it } from 'vitest'
import { elderlyHomeCopy } from '../elderlyHomeCopy'

describe('OAK-027: elderlyHomeCopy never claims "safe" when the real score says otherwise', () => {
  it('shows a loading state while the score is still loading', () => {
    expect(elderlyHomeCopy({ loading: true, hasLiveData: false, score: 0 })).toEqual({
      headline: 'Checking In...',
      subheadline: '',
    })
  })

  it('shows a neutral "get started" state when there is no live data yet — never "safe"', () => {
    const { headline, subheadline } = elderlyHomeCopy({ loading: false, hasLiveData: false, score: 0 })
    expect(headline).not.toContain('Safe')
    expect(subheadline).not.toContain('well covered')
    expect(headline).toBe("Let's Get Started")
  })

  it('shows the reassuring headline only when live data backs a genuinely good score', () => {
    expect(elderlyHomeCopy({ loading: false, hasLiveData: true, score: 85 })).toEqual({
      headline: "You're Safe",
      subheadline: 'Your family appears well covered',
    })
  })

  it('does NOT claim "safe" for a real, low score — the exact bug found in the mobile audit (0/100 said "safe")', () => {
    const { headline, subheadline } = elderlyHomeCopy({ loading: false, hasLiveData: true, score: 0 })
    expect(headline).not.toBe("You're Safe")
    expect(subheadline).not.toBe('Your family appears well covered')
    expect(headline).toBe('A Few Things Need Attention')
  })

  it('treats 70 as the same on-track threshold the default (organizer) home uses', () => {
    expect(elderlyHomeCopy({ loading: false, hasLiveData: true, score: 70 }).headline).toBe("You're Safe")
    expect(elderlyHomeCopy({ loading: false, hasLiveData: true, score: 69 }).headline).toBe('A Few Things Need Attention')
  })
})
