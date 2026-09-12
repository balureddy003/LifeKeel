/**
 * WorkflowEngine — orchestrates LangGraph-style execution of workflow definitions.
 *
 * Implements a simplified but production-ready graph executor:
 *  - Sequential & parallel node execution
 *  - Conditional edge routing (filtrex expressions)
 *  - Human-in-the-loop via InterruptSignal + MongoDB checkpoint
 *  - Checkpoint-based resumption (workflow survives server restart)
 *  - Retry logic per node
 */

import { randomUUID } from 'crypto'
import { compileExpression } from 'filtrex'
import type { Collection, Db } from 'mongodb'
import type { WorkflowDef, WorkflowRun, WorkflowState, EventPayload, ApprovalRequest } from '../types.js'
import { createLlmRouterFromEnv, createLogger } from '@kairos/platform'

const log = createLogger({ service: 'workflow-engine', version: '0.0.0' })
import { NodeExecutor, InterruptSignal } from '../nodes/NodeExecutor.js'
import type { NodeExecutionContext } from '../nodes/NodeExecutor.js'
import { AgentMemory, createEmbedFn } from '../memory/AgentMemory.js'
import { ConnectorActionExecutor } from '../connectors/ConnectorActionExecutor.js'
import { AttributionTracker } from '../attribution/AttributionTracker.js'
import type { AttributionOutcome } from '../attribution/AttributionTracker.js'

// ── Dependency injection for side-effects ─────────────────────

export interface WorkflowEngineOptions {
  db: Db
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>
  llmFn?: (system: string, prompt: string, model: string) => Promise<string>
  notifyFn?: (channel: string, dest: string, message: string) => Promise<void>
  sseBroadcast?: (tenantId: string, event: Record<string, unknown>) => void
  /** See NodeExecutionContext.createPendingTradeFn — injected by apps/api/src/server.ts. */
  createPendingTradeFn?: NodeExecutionContext['createPendingTradeFn']
}

// ── Engine ─────────────────────────────────────────────────────

export class WorkflowEngine {
  private runs: Collection<WorkflowRun>
  private approvals: Collection<ApprovalRequest>
  private connectorExecutor: ConnectorActionExecutor
  private attribution: AttributionTracker

  constructor(private readonly opts: WorkflowEngineOptions) {
    this.runs = opts.db.collection<WorkflowRun>('workflow_runs')
    this.approvals = opts.db.collection<ApprovalRequest>('workflow_approvals')
    this.connectorExecutor = new ConnectorActionExecutor(opts.db, opts.fetchFn)
    this.attribution = new AttributionTracker(opts.db)
  }

  // ── Start a new workflow run triggered by an event ────────────

  async start(
    def: WorkflowDef,
    event: EventPayload,
    tenantId: string,
    llmFnOverride?: (system: string, prompt: string, model: string) => Promise<string>,
  ): Promise<WorkflowRun> {
    const runId = randomUUID()
    const threadId = `${def.id}:${runId}`

    const initialState: WorkflowState = {
      __run_id: runId,
      __tenant_id: tenantId,
      __workflow_id: def.id,
      __current_node: def.nodes[0]?.id ?? '',
      ...def.state,
      // Inject event fields into state
      ...Object.fromEntries(
        Object.entries(event.data).map(([k, v]) => [`event_${k}`, v])
      ),
    }

    const run: WorkflowRun = {
      id: runId,
      workflow_id: def.id,
      tenant_id: tenantId,
      status: 'running',
      trigger_event: event,
      state: initialState,
      ...(def.nodes[0]?.id ? { current_node: def.nodes[0].id } : {}),
      started_at: new Date(),
      thread_id: threadId,
    } as WorkflowRun

    await this.runs.insertOne(run)

    // Record attribution init (non-blocking)
    this.attribution.initRun(runId, def.id, def.name, tenantId).catch(() => {})

    // Execute asynchronously so the trigger returns immediately
    this.execute(def, run, undefined, llmFnOverride).catch(err => {
      log.error({ run_id: runId, err }, 'Workflow run failed')
      this.updateRun(runId, { status: 'failed', error: String(err), completed_at: new Date() }, tenantId)
      this.attribution.recordOutcome(runId, def.id, def.name, tenantId, 'expired').catch(() => {})
    })

    return run
  }

