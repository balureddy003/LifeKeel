// ─────────────────────────────────────────────────────────
// Kairos Workflow Engine — Core Types
// ─────────────────────────────────────────────────────────

// ── Detector types ─────────────────────────────────────────

export interface DetectorContext {
  tenant_id: string
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void
    warn: (message: string, meta?: Record<string, unknown>) => void
    error: (message: string, meta?: Record<string, unknown>) => void
  }
}

export interface Signal<T = unknown> {
  type: string
  timestamp: string
  data: T
  metadata?: Record<string, unknown>
}

export interface Detector<TConfig, TOutput> {
  id: string
  name: string
  description: string
  version: string
  execute(context: DetectorContext, config: TConfig): Promise<Signal<TOutput>>
}

export type NodeType =
  | 'trigger'
  | 'ai_generate'
  | 'skill'            // AI primitive (classify/extract/summarize/etc.)
  | 'http'
  | 'human_approval'
  | 'connector_action'
  | 'notify'
  | 'condition'
  | 'wait'
  | 'transform'
  | 'loop'             // iterate over a list in state
  | 'sub_workflow'     // run another workflow as a step
  | 'detector'         // execute a detector from the detector registry
  | 'error_handler'    // catch and handle errors from previous nodes
  | 'set_variable'     // set one or more state variables
  | 'filter'           // drop execution path if condition is false
  | 'trade_intent'     // create a pending trade for autonomous execution

export interface WorkflowNodeDef {
  id: string
  type: NodeType
  label: string
  description?: string
  config: Record<string, unknown>
  /** Template variables resolved at runtime: {{state.x}}, {{event.y}}, {{tenant.z}} */
  output?: Record<string, string>  // state_key -> jsonpath from response
}

export interface WorkflowEdge {
  from: string | string[]          // node id(s) — array = parallel join
  to: string | string[]            // node id(s) — array = parallel fan-out
  condition?: string               // filtrex expression: "outcome == 'approve'"
  label?: string                   // shown on canvas edge
}

export interface WorkflowTrigger {
  detector?: string                // detector id that fires this workflow
  condition?: string               // additional filtrex condition on the event
  event_type?: string              // raw event type (e.g. 'review.created')
  schedule?: string                // cron expression for scheduled workflows
}

export interface WorkflowDef {
  id: string
  name: string
  description?: string
  version: string
  enabled: boolean
  trigger: WorkflowTrigger
  state: Record<string, unknown>   // initial state shape
  nodes: WorkflowNodeDef[]
  edges: WorkflowEdge[]
  settings?: {
    timeout_minutes?: number
    max_retries?: number
    on_error?: 'stop' | 'continue' | 'notify'
  }
}

// ── Runtime types ─────────────────────────────────────────

export type RunStatus =
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkflowRun {
  id: string
  workflow_id: string
  tenant_id: string
  status: RunStatus
  trigger_event: EventPayload
  state: WorkflowState
  current_node?: string
  started_at: Date
  completed_at?: Date
  error?: string
  // LangGraph thread_id for checkpoint resumption
  thread_id: string
}

export interface WorkflowState {
  __run_id: string
  __tenant_id: string
  __workflow_id: string
  __current_node: string
  __outcome?: string
  __error?: string
  [key: string]: unknown
}

export interface EventPayload {
  id: string
  tenant_id: string
  event_type: string
  source_id?: string
  detector_id?: string
  insight_id?: string
  data: Record<string, unknown>
  created_at: Date
}

// ── Approval types ────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited' | 'timed_out'

export interface ApprovalAction {
  id: string
  label: string
  style: 'primary' | 'secondary' | 'danger'
  allow_edit?: boolean
  edit_field?: string
}

export interface ApprovalRequest {
  id: string
  workflow_run_id: string
  workflow_id: string
  workflow_name: string
  node_id: string
  node_label: string
  tenant_id: string
  status: ApprovalStatus
  urgency: 'low' | 'medium' | 'high' | 'critical'
  display: Array<{ label: string; value: string; type?: 'text' | 'code' | 'badge' }>
  actions: ApprovalAction[]
  timeout_at: Date
  created_at: Date
  resolved_at?: Date
  resolved_by?: string
  resolution?: {
    action: string
    edits?: Record<string, string>
  }
  /**
   * Identifies the subject this approval is about (the triggering event's
   * ticker for per-position signals, or 'account' for portfolio-wide ones
   * like a cash-rebalance suggestion) — used by WorkflowEngine to detect
   * when a still-open approval already covers the same subject, instead of
   * creating a second parallel approval every time the same underlying
   * condition re-fires before the first one is resolved.
   */
  dedup_key?: string
}

// ── Node-specific configs ─────────────────────────────────

/**
 * Reflexion loop config — self-healing AI output.
 *
 * After the main generation, an evaluator LLM call checks whether the output
 * satisfies a stated criterion. If not, the node retries with the failure reason
 * appended as a constraint (up to max_cycles times).
 *
 * Implements the Reflexion paper pattern (Shinn et al., 2023) at the node level.
 * Only costs 1 extra LLM call on failure (evaluator); 0 extra on success.
 *
 * Example YAML:
 *   reflexion:
 *     criterion: "The email is professional, under 150 words, and includes a call-to-action"
 *     max_cycles: 2
 *     on_failure: human_approval   # if still failing after max_cycles
 */
