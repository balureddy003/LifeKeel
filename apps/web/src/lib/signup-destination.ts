/**
 * Where a new account lands. The landing page promises a first brief, so the
 * default is the briefs page, not the family-setup quiz (which stays one tap
 * away from the home card). A question picked on the landing page rides along
 * as ?brief=<id>; only a plain catalogue-style id is accepted, never a path.
 */
const BRIEF_ID = /^[a-z0-9_]{1,40}$/

export function signupDestination(brief: string | null, next: string | null): string {
  if (next) return next
  if (brief && BRIEF_ID.test(brief)) return `/briefs?start=${brief}`
  return '/briefs'
}
