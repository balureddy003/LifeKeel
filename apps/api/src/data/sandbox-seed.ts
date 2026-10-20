/**
 * Sandbox Seed Data
 *
 * Sample data for sandbox mode to show users what LifeKeel looks like
 * before they connect real data sources.
 *
 * Includes:
 * - 3 sample goals (emergency fund, retirement readiness, estate readiness)
 * - 10 sample insights with varied states
 * - 3 sample workflows with attribution data
 * - 3 sample verified moments with evidence
 *
 * Every detector_id/rule_id pair mirrors a real rule in detectors/family/*.yaml
 * and every category matches what Detector.inferCategory() + category-table.yaml
 * assign for that rule, so the demo reads as the real product rather than a
 * different vertical's data.
 */

export interface SandboxGoal {
  id: string
  name: string
  description: string
  timeline_days: number
  start_date: string
  target_date: string
  kpis: Array<{
    metric: string
    label: string
    unit: string
    target: number
    current: number
    direction: 'increase' | 'decrease'
    source: 'signals'
  }>
  status: 'active' | 'achieved' | 'stalled'
  detector_ids: string[]
}

export interface SandboxInsight {
  id: string
  detector_id: string
  rule_id: string
  /** Matches the real insight lifecycle vocabulary (identified/completed/dismissed) — not the
   *  generic 'pending'/'approved' this used to say, which no real insight document ever has. */
  state: 'identified' | 'completed' | 'dismissed'
  confidence_breakdown: {
    or_score: number
    combined_score: number
  }
  urgency: 'low' | 'medium' | 'high' | 'critical'
  category: string
  reasoning: string
  actions: Array<{
    type: string
    status: 'pending' | 'completed' | 'failed'
  }>
  created_at: string
  goal_id?: string
}

export interface SandboxWorkflow {
  id: string
  name: string
  description: string
  runs_count: number
  attribution: {
    total_value_minor_units: number
    conversion_rate: number
    causal_lift_days: number
  }
  created_at: string
}

