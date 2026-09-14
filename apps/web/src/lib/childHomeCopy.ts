// Live-verification finding: ChildHome's subheadline was hardcoded to
// "Your future is looking bright" unconditionally — before any family
// financial profile even existed. Child mode deliberately shows no money
// figures or score to kids ("No money shown" in Settings), so unlike
// elderlyHomeCopy this intentionally does NOT gate on the family's score —
// only on whether a plan exists at all, which is the one thing safe to say
// without exposing (or fabricating a read on) the family's real finances.
export function childHomeCopy({ loading, hasLiveData }: { loading: boolean; hasLiveData: boolean }): { subheadline: string } {
  if (loading) return { subheadline: 'Checking in...' }
  if (!hasLiveData) return { subheadline: "Your family's just getting started" }
  return { subheadline: 'Your future is looking bright' }
}