  // ── Resume a workflow that was waiting for human approval ─────

  async resume(
    def: WorkflowDef,
    runId: string,
    nodeId: string,
    action: string,
    tenantId: string,
    edits?: Record<string, string>,
    llmFnOverride?: (system: string, prompt: string, model: string) => Promise<string>,
    // 'human' (default) preserves existing behavior for the /approvals/:id/respond
    // path — every non-reject action is a genuine approval. 'timeout' is for the
    // sweep that resolves lapsed gates via their configured timeout_action
    // (auto_dismiss/skip/escalate) — none of those are an actual approval, so
    // marking them 'approved' would misrepresent the audit trail (a decision
    // that timed out and got auto-dismissed is not the same thing as a human
    // clicking Approve). The underlying __outcome passed to the workflow is
    // unchanged either way — only the approval record's own status differs.
    resolvedVia: 'human' | 'timeout' = 'human',
  ): Promise<void> {
    // SECURITY: always scope by tenantId — prevents cross-tenant workflow resumption
    const run = await this.runs.findOne({ id: runId, tenant_id: tenantId })
    if (!run) throw new Error(`Run ${runId} not found`)
    if (run.status !== 'waiting_approval') {
      throw new Error(`Run ${runId} is not waiting for approval (status: ${run.status})`)
    }

    const resolvedStatus = action === 'reject' ? 'rejected' : resolvedVia === 'timeout' ? 'timed_out' : 'approved'

    // Mark approval resolved
    await this.approvals.updateOne(
      { workflow_run_id: runId, node_id: nodeId, tenant_id: tenantId, status: 'pending' },
      { $set: { status: resolvedStatus, resolved_at: new Date(), resolution: { action, ...(edits ? { edits } : {}) } } },
    )

    // Update run state with approval result
    const updatedState: WorkflowState = {
      ...run.state,
      __outcome: action,
      ...(edits ?? {}),
    }

    await this.updateRun(runId, { status: 'running', state: updatedState }, tenantId)

    // Resume execution from the node after the approval gate
    const resumeRun = { ...run, state: updatedState }
    this.execute(def, resumeRun, { nodeId, action, ...(edits ? { edits } : {}) }, llmFnOverride).catch(err => {
      log.error({ run_id: runId, err }, 'Workflow resume failed')
      this.updateRun(runId, { status: 'failed', error: String(err), completed_at: new Date() }, tenantId)
    })
  }

  // ── Core execution loop ────────────────────────────────────────