export interface SandboxVerifiedMoment {
  id: string
  tenant_id: string
  name: string
  description: string
  category: string
  evidence: {
    before_value: number
    after_value: number
    unit: string
    confidence: number
  }
  workflow_id: string
  detector_id: string
  created_at: string
  verified: boolean
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
const daysAhead = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString()

export const SANDBOX_GOALS: SandboxGoal[] = [
  {
    id: 'goal_emergency_fund',
    name: 'Build a 6-Month Emergency Fund',
    description: 'Grow emergency savings to cover six months of household expenses',
    timeline_days: 365,
    start_date: daysAgo(120),
    target_date: daysAhead(245),
    kpis: [
      {
        metric: 'months_of_cover',
        label: 'Months of expenses covered',
        unit: 'months',
        target: 6,
        current: 1.8,
        direction: 'increase',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['family_emergency_fund_adequacy', 'family_emergency_trajectory'],
  },
  {
    id: 'goal_retirement_readiness',
    name: 'Close the Retirement Gap',
    description: 'Bring projected retirement income in line with the household target',
    timeline_days: 730,
    start_date: daysAgo(90),
    target_date: daysAhead(640),
    kpis: [
      {
        metric: 'projected_income_vs_target_pct',
        label: 'Projected income vs target',
        unit: 'percent',
        target: 100,
        current: 62,
        direction: 'increase',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['family_retirement_gap'],
  },
  {
    id: 'goal_estate_readiness',
    name: 'Get Estate Documents in Order',
    description: 'Make sure the family\'s key estate documents exist and are findable in the vault',
    timeline_days: 180,
    start_date: daysAgo(30),
    target_date: daysAhead(150),
    kpis: [
      {
        metric: 'estate_documents_on_file',
        label: 'Estate documents on file',
        unit: 'documents',
        target: 5,
        current: 2,
        direction: 'increase',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['family_estate_readiness'],
  },
]

export const SANDBOX_INSIGHTS: SandboxInsight[] = [
  {
    id: 'insight_family_001',
    detector_id: 'family_emergency_fund_adequacy',
    rule_id: 'emergency_fund_below_3_months',
    state: 'identified',
    confidence_breakdown: { or_score: 0.88, combined_score: 0.88 },
    urgency: 'high',
    category: 'risk',
    reasoning:
      'Your emergency savings of £3,200 cover approximately 1.8 months of expenses. A common guideline is 3–6 months. This is an informational estimate — consider reviewing with a qualified financial professional.',
    actions: [
      { type: 'review_monthly_budget', status: 'pending' },
      { type: 'set_up_automatic_transfer', status: 'pending' },
    ],
    created_at: daysAgo(1),
    goal_id: 'goal_emergency_fund',
  },
  {
    id: 'insight_family_002',
    detector_id: 'family_emergency_fund_adequacy',
    rule_id: 'high_interest_debt_unaddressed',
    state: 'identified',
    confidence_breakdown: { or_score: 0.7, combined_score: 0.7 },
    urgency: 'high',
    category: 'experience',
    reasoning:
      'Your profile lists high-interest debt of £4,800 outstanding. At typical high-interest rates this could cost £720 to £1,200 per year in interest alone. This is an informational estimate — consider reviewing repayment options with a qualified financial professional.',
    actions: [
      { type: 'list_high_interest_debts', status: 'pending' },
      { type: 'consult_financial_advisor', status: 'pending' },
    ],
    created_at: daysAgo(2),
    goal_id: 'goal_emergency_fund',
  },
  {
    id: 'insight_family_003',
    detector_id: 'family_retirement_gap',
    rule_id: 'retirement_behind_target_age',
    state: 'identified',
    confidence_breakdown: { or_score: 0.81, combined_score: 0.81 },
    urgency: 'medium',
    category: 'risk',
    reasoning:
      'On current contributions, projected retirement income covers roughly 62% of your household target — behind the pace implied by your target retirement age. This is an informational estimate — consider reviewing with a qualified financial professional.',
    actions: [
      { type: 'gather_pension_statements', status: 'pending' },
      { type: 'review_contribution_level', status: 'pending' },
    ],
    created_at: daysAgo(4),
    goal_id: 'goal_retirement_readiness',
  },
  {
    id: 'insight_family_004',
    detector_id: 'family_protection_gap',
    rule_id: 'life_insurance_below_household_needs',
    state: 'identified',
    confidence_breakdown: { or_score: 0.84, combined_score: 0.84 },
    urgency: 'high',
    category: 'risk',
    reasoning:
      'Life insurance cover on file (£50,000) is well below the estimated household need based on the income and dependants in your profile. This is an informational estimate — compare quotes from multiple insurers or speak to a licensed professional.',
    actions: [
      { type: 'review_cover_amount', status: 'pending' },
      { type: 'compare_quotes', status: 'pending' },
    ],
    created_at: daysAgo(6),
  },
  {
    id: 'insight_family_005',
    detector_id: 'family_estate_readiness',
    rule_id: 'estate_no_will',
    state: 'identified',
    confidence_breakdown: { or_score: 0.9, combined_score: 0.9 },
    urgency: 'medium',
    category: 'experience',
    reasoning:
      'No will is on file for this household. Without one, your wishes may not be followed and settling an estate can take longer for the people you leave behind. Consider speaking to a qualified legal professional.',
    actions: [
      { type: 'collect_estate_documents', status: 'pending' },
      { type: 'schedule_review', status: 'pending' },
    ],
    created_at: daysAgo(9),
    goal_id: 'goal_estate_readiness',
  },
  {
    id: 'insight_family_006',
    detector_id: 'family_policy_review',
    rule_id: 'policy_renewal_window',
    state: 'identified',
    confidence_breakdown: { or_score: 0.95, combined_score: 0.95 },
    urgency: 'low',
    category: 'experience',
    reasoning:
      'The home insurance policy on file renews in 28 days — a review window is open to confirm the cover details are still accurate for the household.',
    actions: [
      { type: 'review_policy_details', status: 'pending' },
      { type: 'update_policy_renewal_date', status: 'pending' },
    ],
    created_at: daysAgo(12),
  },
  {
    id: 'insight_family_007',
    detector_id: 'family_education_shortfall',
    rule_id: 'education_fund_behind_target',
    state: 'identified',
    confidence_breakdown: { or_score: 0.76, combined_score: 0.76 },
    urgency: 'medium',
    category: 'risk',
    reasoning:
      'The education fund on file is behind the pace needed to reach its target by the stated date at the current monthly contribution. This is an informational estimate — consider reviewing with a qualified financial professional.',
    actions: [
      { type: 'review_monthly_contribution', status: 'pending' },
      { type: 'update_target', status: 'pending' },
    ],
    created_at: daysAgo(15),
  },
  {
    id: 'insight_family_008',
    detector_id: 'family_debt_health',
    rule_id: 'debt_to_income_above_guideline',
    state: 'dismissed',
    confidence_breakdown: { or_score: 0.73, combined_score: 0.73 },
    urgency: 'medium',
    category: 'experience',
    reasoning:
      'Household debt repayments appear to be above the guideline share of monthly income on file. This is an informational estimate — consider reviewing with a qualified financial professional.',
    actions: [{ type: 'review_debt_schedule', status: 'pending' }],
    created_at: daysAgo(20),
  },
  {
    id: 'insight_family_009',
    detector_id: 'family_emergency_trajectory',
    rule_id: 'emergency_fund_stalled',
    state: 'identified',
    confidence_breakdown: { or_score: 0.79, combined_score: 0.79 },
    urgency: 'low',
    category: 'experience',
    reasoning:
      'Monthly contributions to the emergency fund appear to have paused for two months — the fund is no longer on pace for its goal.',
    actions: [{ type: 'resume_monthly_transfer', status: 'pending' }],
    created_at: daysAgo(25),
    goal_id: 'goal_emergency_fund',
  },
  {
    id: 'insight_family_010',
    detector_id: 'family_emergency_fund_adequacy',
    rule_id: 'emergency_fund_overfunded',
    state: 'completed',
    confidence_breakdown: { or_score: 0.72, combined_score: 0.72 },
    urgency: 'low',
    category: 'goal_progress',
    reasoning:
      'Emergency savings on file now cover more than the 6-month guideline. One option to consider is whether surplus cash above that level is working as hard as it could. This is an informational estimate — consider reviewing with a qualified financial professional.',
    actions: [{ type: 'redirect_surplus_review', status: 'completed' }],
    created_at: daysAgo(35),
    goal_id: 'goal_emergency_fund',
  },
]

export const SANDBOX_WORKFLOWS: SandboxWorkflow[] = [
  {
    id: 'workflow_policy_renewal_watch',
    name: 'Policy Renewal Watch',
    description: 'Watches policy renewal dates on file and drafts a reminder before each window opens',
    runs_count: 14,
    attribution: {
      total_value_minor_units: 210000, // £2,100
      conversion_rate: 0.31,
      causal_lift_days: 9,
    },
    created_at: daysAgo(60),
  },
  {
    id: 'workflow_document_expiry_monitor',
    name: 'Document Expiry Monitor',
    description: 'Flags vault documents nearing expiry and reminds the family to renew them',
    runs_count: 22,
    attribution: {
      total_value_minor_units: 140000, // £1,400
      conversion_rate: 0.45,
      causal_lift_days: 5,
    },
    created_at: daysAgo(75),
  },
  {
    id: 'workflow_monthly_family_review',
    name: 'Monthly Financial Profile Review',
    description: 'Re-checks the financial profile each month and surfaces new readiness gaps',
    runs_count: 6,
    attribution: {
      total_value_minor_units: 380000, // £3,800
      conversion_rate: 0.52,
      causal_lift_days: 14,
    },
    created_at: daysAgo(40),
  },
]

export const SANDBOX_VERIFIED_MOMENTS: SandboxVerifiedMoment[] = [
  {
    id: 'moment_family_001',
    tenant_id: 'sandbox_tenant',
    name: 'Emergency Fund Milestone',
    description: 'Emergency savings grew from 1.8 to 3.2 months of household expenses covered',
    category: 'readiness',
    evidence: {
      before_value: 1.8,
      after_value: 3.2,
      unit: 'months_of_cover',
      confidence: 0.9,
    },
    workflow_id: 'workflow_monthly_family_review',
    detector_id: 'family_emergency_fund_adequacy',
    created_at: daysAgo(10),
    verified: true,
  },
  {
    id: 'moment_family_002',
    tenant_id: 'sandbox_tenant',
    name: 'Policy Reviewed Ahead of Renewal',
    description: 'Home insurance cover was reviewed and confirmed 21 days before the renewal date',
    category: 'readiness',
    evidence: {
      before_value: 0,
      after_value: 21,
      unit: 'days_before_renewal',
      confidence: 0.86,
    },
    workflow_id: 'workflow_policy_renewal_watch',
    detector_id: 'family_policy_review',
    created_at: daysAgo(18),
    verified: true,
  },
  {
    id: 'moment_family_003',
    tenant_id: 'sandbox_tenant',
    name: 'Estate Pack Filed in the Vault',
    description: 'Key estate documents on file grew from 2 to 5 — will, PoA, and insurance schedules now findable',
    category: 'readiness',
    evidence: {
      before_value: 2,
      after_value: 5,
      unit: 'documents_on_file',
      confidence: 0.93,
    },
    workflow_id: 'workflow_document_expiry_monitor',
    detector_id: 'family_estate_readiness',
    created_at: daysAgo(7),
    verified: true,
  },
]

/**
 * Outward-facing shape of a sandbox insight — matches the real Insight
 * contract's `actions: string[]` that every renderer in the app assumes.
 * SandboxInsight above keeps the richer `{type, status}` authoring shape for
 * internal use; this is where it gets flattened before ever reaching an API
 * response.
 */
export type SandboxInsightApi = Omit<SandboxInsight, 'actions'> & { actions: string[] }

function humanizeActionType(type: string): string {
  return type.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function toApiInsight(insight: SandboxInsight): SandboxInsightApi {
  return {
    ...insight,
    actions: insight.actions.map((a) => {
      const label = humanizeActionType(a.type)
      return a.status === 'completed' ? `${label} (done)` : a.status === 'failed' ? `${label} (failed)` : label
    }),
  }
}

export function getSandboxData(type: 'goals'): SandboxGoal[]
export function getSandboxData(type: 'insights'): SandboxInsightApi[]
export function getSandboxData(type: 'workflows'): SandboxWorkflow[]
export function getSandboxData(type: 'verified_moments'): SandboxVerifiedMoment[]
export function getSandboxData(
  type: 'goals' | 'insights' | 'workflows' | 'verified_moments',
): SandboxGoal[] | SandboxInsightApi[] | SandboxWorkflow[] | SandboxVerifiedMoment[] {
  switch (type) {
    case 'goals':
      return SANDBOX_GOALS
    case 'insights':
      return SANDBOX_INSIGHTS.map(toApiInsight)
    case 'workflows':
      return SANDBOX_WORKFLOWS
    case 'verified_moments':
      return SANDBOX_VERIFIED_MOMENTS
    default:
      return []
  }
}
