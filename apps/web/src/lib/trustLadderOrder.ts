/**
 * Personalizes which incomplete Trust Ladder step surfaces first, instead
 * of the same fixed Day1→Month3 order regardless of what's actually true
 * for this family. Extracted as a pure function (see age.ts/evaluate-
 * profile.ts for the same pattern) so the ordering logic is unit-testable
 * without rendering Intelligence.tsx's TrustLadder component.
 *
 * Deliberately promotes only two cases with a real, defensible mapping to
 * an existing signal — a step whose completion doesn't clearly close a
 * detected gap keeps its original position rather than being reshuffled
 * on a guess.
 */

export interface TrustLadderStepLike {
  id: string
  status: 'done' | 'available' | 'locked'
}

export interface TrustLadderOrderContext {
  /** Any family member with status 'pending' — half-onboarded, so every other number is less trustworthy while true. */
  hasPendingMembers: boolean
  /** detector_ids with a currently open (non-resolved) insight. */
  openDetectorIds: Set<string>
}

function priority(step: TrustLadderStepLike, ctx: TrustLadderOrderContext): number {
  if (step.id === 'family' && ctx.hasPendingMembers) return 0
  if (step.id === 'investments' && ctx.openDetectorIds.has('family_retirement_gap')) return 1
  return 2
}

/**
 * Returns the incomplete steps, personalized-priority first. Uses a stable
 * sort, so within a priority tier the original fixed order is preserved —
 * this only ever promotes a step, never reshuffles the rest arbitrarily.
 */
export function orderIncompleteTrustLadderSteps<T extends TrustLadderStepLike>(
  steps: T[],
  ctx: TrustLadderOrderContext,
): T[] {
  return steps.filter((s) => s.status !== 'done').sort((a, b) => priority(a, ctx) - priority(b, ctx))
}
