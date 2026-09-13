// OAK-027: ElderlyHome's headline used to be hardcoded to "You're Safe" /
// "Your family appears well covered" regardless of the real score rendered
// two lines below it — a genuine 0/100 account was told, unconditionally,
// that it was safe. Mirrors the default (organizer) home's existing
// hasLiveData/score-conditional copy selection, in the simpler language
// elderly mode is for. Kept in its own module (not exported from page.tsx)
// since Next.js only allows specific named exports from a route file.
export function elderlyHomeCopy({ loading, hasLiveData, score }: { loading: boolean; hasLiveData: boolean; score: number }): { headline: string; subheadline: string } {
  if (loading) return { headline: 'Checking In...', subheadline: '' }
  if (!hasLiveData) return { headline: "Let's Get Started", subheadline: 'Add your information to see how your family is doing' }
  if (score >= 70) return { headline: "You're Safe", subheadline: 'Your family appears well covered' }
  return { headline: 'A Few Things Need Attention', subheadline: 'Some parts of your plan could use a closer look' }
}
