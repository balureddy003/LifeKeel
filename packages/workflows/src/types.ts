// ── Action Receipt ─────────────────────────────────────────────────────────
//
// The only types from the original Kairos Workflow Engine's type universe
// still consumed outside this package (apps/api/src/db.ts, routes/insights.ts).
// Everything else (WorkflowDef, node configs, approval types, etc.) belonged
// to the WorkflowEngine/WorkflowLoader machinery removed on 2026-09-12 —
// see ARCHITECTURE.md.

export type ActionReceiptOutcome =
  | 'approved'          // human approved — action executed
  | 'dismissed'         // human dismissed — action skipped
  | 'auto_approved'     // timeout auto-approve — action executed
  | 'auto_dismissed'    // timeout auto-dismiss — action skipped
  | 'policy_blocked'    // kairos-guard or dry_run blocked action
  | 'budget_blocked'    // LLM budget guard stopped action
  // Per-action execution outcomes (apps/api/src/actions/action-executor.ts) —
  // one receipt per recommended action on an approved insight, distinct from
  // the single decision-level 'approved' receipt above.
  | 'executed'            // a single recommended action ran and succeeded
  | 'execution_failed'    // ran and failed with a definite (e.g. 4xx) error — retrying won't help until the underlying cause is fixed
  | 'execution_ambiguous' // ran and failed with an ambiguous (5xx/timeout/network) error — may have partially succeeded, safe to retry
  | 'execution_skipped'   // dry-run, or the action classified as no-op (log_only) — no connector call made

export interface ActionReceipt {
  id: string                           // randomUUID
  tenant_id: string
  insight_id?: string
  workflow_run_id?: string
  workflow_id?: string
  detector_id?: string
  action_type: string                  // 'email.send' | 'crm.note' | 'slack.post' etc.
  action_label?: string                // original free-text action string this receipt executed (execution receipts only)
  outcome: ActionReceiptOutcome
  outcome_reason?: string             // human-readable reason for block/dismiss/failure
  executed_at: Date
  approved_by?: string                // user_id if human-approved
  payload_hash: string                // SHA-256 of action payload — immutable audit + idempotency key
  dry_run: boolean
  learning_suppressed?: boolean       // true when learning was paused due to bad signal quality
  blend_used?: { rule: number; llm: number }   // for evidence-trail alignment
  metadata?: Record<string, unknown> // D1b: insight_score at action time for calibration pairs
}
