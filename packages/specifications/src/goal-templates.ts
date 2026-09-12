/**
 * Goal Template Schema
 *
 * A curated, pre-built goal a user can adopt as-is or edit — the fallback path
 * when the LLM goal compiler is unavailable, and the source for GET
 * /goal-templates. Mirrors OutcomePackSchema/VerticalSchema: content lives as
 * YAML in definitions/goal-templates/, ids resolve there, and verticals
 * reference these ids from their `goal_templates` field.
 */

import { z } from 'zod'

export const CompiledKpiSchema = z.object({
  metric: z.string(),
  label: z.string(),
  unit: z.string(),
  target: z.number(),
  start_value: z.number(),
  current: z.number(),
  direction: z.enum(['increase', 'decrease']),
  source: z.enum(['signals', 'external_api', 'manual']),
  signal_types: z.array(z.string()).optional(),
  aggregation: z.string().optional(),
  field: z.string().optional(),
  filter: z.string().optional(),
  window_days: z.number().optional(),
  denominator_signal_types: z.array(z.string()).optional(),
  reasoning: z.string(),
})

export type CompiledKpi = z.infer<typeof CompiledKpiSchema>

export const CompiledDetectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  existing: z.boolean(),
  yaml: z.string().optional(),
  reasoning: z.string(),
})

export type CompiledDetector = z.infer<typeof CompiledDetectorSchema>

export const CompiledGoalSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  timeline_days: z.number().int(),
  kpis: z.array(CompiledKpiSchema),
  detectors: z.array(CompiledDetectorSchema),
  tags: z.array(z.string()),
  confidence: z.number(),
  reasoning: z.string(),
  warnings: z.array(z.string()),
})

export type CompiledGoalSpec = z.infer<typeof CompiledGoalSpecSchema>

export const GoalPlanStepSchema = z.object({
  id: z.string(),
  label: z.string(),
  skill: z.string(),
  workflow_id: z.string().optional(),
  connector_id: z.string().optional(),
  approval_required: z.boolean(),
  description: z.string(),
})

export type GoalPlanStep = z.infer<typeof GoalPlanStepSchema>

export const GoalTemplateSchema = z.object({
  id: z.string(), // 'invoice-recovery', 'diversified-portfolio-yield'
  domain: z.string(), // 'Finance', 'Trading & Investment'
  name: z.string(),
  description: z.string(),
  intent: z.string(),
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  required_connectors: z.array(z.string()), // ids: resolve against connectors/ or ConnectorRegistry
  skills: z.array(z.string()),
  plan: z.array(GoalPlanStepSchema),
  stop_condition: z.string(),
  spec: CompiledGoalSpecSchema,
})

export type GoalTemplate = z.infer<typeof GoalTemplateSchema>
