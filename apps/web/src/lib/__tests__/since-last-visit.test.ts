import { describe, expect, it } from 'vitest'
import { sinceLastVisitView } from '../since-last-visit'

const base = { score: 50, openInsightCount: 2, hasLiveData: true, hasProfileData: true }

// "No changes since your last visit" with nothing on file compares nothing to nothing.
describe('sinceLastVisitView', () => {
  it('shows nothing for a household with nothing on file', () => {
    expect(
      sinceLastVisitView({
        ...base,
        previous: { score: 0, openInsightCount: 0 },
        score: 0,
        openInsightCount: 0,
        hasLiveData: false,
        hasProfileData: false,
      }).kind,
    ).toBe('none')
  })

  it('still greets a saved profile whose checks have not run yet (intent 60)', () => {
    const v = sinceLastVisitView({
      ...base,
      hasLiveData: false,
      hasProfileData: true,
      previous: { score: 50, openInsightCount: 2 },
    })
    expect(v.kind).toBe('no_change')
  })

  it('is a first-visit greeting when there is no earlier visit', () => {
    expect(sinceLastVisitView({ ...base, previous: null }).kind).toBe('first')
  })

  it('says no change when score and open insights are the same', () => {
    expect(sinceLastVisitView({ ...base, previous: { score: 50, openInsightCount: 2 } }).kind).toBe(
      'no_change',
    )
  })

  it('narrates the score and insight differences in the existing words', () => {
    const v = sinceLastVisitView({ ...base, previous: { score: 61, openInsightCount: 1 } })
    expect(v).toEqual({
      kind: 'delta',
      text: 'Readiness score down 11 points · 1 new insight to review',
    })
    const up = sinceLastVisitView({ ...base, previous: { score: 49, openInsightCount: 4 } })
    expect(up).toEqual({
      kind: 'delta',
      text: 'Readiness score up 1 point · 2 insights resolved',
    })
  })
})
