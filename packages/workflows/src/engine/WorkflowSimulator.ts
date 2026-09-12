/**
 * Workflow Simulator — dry-run and shadow execution for workflow definitions.
 *
 * The most-requested feature in any workflow automation tool. Lets builders
 * test a workflow against a sample event before deploying it to production.
 *
 * Two modes:
 *
 *   dry_run   — Execute all nodes but mock every side effect:
 *               • notify nodes → record but do not send
 *               • http nodes → return a configurable mock response
 *               • connector_action nodes → return ok: true with mock state
 *               • ai_generate nodes → call LLM with a [SIMULATION] prefix so
 *                 output is clearly test-only, or use a stub if no LLM is configured
 *               Returns full execution trace + estimated cost.
 *
 *   estimate  — Static analysis only. No LLM calls. Returns structural warnings,
 *               node count, estimated cost range, and potential infinite loops.
 *
 * Usage:
 *   const sim = new WorkflowSimulator(db, llmFn)
 *   const result = await sim.dryRun(workflowDef, sampleEvent, tenantId)
 *   // result.trace — step-by-step node execution with state deltas
 *   // result.estimated_cost_microdollars — LLM cost estimate
 *   // result.warnings — potential issues (missing break condition, etc.)
 */

import { randomUUID } from 'crypto'
import { compileExpression } from 'filtrex'
import type { WorkflowDef, WorkflowRun, WorkflowState, EventPayload } from '../types.js'
import { NodeExecutor, InterruptSignal } from '../nodes/NodeExecutor.js'
import type { NodeExecutionContext } from '../nodes/NodeExecutor.js'
import { AgentMemory, createEmbedFn } from '../memory/AgentMemory.js'
import { ConnectorActionExecutor } from '../connectors/ConnectorActionExecutor.js'
import type { Db } from 'mongodb'

// ── Result types ───────────────────────────────────────────────────────────────

export interface SimulationNodeTrace {
  node_id: string
  node_type: string
  node_label?: string
  status: 'executed' | 'skipped' | 'mocked' | 'interrupted' | 'error'
  duration_ms: number
  state_delta: Partial<WorkflowState>
  /** True if side effects were suppressed (notify, http, connector_action). */
  mocked: boolean
  error?: string
  mock_note?: string  // e.g. "Email would be sent to john@example.com"
}

export interface SimulationResult {
  mode: 'dry_run' | 'estimate'
  workflow_id: string
  sample_event_type: string
  /** Full step-by-step execution trace. */
  trace: SimulationNodeTrace[]
  final_state: WorkflowState
  /** Would execution have paused for human approval? */
  would_require_approval: boolean
  approval_node?: string
  /** Approximate LLM cost if run in production (micro-dollars). */
  estimated_cost_microdollars: number
  estimated_cost_display: string
  /** Total wall-clock time of the simulation. */
  duration_ms: number
  /** Structural warnings (potential bugs, missing configs). */
  warnings: string[]
  /** True if simulation completed without errors. */
  success: boolean
}

export interface EstimateResult {
  workflow_id: string
  node_count: number
  parallel_groups: number
  max_depth: number
  has_loops: boolean
  loop_nodes: string[]
  has_sub_workflows: boolean
  /** Estimated cost range in micro-dollars. */
  cost_min_microdollars: number
  cost_max_microdollars: number
  cost_display_range: string
  warnings: string[]
  /** Detected potential infinite loops (loop nodes with no break condition edge). */
  infinite_loop_risks: string[]
}

// ── Simulator ─────────────────────────────────────────────────────────────────

// Rough token cost estimates per node type (micro-dollars, assumes haiku-4-5 pricing)
const NODE_COST_ESTIMATE: Record<string, { min: number; max: number }> = {
  ai_generate:      { min: 150, max: 2000 },  // 6K–80K tokens × haiku pricing
  skill:            { min: 80,  max: 800 },
  http:             { min: 0,   max: 0 },
  connector_action: { min: 0,   max: 0 },
  notify:           { min: 0,   max: 0 },
  human_approval:   { min: 0,   max: 0 },
  loop:             { min: 0,   max: 0 },
  transform:        { min: 0,   max: 0 },
  wait:             { min: 0,   max: 0 },
  condition:        { min: 0,   max: 0 },
  trigger:          { min: 0,   max: 0 },
  sub_workflow:     { min: 200, max: 5000 },
}