  private async execute(
    def: WorkflowDef,
    run: WorkflowRun,
    pendingApproval?: { nodeId: string; action: string; edits?: Record<string, string> },
    llmFnOverride?: (system: string, prompt: string, model: string) => Promise<string>,
  ): Promise<void> {
    let state = { ...run.state }
    const nodeOutputs: Record<string, unknown> = {}

    // Determine starting node
    let startNodeId = run.current_node ?? def.nodes[0]?.id
    if (!startNodeId) return

    // If resuming after approval, start from the node AFTER the approval gate
    let startFromNext = false
    if (pendingApproval) {
      startFromNext = true
    }

    // Build execution order via graph traversal
    const executionOrder = this.buildExecutionOrder(def, startNodeId, startFromNext)

    for (const nodeIds of executionOrder) {
      // nodeIds is an array to support parallel fan-out
      const isParallel = nodeIds.length > 1

      if (isParallel) {
        // Execute nodes in parallel — same edge-condition gate as the
        // single-node branch below. Without this, a conditioned fan-out
        // (e.g. two edges from one node, each guarded by a different
        // condition, landing in the same topology wave) would run every
        // target regardless of which condition actually held.
        const nodesToRun = nodeIds.filter(id => this.shouldRunNode(def, id, state))
        const results = await Promise.allSettled(
          nodesToRun.map(id => this.executeNode(def, id, state, nodeOutputs, run, pendingApproval, llmFnOverride)),
        )
        for (const result of results) {
          if (result.status === 'fulfilled') {
            Object.assign(state, result.value)
          }
        }
      } else {
        const nodeId = nodeIds[0]!

        // Check if this node should be skipped based on edge conditions
        const shouldRun = this.shouldRunNode(def, nodeId, state)
        if (!shouldRun) continue

        await this.updateRun(run.id, { current_node: nodeId, state }, run.tenant_id)

        try {
          const updates = await this.executeNode(def, nodeId, state, nodeOutputs, run, pendingApproval, llmFnOverride)
          Object.assign(state, updates)
          Object.assign(nodeOutputs, { [nodeId]: updates })
        } catch (err) {
          if (err instanceof InterruptSignal) {
            // Human approval gate hit — save approval request and suspend.
            // First check whether an open, non-expired approval already
            // covers this exact subject (same workflow + gate + ticker/
            // account) — if the underlying condition re-fires before a
            // prior approval is resolved, this prevents a second parallel
            // approval for the same thing (previously the only guard was
            // the insight layer's own dedup, which doesn't cover workflow
            // approvals at all).
            const existingOpen = await this.approvals.findOne({
              tenant_id: run.tenant_id,
              workflow_id: def.id,
              node_id: nodeId,
              status: 'pending',
              dedup_key: err.approvalRequest.dedup_key ?? 'account',
            }) as ApprovalRequest | null

            if (existingOpen && new Date(existingOpen.timeout_at).getTime() > Date.now()) {
              await this.updateRun(run.id, { status: 'cancelled', current_node: nodeId, state }, run.tenant_id)
              return
            }

            const approvalId = randomUUID()
            await this.approvals.insertOne({
              id: approvalId,
              status: 'pending',
              created_at: new Date(),
              ...err.approvalRequest,
            } as ApprovalRequest)

            await this.updateRun(run.id, { status: 'waiting_approval', current_node: nodeId, state }, run.tenant_id)

            // Broadcast SSE to Studio UI
            this.opts.sseBroadcast?.(run.tenant_id, {
              type: 'approval_required',
              approval_id: approvalId,
              workflow_id: def.id,
              run_id: run.id,
              node_label: err.approvalRequest.node_label,
            })

            return // suspended — will resume via /approvals/:id/respond
          }
          throw err // re-throw non-interrupt errors
        }
      }
    }

    // Collect any connector action errors from state before persisting the
    // run — a run whose final node executed but whose action step 401'd (or
    // otherwise failed) was previously saved as plain 'completed' with no
    // error recorded anywhere on the run document itself, even though this
    // exact information was already being collected a few lines down for
    // the SSE broadcast only. Confirmed on a real account: every single
    // "notify_owner" action had been failing (missing Slack credentials)
    // while every run still showed green "Completed" with no indication
    // anything was wrong short of opening a detail drawer that reads the
    // raw state. The workflow itself did complete — reaching this point at
    // all means no node threw — so `status` stays 'completed'; `error`
    // (already a real, already-rendered field for genuine run failures) now
    // also surfaces this case instead of silently dropping it.
    const actionErrors: Array<{ node: string; error: string }> = []
    for (const [key, value] of Object.entries(state)) {
      if (key.startsWith('__action_') && key.endsWith('_error') && typeof value === 'string') {
        const nodeId = key.replace('__action_', '').replace('_error', '')
        actionErrors.push({ node: nodeId, error: value })
      }
    }
    const actionErrorSummary = actionErrors.length > 0
      ? actionErrors.map(e => `${e.node}: ${e.error}`).join('; ')
      : undefined

    await this.updateRun(
      run.id,
      { status: 'completed', state, completed_at: new Date(), ...(actionErrorSummary ? { error: actionErrorSummary } : {}) },
      run.tenant_id,
    )

    this.opts.sseBroadcast?.(run.tenant_id, {
      type: 'workflow_completed',
      run_id: run.id,
      workflow_id: def.id,
      ...(actionErrors.length > 0 ? { action_errors: actionErrors } : {}),
    })

    // Record attribution outcome — value extracted from state if present (integer minor units)
    const valueMinorUnits = typeof state['__attribution_value_minor'] === 'number'
      ? state['__attribution_value_minor'] : 0
    const currency = typeof state['__attribution_currency'] === 'string'
      ? state['__attribution_currency'] : 'GBP'
    // A completed run is never actually "pending" — that's only correct for
    // a run still waiting on something. __outcome carries the real
    // resolution ('approve'/'reject' from a human resume, 'auto_execute' /
    // a custom auto_approve_outcome from an autonomous bypass), but action
    // ids are workflow-defined free text, not a fixed enum (see each
    // workflow's human_approval action list), so this is a heuristic:
    // anything reject/dismiss-shaped counts as dismissed, everything else
    // (approved, auto-executed, or no approval gate in this workflow at
    // all) counts as converted.
    //
    // That heuristic alone produced a real, confusing contradiction on a
    // live account: __outcome was 'auto_execute' (not reject/dismiss-shaped)
    // even though the trade-intent node had explicitly declined to create
    // one (__trade_intent_created: false, reason "No coherent auto-trade
    // recommendation for this detector/ticker") — so the run counted as
    // 'converted', driving Outcomes to show "100% conversion rate" next to
    // "£0" attributed value for the same workflow. When a trade-intent node
    // ran at all (the key is present — most workflows have no such node and
    // this stays undefined, so they're unaffected), trust its explicit
    // created/not-created signal over the generic __outcome string.
    const rawOutcome = String(state['__outcome'] ?? '').toLowerCase()
    const tradeIntentCreated = state['__trade_intent_created']
    let outcome: AttributionOutcome
    if (/reject|dismiss/.test(rawOutcome)) {
      outcome = 'dismissed'
    } else if (tradeIntentCreated === false) {
      outcome = 'dismissed'
    } else {
      outcome = 'converted'
    }
    this.attribution.recordOutcome(run.id, def.id, def.name, run.tenant_id, outcome, valueMinorUnits, currency).catch(() => {})
  }

