/**
 * Which policies on file bear on the event a family has just hit, so the steps
 * page can lead with "your policy, and who to call". It states what is on file;
 * it never says whether the cover is enough or what to claim.
 */
import type { LifeEventType, FinancialProfilePolicy } from './api'

type PolicyType = FinancialProfilePolicy['type']

const RELEVANT: Partial<Record<LifeEventType, PolicyType[]>> = {
  bereavement: ['life'],
  medical: ['critical_illness', 'income_protection'],
  disability: ['income_protection', 'critical_illness'],
  job_loss: ['income_protection'],
}

export function emergencyPolicies(
  eventType: LifeEventType,
  policies: FinancialProfilePolicy[] | undefined,
): { applies: boolean; matches: FinancialProfilePolicy[] } {
  const types = RELEVANT[eventType]
  if (!types) return { applies: false, matches: [] }
  return { applies: true, matches: (policies ?? []).filter((p) => types.includes(p.type)) }
}

export const POLICY_TYPE_LABEL: Record<string, string> = {
  life: 'Life cover',
  income_protection: 'Income protection',
  critical_illness: 'Critical illness cover',
}
