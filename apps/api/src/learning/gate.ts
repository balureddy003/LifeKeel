/**
 * The switch for cross-tenant learning (intent 96, CLAUDE.md rule 3). Fails closed: it opens only with the
 * flag AND a recorded privacy-review reference. Rule 3 stays in force; this only decides whether the
 * consent-based plumbing may run at all. Pure.
 */
export interface LearningGate {
  open: boolean
  reason: string
}

export function learningGate(env: Record<string, string | undefined>): LearningGate {
  if (env['LIFEKEEL_CROSS_TENANT_LEARNING'] !== 'true')
    return { open: false, reason: 'cross-tenant learning is off' }
  if (!env['LEARNING_PRIVACY_REVIEW_REF']?.trim())
    return {
      open: false,
      reason: 'cross-tenant learning needs a recorded privacy review reference before it can run',
    }
  return { open: true, reason: 'enabled with a recorded privacy review' }
}