  private async executeNode(
    def: WorkflowDef,
    nodeId: string,
    state: WorkflowState,
    nodeOutputs: Record<string, unknown>,
    run: WorkflowRun,
    pendingApproval?: { nodeId: string; action: string; edits?: Record<string, string> },
    llmFnOverride?: (system: string, prompt: string, model: string) => Promise<string>,
  ): Promise<Partial<WorkflowState>> {
    const node = def.nodes.find(n => n.id === nodeId)
    if (!node) return {}

    // Build per-run agent memory (scoped to tenant + workflow)
    const memory = new AgentMemory(
      this.opts.db,
      run.tenant_id,
      def.id,
      // Attempt to create embedding function from tenant LLM config
      // (only available for OpenAI tenants; others fall back to keyword search)
      createEmbedFn(
        (this.opts as unknown as Record<string, unknown>)['tenantApiKey'] as string | undefined,
        (this.opts as unknown as Record<string, unknown>)['tenantProvider'] as string | undefined,
      ),
    )

    const execCtx: NodeExecutionContext = {
      runId: run.id,
      tenantId: run.tenant_id,
      workflowId: def.id,
      workflowName: def.name,
      triggerEvent: run.trigger_event,
      nodeOutputs,
      ...(pendingApproval?.nodeId === nodeId ? { pendingApproval } : {}),
      fetchFn: this.opts.fetchFn ?? fetch,
      llmFn: llmFnOverride ?? this.opts.llmFn ?? defaultLlmFn,
      notifyFn: this.opts.notifyFn ?? defaultNotifyFn,
      memory,
      connectorExecutor: this.connectorExecutor,
      createPendingTradeFn: this.opts.createPendingTradeFn,
    }

    const executor = new NodeExecutor(execCtx)
    return executor.execute(node, state)
  }

  // ── Graph traversal — build ordered list of node id groups ────
  // Returns array of arrays: [[nodeA], [nodeB, nodeC (parallel)], [nodeD]]
  //
  // Gap #17 (TRADING_ENGINE_GAPS.md): multi-source AND-joins (where a node
  // has multiple `from` predecessors at different graph depths) rely on BFS
  // scheduling happening to place the join node in the same wave as both
  // predecessors. This works today because BFS processes all predecessors
  // before advancing, but it's an implicit invariant — there's no explicit
  // "wait for both inputs" barrier. If the traversal algorithm changes
  // (e.g. to topological sort with depth-based scheduling), AND-joins where
  // the two inputs sit at different depths could fire before both inputs
  // are ready. Not confirmed broken today; flagged as a fragility. A proper
  // fix would add an explicit in-degree counter per node and only schedule
  // a node when all its predecessors have completed.

