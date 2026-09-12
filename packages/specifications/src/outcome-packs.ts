/**
 * Outcome Pack Schema
 * 
 * Defines metadata for grouping workflows and detectors into business-outcome bundles.
 * 
 * B1 (GOAL_PROGRESS_AND_UX_GAPS.md): extended the category enum to include
 * goal-oriented trading categories. The original categories were capability-
 * oriented ("cash_recovery", "churn_rescue"). The new ones are user-goal-
 * oriented ("wealth_growth", "portfolio_protection", etc.) — the first screen
 * of onboarding should ask "what do you want to achieve?", not "which feature
 * do you want?".
 */

import { z } from 'zod'

export const OutcomePackSchema = z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().max(80),        // "Recover overdue cash automatically"
  category: z.enum([
    // Original capability-oriented categories
    'cash_recovery', 'churn_rescue', 'audience_growth', 'ops_efficiency', 'custom',
    // B1: goal-oriented trading categories
    'wealth_growth', 'portfolio_protection', 'opportunity_discovery', 'trading_decisions', 'goal_tracking',
  ]),
  estimated_setup_minutes: z.number().int(),
  required_connectors: z.array(z.string()),   // connector ids: 'xero', 'stripe', 'hubspot'
  optional_connectors: z.array(z.string()),
  included_workflows: z.array(z.string()),    // workflow ids
  included_detectors: z.array(z.string()),    // detector ids
  kpi_labels: z.array(z.string()),            // e.g. ['Overdue recovery rate', 'Cash collected']
  tier_minimum: z.enum(['individual', 'team', 'smb', 'enterprise']).default('smb'),
})

export type OutcomePack = z.infer<typeof OutcomePackSchema>
