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

/** Plain-words problem names for the entries offered on the landing page. */
const BRIEF_PROBLEMS: Record<string, string> = {
  income_stops: 'One of us might stop earning',
  earning_less: 'Someone is about to earn less',
  handover_gap: 'The other adult does not know',
  mortgage_fix: 'Our mortgage fix is ending',
  fees_start: 'Nursery or school fees are starting',
  job_change: 'A job change or notice period',
}

/** The problem the visitor picked, or null for anything we do not name. */
export function signupProblem(brief: string | null): string | null {
  return brief && BRIEF_ID.test(brief) ? (BRIEF_PROBLEMS[brief] ?? null) : null
}