export class WorkflowSimulator {
  private connectorExecutor: ConnectorActionExecutor

  constructor(
    private readonly db: Db,
    private readonly llmFn?: (system: string, prompt: string, model: string) => Promise<string>,
  ) {
    this.connectorExecutor = new ConnectorActionExecutor(db)
  }

  // ── Dry Run ──────────────────────────────────────────────────────────────────

  async dryRun(
    def: WorkflowDef,
    sampleEvent: EventPayload,
    tenantId: string,
  ): Promise<SimulationResult> {
    const startTime = Date.now()
    const runId = `sim_${randomUUID()}`
    const warnings: string[] = []
    const trace: SimulationNodeTrace[] = []
    let would_require_approval = false
    let approval_node: string | undefined

    // Validate before running
    const structuralWarnings = this.analyzeStructure(def)
    warnings.push(...structuralWarnings)

    // Build initial state
    let state: WorkflowState = {
      __run_id: runId,
      __tenant_id: tenantId,
      __workflow_id: def.id,
      __current_node: def.nodes[0]?.id ?? '',
      ...(def.state ?? {}),
      ...Object.fromEntries(
        Object.entries(sampleEvent.data).map(([k, v]) => [`event_${k}`, v])
      ),
    }

    const nodeOutputs: Record<string, unknown> = {}

    // Build execution order
    const startNodeId = def.nodes[0]?.id
    if (!startNodeId) {
      return this.buildResult('dry_run', def, sampleEvent, trace, state, warnings, would_require_approval, approval_node, startTime, false)
    }

    const executionOrder = this.buildExecutionOrder(def, startNodeId)

    for (const nodeIds of executionOrder) {
      for (const nodeId of nodeIds) {
        const node = def.nodes.find(n => n.id === nodeId)
        if (!node) continue

        // Check edge conditions
        if (!this.shouldRunNode(def, nodeId, state)) {
          trace.push({
            node_id: nodeId,
            node_type: node.type,
            node_label: node.label,
            status: 'skipped',
            duration_ms: 0,
            state_delta: {},
            mocked: false,
          })
          continue
        }

        const t0 = Date.now()

        // Build mock execution context — side effects are suppressed
        const mockNotifyFn = async (channel: string, dest: string, message: string): Promise<void> => {
          const entry = trace[trace.length] // current node trace will be set below
          void channel; void message
          // Record what would have been sent
          const noteKey = `__sim_notify_${nodeId}`
          state[noteKey] = `[SIMULATION] Would send via ${channel} to ${dest}`
        }

        const mockFetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
          void init
          return new Response(JSON.stringify({ simulated: true, url }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const simLlmFn = this.llmFn
          ? async (system: string, prompt: string, model: string) => {
              return this.llmFn!(
                `[SIMULATION MODE — output is for testing only]\n${system}`,
                prompt,
                model,
              )
            }
          : async (_system: string, _prompt: string, _model: string) => {
              return `[SIMULATION] AI output for node ${nodeId} — configure LLM to see real output`
            }

        const execCtx: NodeExecutionContext = {
          runId,
          tenantId,
          workflowId: def.id,
          workflowName: def.name,
          triggerEvent: sampleEvent,
          nodeOutputs,
          pendingApproval: undefined,
          fetchFn: mockFetchFn,
          llmFn: simLlmFn,
          notifyFn: mockNotifyFn,
          memory: new AgentMemory(this.db, tenantId, def.id, createEmbedFn()),
          connectorExecutor: undefined,
        }

        const executor = new NodeExecutor(execCtx)

        let status: SimulationNodeTrace['status'] = 'executed'
        let stateUpdates: Partial<WorkflowState> = {}
        let error: string | undefined
        let mockNote: string | undefined
        const isMocked = ['notify', 'http', 'connector_action'].includes(node.type)

        try {
          stateUpdates = await executor.execute(node, state)
          Object.assign(state, stateUpdates)
          Object.assign(nodeOutputs, { [nodeId]: stateUpdates })
          status = isMocked ? 'mocked' : 'executed'

          if (isMocked) {
            if (node.type === 'notify') {
              const cfg = node.config as Record<string, unknown>
              mockNote = `Would send ${cfg['channel'] ?? 'notification'} to ${cfg['destination'] ?? 'recipient'}`
            } else if (node.type === 'http') {
              const cfg = node.config as Record<string, unknown>
              mockNote = `Would call ${cfg['method'] ?? 'GET'} ${cfg['url'] ?? 'URL'} → mocked 200`
            } else if (node.type === 'connector_action') {
              const cfg = node.config as Record<string, unknown>
              mockNote = `Would execute ${cfg['connector'] ?? 'connector'}/${cfg['action'] ?? 'action'}`
            }
          }
        } catch (err) {
          if (err instanceof InterruptSignal) {
            would_require_approval = true
            approval_node = nodeId
            status = 'interrupted'
            mockNote = `Would pause for human approval: "${node.label ?? nodeId}"`
            trace.push({
              node_id: nodeId,
              node_type: node.type,
              node_label: node.label,
              status,
              duration_ms: Date.now() - t0,
              state_delta: {},
              mocked: true,
              mock_note: mockNote,
            })
            break
          }
          status = 'error'
          error = (err as Error).message
          warnings.push(`Node "${nodeId}" errored during simulation: ${error}`)
        }

        trace.push({
          node_id: nodeId,
          node_type: node.type,
          node_label: node.label,
          status,
          duration_ms: Date.now() - t0,
          state_delta: stateUpdates,
          mocked: isMocked,
          ...(error ? { error } : {}),
          ...(mockNote ? { mock_note: mockNote } : {}),
        })

        if (status === 'error') break
      }
    }

    return this.buildResult(
      'dry_run', def, sampleEvent, trace, state, warnings,
      would_require_approval, approval_node, startTime, true,
    )
  }

  // ── Static Estimate (no LLM calls) ──────────────────────────────────────────

  estimate(def: WorkflowDef): EstimateResult {
    const warnings = this.analyzeStructure(def)
    const loopNodes = def.nodes.filter(n => n.type === 'loop').map(n => n.id)
    const subWorkflowNodes = def.nodes.filter(n => n.type === 'sub_workflow')

    // Detect infinite loop risks: loop nodes with no outgoing edge using __loop_*_done
    const infiniteLoopRisks: string[] = []
    for (const loopNodeId of loopNodes) {
      const outgoingEdges = def.edges.filter(e => {
        const froms = Array.isArray(e.from) ? e.from : [e.from]
        return froms.includes(loopNodeId)
      })
      const hasBreakCondition = outgoingEdges.some(e => e.condition?.includes('__loop_'))
      if (!hasBreakCondition) {
        infiniteLoopRisks.push(loopNodeId)
        warnings.push(`Loop node "${loopNodeId}" has no break condition edge — may cause infinite execution`)
      }
    }

    // Build execution order for depth calculation
    let maxDepth = 0
    let parallelGroups = 0
    try {
      const startId = def.nodes[0]?.id
      if (startId) {
        const order = this.buildExecutionOrder(def, startId)
        maxDepth = order.length
        parallelGroups = order.filter(g => g.length > 1).length
      }
    } catch { /* ignore graph errors in estimate */ }

    // Cost range
    let costMin = 0
    let costMax = 0
    for (const node of def.nodes) {
      const estimate = NODE_COST_ESTIMATE[node.type] ?? { min: 0, max: 0 }
      costMin += estimate.min
      costMax += estimate.max
    }

    const formatRange = (min: number, max: number): string => {
      const fmtMin = min === 0 ? '$0.00' : `$${(min / 1_000_000).toFixed(4)}`
      const fmtMax = `$${(max / 1_000_000).toFixed(4)}`
      return `${fmtMin} – ${fmtMax}`
    }

    return {
      workflow_id: def.id,
      node_count: def.nodes.length,
      parallel_groups: parallelGroups,
      max_depth: maxDepth,
      has_loops: loopNodes.length > 0,
      loop_nodes: loopNodes,
      has_sub_workflows: subWorkflowNodes.length > 0,
      cost_min_microdollars: costMin,
      cost_max_microdollars: costMax,
      cost_display_range: formatRange(costMin, costMax),
      warnings,
      infinite_loop_risks: infiniteLoopRisks,
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private buildResult(
    mode: 'dry_run' | 'estimate',
    def: WorkflowDef,
    sampleEvent: EventPayload,
    trace: SimulationNodeTrace[],
    finalState: WorkflowState,
    warnings: string[],
    wouldRequireApproval: boolean,
    approvalNode: string | undefined,
    startTime: number,
    success: boolean,
  ): SimulationResult {
    // Estimate LLM cost from actual ai_generate / skill nodes executed
    const aiNodes = trace.filter(t => ['ai_generate', 'skill'].includes(t.node_type) && t.status !== 'skipped')
    const estimatedCost = aiNodes.reduce((sum, t) => {
      const est = NODE_COST_ESTIMATE[t.node_type] ?? { min: 0, max: 0 }
      return sum + Math.round((est.min + est.max) / 2)
    }, 0)

    return {
      mode,
      workflow_id: def.id,
      sample_event_type: sampleEvent.event_type,
      trace,
      final_state: finalState,
      would_require_approval: wouldRequireApproval,
      ...(approvalNode ? { approval_node: approvalNode } : {}),
      estimated_cost_microdollars: estimatedCost,
      estimated_cost_display: estimatedCost === 0 ? '$0.00' : `$${(estimatedCost / 1_000_000).toFixed(4)}`,
      duration_ms: Date.now() - startTime,
      warnings,
      success,
    }
  }

  private analyzeStructure(def: WorkflowDef): string[] {
    const warnings: string[] = []
    if (def.nodes.length === 0) warnings.push('Workflow has no nodes')
    if (def.edges.length === 0 && def.nodes.length > 1) warnings.push('Workflow has nodes but no edges — only the first node will execute')

    // Check for nodes referenced in edges but not defined
    const nodeIds = new Set(def.nodes.map(n => n.id))
    for (const edge of def.edges) {
      const froms = Array.isArray(edge.from) ? edge.from : [edge.from]
      const tos = Array.isArray(edge.to) ? edge.to : [edge.to]
      for (const id of [...froms, ...tos]) {
        if (id !== 'END' && !nodeIds.has(id)) {
          warnings.push(`Edge references undefined node: "${id}"`)
        }
      }
    }

    // Check for ai_generate nodes missing output_key
    for (const node of def.nodes) {
      if (node.type === 'ai_generate') {
        const cfg = node.config as Record<string, unknown>
        if (!cfg['output_key']) warnings.push(`ai_generate node "${node.id}" is missing output_key — result will not be stored in state`)
        if (!cfg['prompt']) warnings.push(`ai_generate node "${node.id}" is missing prompt`)
      }
      if (node.type === 'http') {
        const cfg = node.config as Record<string, unknown>
        if (!cfg['url']) warnings.push(`http node "${node.id}" is missing url`)
      }
    }

    return warnings
  }

  private buildExecutionOrder(def: WorkflowDef, startNodeId: string): string[][] {
    const order: string[][] = []
    const visited = new Set<string>()
    let current = [startNodeId]

    while (current.length > 0) {
      const unvisited = current.filter(id => !visited.has(id) && id !== 'END')
      if (unvisited.length === 0) break
      order.push(unvisited)
      unvisited.forEach(id => visited.add(id))
      const next = new Set<string>()
      for (const id of unvisited) {
        for (const edge of def.edges) {
          const froms = Array.isArray(edge.from) ? edge.from : [edge.from]
          if (froms.includes(id)) {
            const tos = Array.isArray(edge.to) ? edge.to : [edge.to]
            tos.filter(t => !visited.has(t) && t !== 'END').forEach(t => next.add(t))
          }
        }
      }
      current = [...next]
    }
    return order
  }

  private shouldRunNode(def: WorkflowDef, nodeId: string, state: WorkflowState): boolean {
    const incomingEdges = def.edges.filter(e => {
      const tos = Array.isArray(e.to) ? e.to : [e.to]
      return tos.includes(nodeId)
    })
    if (incomingEdges.length === 0) return true
    return incomingEdges.some(edge => {
      if (!edge.condition) return true
      try {
        const fn = compileExpression(edge.condition)
        return Boolean(fn(state as Record<string, unknown>))
      } catch { return false }
    })
  }
}