export interface ReflexionConfig {
  /** Criterion the output must satisfy. Injected into the evaluator prompt. */
  criterion: string
  /** Max self-correction cycles. Default: 2. Each cycle costs 2 LLM calls (generate + evaluate). */
  max_cycles?: number
  /** What to do if criterion still fails after max_cycles: retry | fallback | human_approval. Default: fallback. */
  on_failure?: 'retry' | 'fallback' | 'human_approval'
}

export interface AiGenerateConfig {
  model?: string                          // explicit model name OR 'tier:fast|balanced|powerful'
  reasoning_tier?: 'fast' | 'balanced' | 'powerful'  // node-level tier override; model auto-resolved
  system?: string
  prompt: string
  output_key: string
  max_tokens?: number
  max_chars?: number
  fallback?: string
  fallbacks?: string[]
  blocked_phrases?: string[]
  temperature?: number
  /**
   * Reflexion self-healing loop. If set, the node evaluates its own output
   * against a criterion and retries up to max_cycles times if it fails.
   */
  reflexion?: ReflexionConfig
}

export interface HttpConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  url: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
  output?: Record<string, string>   // state_key -> jsonpath
  timeout_ms?: number
}

export interface HumanApprovalConfig {
  title: string
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  timeout: string                   // e.g. "24h", "30m"
  timeout_action: 'escalate' | 'auto_approve' | 'auto_dismiss' | 'reject' | 'skip'
  max_auto_approve_per_day?: number   // NEW — circuit breaker for batch events
  /**
   * Filtrex expression (same language as WorkflowEdge.condition) evaluated
   * against workflow state before ever suspending for human input. When
   * true, the approval gate is skipped entirely — no InterruptSignal, no
   * approval record, no click — and `auto_approve_outcome` is set as
   * `state.__outcome` directly, same as if a human had picked that action.
   */
  auto_approve_condition?: string
  auto_approve_outcome?: string
  display: Array<{ label: string; value: string }>
  actions: ApprovalAction[]
}

export interface TradeIntentConfig {
  /** State key the trade-creation result is written to. Defaults to 'trade_intent'. */
  output_key?: string
}

export interface NotifyConfig {
  channel: 'slack' | 'email' | 'sms' | 'webhook'
  destination: string
  template: string
  subject?: string
}

export interface ConnectorActionConfig {
  connector: string
  action: string
  params: Record<string, unknown>
}

export interface WaitConfig {
  duration: string                  // e.g. "1h", "30m", "1d"
}

export interface ConditionConfig {
  expression: string                // filtrex
  true_node: string
  false_node: string
}

export interface TransformConfig {
  mappings: Record<string, string>  // state_key -> template expression
}

export interface SetVariableConfig {
  variables: Record<string, string> // state_key -> template value
}

export interface FilterConfig {
  condition: string                 // filtrex — if false, stop this branch
  stop_message?: string             // logged when filtered
}

// ── Action Receipt ─────────────────────────────────────────────────────────

export type ActionReceiptOutcome =
  | 'approved'          // human approved — action executed
  | 'dismissed'         // human dismissed — action skipped
  | 'auto_approved'     // timeout auto-approve — action executed
  | 'auto_dismissed'    // timeout auto-dismiss — action skipped
  | 'policy_blocked'    // kairos-guard or dry_run blocked action
  | 'budget_blocked'    // LLM budget guard stopped action

export interface ActionReceipt {
  id: string                           // randomUUID
  tenant_id: string
  insight_id?: string
  workflow_run_id?: string
  workflow_id?: string
  detector_id?: string
  action_type: string                  // 'email.send' | 'crm.note' | 'slack.post' etc.
  outcome: ActionReceiptOutcome
  outcome_reason?: string             // human-readable reason for block/dismiss
  executed_at: Date
  approved_by?: string                // user_id if human-approved
  payload_hash: string                // SHA-256 of action payload — immutable audit
  dry_run: boolean
  learning_suppressed?: boolean       // true when learning was paused due to bad signal quality
  blend_used?: { rule: number; llm: number }   // for evidence-trail alignment
  metadata?: Record<string, unknown> // D1b: insight_score at action time for calibration pairs
}

export interface ErrorHandlerConfig {
  catch_from?: string[]             // node ids to catch errors from (blank = all)
  output_key?: string               // where to write the error message
  fallback_value?: string           // value to set if error caught
  continue?: boolean                // true = resume workflow after handling
}

export interface SubWorkflowConfig {
  workflow_id: string               // id of the child workflow YAML
  input: Record<string, string>     // state_key -> template for input mapping
  output_key?: string               // where to write the child run_id
  wait?: boolean                    // true = wait for child to complete (default: false)
}

export interface SkillNodeConfig {
  skill: string                     // classify | extract | summarize | sentiment | etc.
  [key: string]: unknown            // skill-specific fields, resolved via template engine
}
