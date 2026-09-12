/**
 * Sandbox Seed Data
 * 
 * Sample data for sandbox mode to show users what Kairos looks like
 * before they connect real data sources.
 * 
 * Includes:
 * - 3 sample goals (invoice recovery, churn prevention, trial conversion)
 * - 20 sample insights with varied states
 * - 5 sample workflows with attribution data
 * - 3 sample verified moments with evidence
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
  /** Which vertical this sample represents — see getSandboxData()'s filter. */
  vertical: string
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
  vertical: string
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
  vertical: string
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
  vertical: string
}

export const SANDBOX_GOALS: SandboxGoal[] = [
  {
    id: 'goal_invoice_recovery',
    name: 'Reduce Overdue Invoices',
    description: 'Recover overdue invoices and improve cash flow',
    timeline_days: 90,
    start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    target_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    kpis: [
      {
        metric: 'total_overdue_amount',
        label: 'Total Overdue',
        unit: 'GBP',
        target: 70000,
        current: 100000,
        direction: 'decrease',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['detector_overdue_invoice'],
    vertical: 'smb-operations',
  },
  {
    id: 'goal_churn_prevention',
    name: 'Reduce Customer Churn',
    description: 'Identify at-risk customers and prevent churn',
    timeline_days: 180,
    start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    target_date: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
    kpis: [
      {
        metric: 'churn_rate',
        label: 'Churn Rate',
        unit: 'percent',
        target: 0.05,
        current: 0.12,
        direction: 'decrease',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['detector_churn_risk'],
    vertical: 'smb-operations',
  },
  {
    id: 'goal_trial_conversion',
    name: 'Improve Trial Conversion',
    description: 'Convert free trial users to paid customers',
    timeline_days: 60,
    start_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    target_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    kpis: [
      {
        metric: 'trial_conversion_rate',
        label: 'Trial Conversion',
        unit: 'percent',
        target: 0.25,
        current: 0.15,
        direction: 'increase',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['detector_trial_risk'],
    vertical: 'smb-operations',
  },
  {
    id: 'goal_compound_growth_demo',
    name: 'Compound Portfolio Growth',
    description: 'Aggressive compounding plan for a Trading 212 portfolio — Trading & Investment vertical sample.',
    timeline_days: 365,
    start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    target_date: new Date(Date.now() + 275 * 24 * 60 * 60 * 1000).toISOString(),
    kpis: [
      {
        metric: 'portfolio_value_minor',
        label: 'Portfolio value',
        unit: 'minor_currency',
        target: 450000,
        current: 312000,
        direction: 'increase',
        source: 'signals',
      },
      {
        metric: 'max_drawdown_pct',
        label: 'Maximum drawdown',
        unit: 'percent',
        target: 20,
        current: 8.5,
        direction: 'decrease',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['trading_concentration_risk', 'trading_price_drop_alert', 'trading_rebalance_suggestion'],
    vertical: 'trading-investment',
  },
  {
    id: 'goal_property_yield_demo',
    name: 'Grow Buy-to-Let Net Yield',
    description: 'Lift portfolio net rental yield by closing per-property yield gaps and catching refinance windows — Property & Wealth vertical sample.',
    timeline_days: 180,
    start_date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    target_date: new Date(Date.now() + 135 * 24 * 60 * 60 * 1000).toISOString(),
    kpis: [
      {
        metric: 'portfolio_net_yield_pct',
        label: 'Net Rental Yield',
        unit: 'percent',
        target: 6.5,
        current: 5.1,
        direction: 'increase',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['property_yield_gap', 'property_price_drop', 'property_refinance_window'],
    vertical: 'property-wealth',
  },
  {
    id: 'goal_social_growth_demo',
    name: 'Grow presence on X',
    description: 'Publish useful content consistently and improve reach and engagement — Audience & Brand Growth vertical sample.',
    timeline_days: 90,
    start_date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    target_date: new Date(Date.now() + 70 * 24 * 60 * 60 * 1000).toISOString(),
    kpis: [
      {
        metric: 'twitter_followers',
        label: 'X followers',
        unit: 'followers',
        target: 100,
        current: 62,
        direction: 'increase',
        source: 'signals',
      },
      {
        metric: 'twitter_engagement_rate',
        label: 'X engagement rate',
        unit: 'ratio',
        target: 0.03,
        current: 0.018,
        direction: 'increase',
        source: 'signals',
      },
      {
        metric: 'twitter_impressions',
        label: 'X impressions',
        unit: 'impressions',
        target: 10000,
        current: 6200,
        direction: 'increase',
        source: 'signals',
      },
    ],
    status: 'active',
    detector_ids: ['social_engagement_drop', 'social_post_performance_spike', 'social_goal_progress'],
    vertical: 'audience-growth',
  },
]

export const SANDBOX_INSIGHTS: SandboxInsight[] = [
  // Trading & Investment vertical samples — mirror the real detector/rule
  // shapes used by concentration-risk, price-drop, and rebalance detectors
  // (see detectors/trading/*.yaml) so this demo reads as the real product,
  // not a different vertical's data shown in the wrong context. Ordered
  // first so a Trading & Investment evaluator's first 3 "recommended
  // positions" are actually trading content, not SMB-ops samples below.
  {
    id: 'insight_trading_001',
    detector_id: 'trading_concentration_risk',
    rule_id: 'position_over_threshold',
    state: 'identified',
    confidence_breakdown: { or_score: 0.85, combined_score: 0.85 },
    urgency: 'high',
    category: 'trading',
    reasoning: 'DEMO_TECH makes up 34% of the portfolio, above the 10% cap from your goal.',
    actions: [{ type: 'rebalance_suggestion', status: 'pending' }],
    created_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_compound_growth_demo',
    vertical: 'trading-investment',
  },
  {
    id: 'insight_trading_002',
    detector_id: 'trading_price_drop_alert',
    rule_id: 'price_drop_below_avg',
    state: 'identified',
    confidence_breakdown: { or_score: 0.8, combined_score: 0.8 },
    urgency: 'medium',
    category: 'trading',
    reasoning: 'DEMO_TECH is down 6.2% vs your average cost, a drop beyond the 5% rule threshold.',
    actions: [{ type: 'review_position', status: 'pending' }],
    created_at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_compound_growth_demo',
    vertical: 'trading-investment',
  },
  {
    id: 'insight_trading_003',
    detector_id: 'trading_rebalance_suggestion',
    rule_id: 'excess_cash',
    state: 'completed',
    confidence_breakdown: { or_score: 0.78, combined_score: 0.78 },
    urgency: 'low',
    category: 'trading',
    reasoning: 'Cash is 14.2% of the portfolio — above the 5% cap. Deploying excess cash may improve long-term returns.',
    actions: [{ type: 'deploy_cash', status: 'completed' }],
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_compound_growth_demo',
    vertical: 'trading-investment',
  },
  {
    id: 'insight_001',
    detector_id: 'detector_overdue_invoice',
    rule_id: 'rule_high_value',
    state: 'completed',
    confidence_breakdown: { or_score: 0.92, combined_score: 0.88 },
    urgency: 'high',
    category: 'revenue',
    reasoning: 'Invoice £5,000 is 45 days overdue. High-value customer with good payment history.',
    actions: [
      { type: 'send_email', status: 'completed' },
    ],
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_invoice_recovery',
    vertical: 'smb-operations',
  },
  {
    id: 'insight_002',
    detector_id: 'detector_overdue_invoice',
    rule_id: 'rule_medium_value',
    state: 'identified',
    confidence_breakdown: { or_score: 0.85, combined_score: 0.82 },
    urgency: 'medium',
    category: 'revenue',
    reasoning: 'Invoice £1,200 is 21 days overdue. Send reminder email.',
    actions: [
      { type: 'send_email', status: 'pending' },
    ],
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_invoice_recovery',
    vertical: 'smb-operations',
  },
  {
    id: 'insight_003',
    detector_id: 'detector_churn_risk',
    rule_id: 'rule_usage_decline',
    state: 'completed',
    confidence_breakdown: { or_score: 0.78, combined_score: 0.75 },
    urgency: 'high',
    category: 'retention',
    reasoning: 'Customer usage declined 40% in 30 days. Risk of churn.',
    actions: [
      { type: 'create_task', status: 'completed' },
    ],
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_churn_prevention',
    vertical: 'smb-operations',
  },
  {
    id: 'insight_004',
    detector_id: 'detector_trial_risk',
    rule_id: 'rule_trial_inactive',
    state: 'dismissed',
    confidence_breakdown: { or_score: 0.65, combined_score: 0.62 },
    urgency: 'low',
    category: 'growth',
    reasoning: 'Trial user inactive for 7 days. Low urgency.',
    actions: [
      { type: 'send_email', status: 'completed' as const },
    ],
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_trial_conversion',
    vertical: 'smb-operations',
  },
  // Add 16 more insights for variety
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `insight_${String(i + 5).padStart(3, '0')}`,
    detector_id: ['detector_overdue_invoice', 'detector_churn_risk', 'detector_trial_risk'][i % 3],
    rule_id: `rule_${i}`,
    state: ['identified', 'completed', 'dismissed'][i % 3] as 'identified' | 'completed' | 'dismissed',
    confidence_breakdown: { or_score: 0.7 + Math.random() * 0.2, combined_score: 0.65 + Math.random() * 0.2 },
    urgency: ['low', 'medium', 'high', 'critical'][i % 4] as 'low' | 'medium' | 'high' | 'critical',
    category: ['revenue', 'retention', 'growth'][i % 3],
    reasoning: `Sample insight ${i + 5} for sandbox demonstration.`,
    actions: [{ type: 'send_email', status: 'pending' as const }],
    created_at: new Date(Date.now() - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: ['goal_invoice_recovery', 'goal_churn_prevention', 'goal_trial_conversion'][i % 3],
    vertical: 'smb-operations',
  })),
  // Property & Wealth vertical samples — mirror the real detector/rule ids
  // in detectors/property/*.yaml so this demo reads as the real product.
  {
    id: 'insight_property_001',
    detector_id: 'property_yield_gap',
    rule_id: 'yield_below_benchmark',
    state: 'identified',
    confidence_breakdown: { or_score: 0.79, combined_score: 0.79 },
    urgency: 'medium',
    category: 'property',
    reasoning: '12 Elm Grove, Manchester nets 4.1% vs the Manchester benchmark of 5.6% — a 1.5pt gap on a £185,000 asset.',
    actions: [{ type: 'review_rent', status: 'pending' }],
    created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_property_yield_demo',
    vertical: 'property-wealth',
  },
  {
    id: 'insight_property_002',
    detector_id: 'property_yield_gap',
    rule_id: 'extended_void',
    state: 'identified',
    confidence_breakdown: { or_score: 0.88, combined_score: 0.88 },
    urgency: 'high',
    category: 'property',
    reasoning: '4 Castle Street, Leeds has been void for 52 days at £950/month of foregone rent.',
    actions: [{ type: 'refresh_listing', status: 'pending' }],
    created_at: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_property_yield_demo',
    vertical: 'property-wealth',
  },
  {
    id: 'insight_property_003',
    detector_id: 'property_refinance_window',
    rule_id: 'fix_ending_rate_drop',
    state: 'identified',
    confidence_breakdown: { or_score: 0.84, combined_score: 0.84 },
    urgency: 'medium',
    category: 'property',
    reasoning: '12 Elm Grove, Manchester mortgage fix ends in 68 days. Current rate 5.4% vs market 4.7% on a £142,000 balance — refinance headroom.',
    actions: [{ type: 'compare_remortgage', status: 'pending' }],
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_property_yield_demo',
    vertical: 'property-wealth',
  },
  // Audience & Brand Growth vertical samples — mirror the real detector/rule
  // ids in detectors/social/*.yaml.
  {
    id: 'insight_social_001',
    detector_id: 'social_engagement_drop',
    rule_id: 'engagement_cusum_down',
    state: 'identified',
    confidence_breakdown: { or_score: 0.82, combined_score: 0.82 },
    urgency: 'medium',
    category: 'social',
    reasoning: 'Your X engagement rate has been trending downward for several posts. Latest: 1.8% (Likes: 12, Comments: 2).',
    actions: [{ type: 'review_content_mix', status: 'pending' }],
    created_at: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_social_growth_demo',
    vertical: 'audience-growth',
  },
  {
    id: 'insight_social_002',
    detector_id: 'social_post_performance_spike',
    rule_id: 'engagement_spike_2sigma',
    state: 'completed',
    confidence_breakdown: { or_score: 0.88, combined_score: 0.88 },
    urgency: 'low',
    category: 'social',
    reasoning: 'Your X post achieved 6.2% engagement rate — significantly above your typical range. Likes: 84 | Comments: 15 | Shares: 22 | Impressions: 3100.',
    actions: [{ type: 'save_content_angle', status: 'completed' }],
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_social_growth_demo',
    vertical: 'audience-growth',
  },
  {
    id: 'insight_social_003',
    detector_id: 'social_goal_progress',
    rule_id: 'goal_behind_pace',
    state: 'identified',
    confidence_breakdown: { or_score: 0.75, combined_score: 0.75 },
    urgency: 'medium',
    category: 'social',
    reasoning: 'X follower growth is behind pace to hit 100 followers by the goal deadline — 62 so far with 32 days left.',
    actions: [{ type: 'adjust_posting_cadence', status: 'pending' }],
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    goal_id: 'goal_social_growth_demo',
    vertical: 'audience-growth',
  },
]

export const SANDBOX_WORKFLOWS: SandboxWorkflow[] = [
  {
    id: 'workflow_invoice_chase',
    name: 'Invoice Recovery Chase',
    description: 'Automatically chase overdue invoices with email reminders',
    runs_count: 45,
    attribution: {
      total_value_minor_units: 4500000, // £4,500
      conversion_rate: 0.35,
      causal_lift_days: 12,
    },
    created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    vertical: 'smb-operations',
  },
  {
    id: 'workflow_churn_intervention',
    name: 'Churn Risk Intervention',
    description: 'Identify at-risk customers and send retention offers',
    runs_count: 28,
    attribution: {
      total_value_minor_units: 12000000, // £12,000
      conversion_rate: 0.42,
      causal_lift_days: 8,
    },
    created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    vertical: 'smb-operations',
  },
  {
    id: 'workflow_trial_nurture',
    name: 'Trial Nurture Sequence',
    description: 'Send onboarding emails to trial users',
    runs_count: 67,
    attribution: {
      total_value_minor_units: 8500000, // £8,500
      conversion_rate: 0.28,
      causal_lift_days: 5,
    },
    created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    vertical: 'smb-operations',
  },
  {
    id: 'workflow_sla_monitor',
    name: 'SLA Breach Monitor',
    description: 'Monitor support tickets for SLA violations',
    runs_count: 15,
    attribution: {
      total_value_minor_units: 3200000, // £3,200
      conversion_rate: 0.55,
      causal_lift_days: 3,
    },
    created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    vertical: 'smb-operations',
  },
  {
    id: 'workflow_payment_reminder',
    name: 'Payment Reminder',
    description: 'Send payment reminders for upcoming invoices',
    runs_count: 52,
    attribution: {
      total_value_minor_units: 6800000, // £6,800
      conversion_rate: 0.38,
      causal_lift_days: 7,
    },
    created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
    vertical: 'smb-operations',
  },
  {
    id: 'workflow_trading_concentration_review',
    name: 'Concentration Risk Review',
    description: 'Flags over-concentrated positions against your goal\'s cap and drafts a rebalance note',
    runs_count: 9,
    attribution: {
      total_value_minor_units: 920000, // £9,200
      conversion_rate: 0.44,
      causal_lift_days: 4,
    },
    created_at: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    vertical: 'trading-investment',
  },
]

export const SANDBOX_VERIFIED_MOMENTS: SandboxVerifiedMoment[] = [
  {
    id: 'moment_001',
    tenant_id: 'sandbox_tenant',
    name: 'Invoice Recovery Success',
    description: 'Recovered £4,500 from overdue invoices in 30 days',
    category: 'revenue',
    evidence: {
      before_value: 100000,
      after_value: 55000,
      unit: 'GBP',
      confidence: 0.92,
    },
    workflow_id: 'workflow_invoice_chase',
    detector_id: 'detector_overdue_invoice',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    verified: true,
    vertical: 'smb-operations',
  },
  {
    id: 'moment_002',
    tenant_id: 'sandbox_tenant',
    name: 'Churn Prevention Success',
    description: 'Prevented 3 high-value customers from churning',
    category: 'retention',
    evidence: {
      before_value: 0.15,
      after_value: 0.08,
      unit: 'churn_rate',
      confidence: 0.85,
    },
    workflow_id: 'workflow_churn_intervention',
    detector_id: 'detector_churn_risk',
    created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    verified: true,
    vertical: 'smb-operations',
  },
  {
    id: 'moment_003',
    tenant_id: 'sandbox_tenant',
    name: 'Trial Conversion Boost',
    description: 'Improved trial conversion by 40% with targeted emails',
    category: 'growth',
    evidence: {
      before_value: 0.15,
      after_value: 0.21,
      unit: 'conversion_rate',
      confidence: 0.78,
    },
    workflow_id: 'workflow_trial_nurture',
    detector_id: 'detector_trial_risk',
    created_at: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    verified: true,
    vertical: 'smb-operations',
  },
  {
    id: 'moment_trading_001',
    tenant_id: 'sandbox_tenant',
    name: 'Concentration Trimmed on Time',
    description: 'Rebalanced DEMO_TECH from 34% to 9% of the portfolio before the next earnings window',
    category: 'trading',
    evidence: {
      before_value: 34,
      after_value: 9,
      unit: 'portfolio_weight_pct',
      confidence: 0.85,
    },
    workflow_id: 'workflow_trading_concentration_review',
    detector_id: 'trading_concentration_risk',
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    verified: true,
    vertical: 'trading-investment',
  },
]

/**
 * Get sandbox data for a specific resource type, optionally scoped to the
 * tenant's active vertical. Every sample is tagged with the vertical it
 * represents; without a vertical (the common case today — see
 * useVerticalLabels.ts's own comment), this returns the full unfiltered mix,
 * identical to the previous behavior. Once a tenant has actually activated a
 * vertical, this stops every user seeing the same trading/SMB demo content
 * regardless of which vertical they picked.
 */
function filterByVertical<T extends { vertical: string }>(entries: T[], vertical?: string): T[] {
  return vertical ? entries.filter((entry) => entry.vertical === vertical) : entries
}

/**
 * Outward-facing shape of a sandbox insight — matches the real Insight
 * contract's `actions: string[]` (apps/studio/src/types/index.ts) that every
 * renderer in the app assumes. SandboxInsight above keeps the richer
 * `{type, status}` authoring shape for internal use; this is where it gets
 * flattened before ever reaching an API response.
 *
 * Gap: this mapping didn't exist until now — getSandboxData('insights', ...)
 * returned SandboxInsight objects with actions as {type,status}[] directly,
 * which every insight-detail renderer (InsightDetailDs.tsx, InsightDetail.tsx,
 * and others) crashed on with "Objects are not valid as a React child",
 * reachable from Home's own "Explore" button on a sandbox tenant.
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

export function getSandboxData(type: 'goals', vertical?: string): SandboxGoal[]
export function getSandboxData(type: 'insights', vertical?: string): SandboxInsightApi[]
export function getSandboxData(type: 'workflows', vertical?: string): SandboxWorkflow[]
export function getSandboxData(type: 'verified_moments', vertical?: string): SandboxVerifiedMoment[]
export function getSandboxData(
  type: 'goals' | 'insights' | 'workflows' | 'verified_moments',
  vertical?: string,
): SandboxGoal[] | SandboxInsightApi[] | SandboxWorkflow[] | SandboxVerifiedMoment[] {
  switch (type) {
    case 'goals':
      return filterByVertical(SANDBOX_GOALS, vertical)
    case 'insights':
      return filterByVertical(SANDBOX_INSIGHTS, vertical).map(toApiInsight)
    case 'workflows':
      return filterByVertical(SANDBOX_WORKFLOWS, vertical)
    case 'verified_moments':
      return filterByVertical(SANDBOX_VERIFIED_MOMENTS, vertical)
    default:
      return []
  }
}
