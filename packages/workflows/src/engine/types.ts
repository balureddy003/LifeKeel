// ── General-purpose durable workflow engine ─────────────────────────────────
//
// See packages/workflows/README.md for why this exists and what it
// deliberately does not do (no cron, no auto-registration, no boot-time
// scheduling — nothing runs unless application code explicitly calls
// WorkflowEngine.start()/.resume()).

import type { ZodType } from 'zod'

export type WorkflowRunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'rejected'

export interface WorkflowStepContext<TState> {
  runId: string
  tenantId: string
  state: TState
}

export interface WorkflowStepResult<TState> {
  state: Partial<TState>
  /** Jump to a specific step id. Defaults to the next step in definition order. */
  nextStepId?: string
}

export interface WorkflowStep<TState> {
  id: string
  kind: 'action' | 'approval_gate'
  /**
   * True if this step performs an external or irreversible action (sends a
   * message, calls a connector, moves money, etc). defineWorkflow() refuses
   * to build a definition where a sideEffect step isn't preceded by an
   * approval_gate step — the trust-tier human-approval requirement
   * (CLAUDE.md) enforced structurally, not left to convention.
   */
  sideEffect?: boolean
  /** Required for kind: 'action'. Absent for kind: 'approval_gate'. */
  run?: (ctx: WorkflowStepContext<TState>) => Promise<WorkflowStepResult<TState>>
  /** Required for kind: 'approval_gate' — human-readable summary shown to the approver. */
  describeForApproval?: (state: TState) => string
}

export interface WorkflowDefinition<TState> {
  /** Stable identifier for this automation type/template — e.g. 'family.life_event_playbook'. */
  id: string
  /**
   * TState must be a plain object — step results are merged into it with a
   * shallow spread and persisted as a Mongo document. The Input type param
   * is deliberately left unconstrained (not pinned to TState) so schemas
   * using .default()/.optional() — where the parsed *input* is more lenient
   * than the *output* TState — type-check normally; start()'s initialState
   * is validated (and defaulted) at runtime via stateSchema.parse(), same
   * as any other Zod boundary.
   */
  stateSchema: ZodType<TState, any, any>
  steps: WorkflowStep<TState>[]
}

export interface WorkflowRun<TState = unknown> {
  id: string
  tenant_id: string
  workflow_id: string
  status: WorkflowRunStatus
  current_step_id: string
  state: TState
  error?: string
  started_at: Date
  updated_at: Date
  completed_at?: Date
}

export interface WorkflowStepRun {
  run_id: string
  step_id: string
  tenant_id: string
  status: 'succeeded' | 'failed'
  result_state?: Record<string, unknown>
  next_step_id?: string
  error?: string
  executed_at: Date
}

export interface WorkflowApproval {
  id: string
  run_id: string
  tenant_id: string
  step_id: string
  description: string
  requested_at: Date
  decision?: 'approved' | 'rejected'
  decided_at?: Date
  decided_by?: string
  reason?: string
}
