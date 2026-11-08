/**
 * Where a new account lands. The landing page promises "Start your family's list", so the default is
 * the family list, not the money page. A money question picked on the landing page rides along as
 * ?brief=<id> and lands on that question; only a plain catalogue-style id is accepted, never a path.
 */
const BRIEF_ID = /^[a-z0-9_]{1,40}$/

/** The family list: where "Start your family's list" leads. */
export const FAMILY_LIST_HOME = '/domains'

export function signupDestination(brief: string | null, next: string | null): string {
  if (next) return next
  if (brief && BRIEF_ID.test(brief)) return `/briefs?start=${brief}`
  return FAMILY_LIST_HOME
}

/**
 * Pages a brand-new account may land on. Its household is created quietly there (same as "Skip for
 * now") instead of stopping the person at a set-up screen first.
 */
export function isFirstStepPath(pathname: string): boolean {
  return pathname.startsWith('/domains') || pathname.startsWith('/briefs')
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