  private buildExecutionOrder(
    def: WorkflowDef,
    startNodeId: string,
    skipFirst: boolean,
  ): string[][] {
    const order: string[][] = []
    const visited = new Set<string>()
    let current = [startNodeId]

    if (skipFirst) {
      // Advance past the start node to its successors
      current = this.getSuccessors(def, startNodeId)
    }

    while (current.length > 0) {
      const unvisited = current.filter(id => !visited.has(id) && id !== 'END')
      if (unvisited.length === 0) break

      order.push(unvisited)
      unvisited.forEach(id => visited.add(id))

      // Collect all successors for the next iteration
      const next = new Set<string>()
      for (const id of unvisited) {
        for (const s of this.getSuccessors(def, id)) {
          if (!visited.has(s)) next.add(s)
        }
      }
      current = [...next]
    }

    return order
  }

  private getSuccessors(def: WorkflowDef, nodeId: string): string[] {
    const successors: string[] = []
    for (const edge of def.edges) {
      const froms = Array.isArray(edge.from) ? edge.from : [edge.from]
      if (froms.includes(nodeId)) {
        const tos = Array.isArray(edge.to) ? edge.to : [edge.to]
        successors.push(...tos)
      }
    }
    return successors
  }

  private shouldRunNode(def: WorkflowDef, nodeId: string, state: WorkflowState): boolean {
    // Find incoming edges to this node
    const incomingEdges = def.edges.filter(e => {
      const tos = Array.isArray(e.to) ? e.to : [e.to]
      return tos.includes(nodeId)
    })

    if (incomingEdges.length === 0) return true // entry node

    // At least one incoming edge must be satisfied
    return incomingEdges.some(edge => {
      if (!edge.condition) return true
      try {
        const fn = compileExpression(edge.condition)
        const result = fn(state as Record<string, unknown>)
        return Boolean(result)
      } catch {
        return false
      }
    })
  }

  // ── DB helpers ────────────────────────────────────────────────

  private async updateRun(id: string, update: Partial<WorkflowRun>, tenantId?: string): Promise<void> {
    await this.runs.updateOne(tenantId ? { id, tenant_id: tenantId } : { id }, { $set: update })
  }

  async getRun(id: string, tenantId?: string): Promise<WorkflowRun | null> {
    // SECURITY: when tenantId provided, enforce ownership — prevents cross-tenant access
    const filter = tenantId ? { id, tenant_id: tenantId } : { id }
    return this.runs.findOne(filter) as Promise<WorkflowRun | null>
  }

  async getRunsByTenant(tenantId: string, limit = 50): Promise<WorkflowRun[]> {
    return this.runs
      .find({ tenant_id: tenantId })
      .sort({ started_at: -1 })
      .limit(limit)
      .toArray() as Promise<WorkflowRun[]>
  }

  async getPendingApprovals(tenantId: string): Promise<ApprovalRequest[]> {
    return this.approvals
      .find({ tenant_id: tenantId, status: 'pending' })
      .sort({ created_at: -1 })
      .toArray() as Promise<ApprovalRequest[]>
  }

  async getApproval(id: string, tenantId?: string): Promise<ApprovalRequest | null> {
    // SECURITY: when tenantId provided, enforce ownership
    const filter = tenantId ? { id, tenant_id: tenantId } : { id }
    return this.approvals.findOne(filter) as Promise<ApprovalRequest | null>
  }
}

// ── Default side-effect implementations ──────────────────────────

// Real LLM router — auto-detects provider from env vars
// (ANTHROPIC_API_KEY / OPENAI_API_KEY / GROQ_API_KEY / AZURE_OPENAI_ENDPOINT / OLLAMA_BASE_URL)
const defaultLlmFn = createLlmRouterFromEnv()

async function defaultNotifyFn(channel: string, dest: string, message: string): Promise<void> {
  log.info({ channel, dest, message: message.slice(0, 100) }, 'Notify dispatched')
}
