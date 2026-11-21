export interface VisitSnapshot {
  score: number
  openInsightCount: number
}

export type SinceLastVisitView =
  { kind: 'none' } | { kind: 'first' } | { kind: 'no_change' } | { kind: 'delta'; text: string }

/**
 * What the "since your last visit" card says, decided apart from drawing it. It says nothing for a
 * household with nothing on file (there is nothing to compare). A saved profile whose checks have
 * not run yet still gets the greeting (intent 60). The wording of the differences is unchanged.
 */
export function sinceLastVisitView(input: {
  previous: VisitSnapshot | null
  score: number
  openInsightCount: number
  hasLiveData: boolean
  hasProfileData: boolean
}): SinceLastVisitView {
  const { previous, score, openInsightCount, hasLiveData, hasProfileData } = input
  if (!hasLiveData && !hasProfileData) return { kind: 'none' }
  if (!previous) return { kind: 'first' }

  const scoreDelta = score - previous.score
  const insightDelta = openInsightCount - previous.openInsightCount
  if (scoreDelta === 0 && insightDelta === 0) return { kind: 'no_change' }

  const parts: string[] = []
  if (scoreDelta !== 0) {
    parts.push(
      `Readiness score ${scoreDelta > 0 ? 'up' : 'down'} ${Math.abs(scoreDelta)} point${Math.abs(scoreDelta) === 1 ? '' : 's'}`,
    )
  }
  if (insightDelta > 0) {
    parts.push(`${insightDelta} new insight${insightDelta === 1 ? '' : 's'} to review`)
  } else if (insightDelta < 0) {
    parts.push(
      `${Math.abs(insightDelta)} insight${Math.abs(insightDelta) === 1 ? '' : 's'} resolved`,
    )
  }
  return { kind: 'delta', text: parts.join(' · ') }
}
