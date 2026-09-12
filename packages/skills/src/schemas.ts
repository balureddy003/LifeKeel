import { z } from 'zod'
import type { Insight } from '@kairos/engine'

// ─── Skill Manifest ───────────────────────────────────────────────────────────

export const SkillTriggerSchema = z.object({
  type: z.enum(['event', 'schedule', 'on_demand', 'insight']),
  event_types: z.array(z.string()).optional(),
  cron: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
})

export const SkillManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default('1.0.0'),
  description: z.string(),
  category: z.enum(['growth', 'cost', 'risk', 'ops', 'experience']),
  industries: z.array(z.string()).default(['*']),
  triggers: z.array(SkillTriggerSchema),
  reasoning_model: z.string().default('claude-haiku-4-5'),
  requires_approval: z.boolean().default(true),
  execution_policy: z.enum(['suggest', 'auto_execute']).default('suggest'),
  permission_scopes: z.array(z.string()).default(['basic']),
})
export type SkillManifest = z.infer<typeof SkillManifestSchema>

// ─── Skill Context (what a skill receives) ────────────────────────────────────

export interface SkillContext {
  readonly tenant_id: string        // from JWT — immutable, validated at construction
  readonly trigger_type: string
  readonly insights: Insight[]
  readonly domain_data: Record<string, unknown>  // vertical-specific extension
  readonly token_budget: TokenBudget
}

export interface TokenBudget {
  max_input_tokens: number
  max_output_tokens: number
  used_input: number
  used_output: number
  remaining_input: number
  remaining_output: number
}

// ─── Skill Decision (what a skill returns) ────────────────────────────────────

export const SkillDecisionSchema = z.object({
  skill_id: z.string(),
  trace_id: z.string(),
  tenant_id: z.string(),     // stamped by orchestrator — cannot be overridden by skill
  timestamp: z.date().default(() => new Date()),
  reasoning_trace: z.string(),
  confidence_score: z.number().min(0).max(1),
  proposed_actions: z.array(z.object({
    type: z.string(),
    description: z.string(),
    params: z.record(z.unknown()).default({}),
    estimated_impact_minor: z.number().int().optional(),
  })),
  requires_approval: z.boolean(),
  execution_policy: z.enum(['suggest', 'auto_execute']),
  idempotency_key: z.string(), // SHA-256(tenant_id:skill_id:trigger_hash)
})
export type SkillDecision = z.infer<typeof SkillDecisionSchema>

// ─── LangGraph State ──────────────────────────────────────────────────────────

export interface SkillGraphState {
  tenant_id: string
  trigger_type: string
  insights: Insight[]
  domain_data: Record<string, unknown>
  selected_skill_ids: string[]
  decisions: SkillDecision[]          // accumulates via fan-out
  final_decisions: SkillDecision[]
}
