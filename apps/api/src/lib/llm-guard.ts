import type { Db } from 'mongodb'
import { LlmBudgetGuard } from '@kairos/platform'

export async function guardLlmBudget(
  db: Db | undefined,
  tenantId: string,
  detectorId?: string,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  if (!db) return { allowed: true }

  const guard = new LlmBudgetGuard(db)
  const decision = await guard.check(tenantId, detectorId)
  if (!decision.allowed) {
    return { allowed: false, reason: decision.reason ?? 'LLM budget exhausted' }
  }
  return { allowed: true }
}
