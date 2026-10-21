// UAT P8: SinceLastVisit's first-visit greeting used to read "Everything
// looks stable." unconditionally — including the very first visit after
// onboarding, when a just-evaluated profile can sit at readiness 0 with
// open gaps. The stable claim is now gated on the same condition the
// score card uses for "You're on track" (no open insights, score >= 70).
export function firstVisitSubline({
  score,
  openInsightCount,
}: {
  score: number
  openInsightCount: number
}): string {
  return openInsightCount === 0 && score >= 70
    ? 'Everything looks stable.'
    : 'A few things need attention — your score has the details.'
}
