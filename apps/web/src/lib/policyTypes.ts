import type { PolicyType } from './api'

// Single source of truth for policy-type display labels — shared by the
// Financial Profile wizard's manual entry form and the document-detail
// page's "apply an extracted policy" card, so the two never drift.
export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  life: 'Life',
  income_protection: 'Income Protection',
  health: 'Health',
  critical_illness: 'Critical Illness',
  car: 'Car',
  home: 'Home',
}

export const POLICY_TYPES = Object.keys(POLICY_TYPE_LABELS) as PolicyType[]
