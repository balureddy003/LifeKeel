/**
 * Node Executor — runs each workflow node type.
 * Human approval nodes throw an InterruptSignal to suspend execution.
 */

import type {
  WorkflowNodeDef, WorkflowState, EventPayload, ApprovalRequest,
  AiGenerateConfig, HttpConfig, HumanApprovalConfig, NotifyConfig,
  ConnectorActionConfig, WaitConfig, TransformConfig, DetectorContext, Signal,
} from '../types.js'
import { compileExpression } from 'filtrex'
import { resolveTemplate, resolveTemplateObject, extractJsonPath, parseDuration } from '../engine/TemplateEngine.js'
import type { TemplateContext } from '../engine/TemplateEngine.js'
import { SkillEngine } from '../skills/SkillEngine.js'
import type { SkillConfig } from '../skills/SkillEngine.js'
import type { AgentMemory } from '../memory/AgentMemory.js'
import type { ConnectorActionExecutor } from '../connectors/ConnectorActionExecutor.js'
import { estimateReasoningTier, createLogger, callStructured } from '@agentoak/platform'
import type { ReasoningTier } from '@agentoak/platform'
import { z } from 'zod'
import { detectors } from '../detectors/index.js'
import type { Detector } from '../types.js'

const log = createLogger({ service: 'workflow', version: '0.0.0' })

function assertExternalUrlAllowed(url: string, context: string): void {
  if (process.env['KAIROS_DEPLOYMENT_MODE'] !== 'airgap') return
  const parsed = new URL(url, 'http://localhost')
  const host = parsed.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return
  throw new Error(`External network access blocked in airgap mode for ${context}: ${url.slice(0, 80)}`)
}

// ── Interrupt Signal — thrown by human_approval to pause execution ──

export class InterruptSignal {
  readonly type = 'interrupt' as const
  constructor(
    public readonly approvalRequest: Omit<ApprovalRequest, 'id' | 'created_at' | 'status' | 'resolved_at' | 'resolved_by' | 'resolution'>,
  ) {}
}

// ── Execution context injected by WorkflowEngine ─────────────────────

export interface NodeExecutionContext {
  runId: string
  tenantId: string
  workflowId: string
  workflowName: string
  triggerEvent: EventPayload
  nodeOutputs: Record<string, unknown>  // outputs from previous nodes
  pendingApproval?: {                   // set when resuming after approval
    nodeId: string
    action: string
    edits?: Record<string, string>
  } | undefined

  // Pluggable side-effectors (injected by API layer)
  fetchFn: (url: string, init?: RequestInit) => Promise<Response>
  llmFn: (system: string, prompt: string, model: string) => Promise<string>
  notifyFn: (channel: string, dest: string, message: string) => Promise<void>

  // Optional advanced capabilities
  memory?: AgentMemory | undefined                         // agent memory / RAG
  connectorExecutor?: ConnectorActionExecutor | undefined  // real connector action execution
  /**
   * Creates a pending trade for autonomous execution — injected by the API
   * layer (apps/api/src/server.ts), same pattern as notifyFn/llmFn. Never
   * calls a broker directly; only ever creates a `pending_trades` record
   * that still passes through the same guarded confirm path a manually
   * created trade does. See packages/engine/src/trading/trade-executor.ts.
   *
   * Gap #8: origin distinguishes auto-bypass ('auto') from human-approved
   * ('manual'). Both go through the same guarded confirm/cancel path —
   * the only difference is the audit trail and confirmation window.
   */
  createPendingTradeFn?: ((params: {
    tenantId: string
    detectorId: string
    eventData: Record<string, unknown>
    origin?: 'auto' | 'manual'
    sourceEventId?: string | undefined
    sourceInsightId?: string | undefined
    /** Gap #32: goal_id threaded from the detector's feature_snapshot. */
    goalId?: string | undefined
  }) => Promise<{ created: boolean; tradeId?: string; reason?: string }>) | undefined
}

// ── Main executor ─────────────────────────────────────────────────────

export class NodeExecutor {
  constructor(private readonly execCtx: NodeExecutionContext) {}

  async execute(node: WorkflowNodeDef, state: WorkflowState): Promise<Partial<WorkflowState>> {
    const ctx = this.buildTemplateContext(state)

    log.debug({ node_id: node.id, node_type: node.type }, "Executing node")

    switch (node.type) {
      case 'ai_generate':      return this.runAiGenerate(node, ctx)
      case 'http':             return this.runHttp(node, ctx)
      case 'human_approval':   return this.runHumanApproval(node, ctx, state)
      case 'connector_action': return this.runConnectorAction(node, ctx)
      case 'notify':           return this.runNotify(node, ctx)
      case 'wait':             return this.runWait(node, ctx)
      case 'transform':        return this.runTransform(node, ctx)
      case 'skill':            return this.runSkill(node, ctx)
      case 'loop':             return this.runLoop(node, ctx, state)
      case 'sub_workflow':     return this.runSubWorkflow(node, ctx)
      case 'detector':         return this.runDetector(node, ctx)
      case 'trade_intent':     return this.runTradeIntent(node, state)
      case 'condition':        return {} // handled by edge resolution
      case 'trigger':          return {} // no-op, entry point only
      default:
        log.warn({ node_type: node.type }, 'Unknown node type')
        return {}
    }
  }

  // ── AI Generate ──────────────────────────────────────────────────────

  private async runAiGenerate(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = node.config as unknown as AiGenerateConfig
    let system = resolveTemplate(cfg.system ?? 'You are a helpful assistant.', ctx)
    const prompt = resolveTemplate(cfg.prompt, ctx)

    // Resolve model: explicit > tier override > auto-detect from prompt complexity
    let model: string
    if (cfg.model && !cfg.model.startsWith('tier:')) {
      model = cfg.model  // explicit model name
    } else if (cfg.model?.startsWith('tier:')) {
      model = cfg.model  // explicit tier — router resolves to model
    } else if (cfg.reasoning_tier) {
      model = `tier:${cfg.reasoning_tier}`  // node-level tier setting
    } else {
      // Auto-detect from prompt complexity
      const tier: ReasoningTier = estimateReasoningTier(prompt, system)
      model = `tier:${tier}`
      log.debug({ node_id: node.id, tier }, 'AiGenerate auto-detected tier')
    }

    // Inject agent memory context if available
    if (this.execCtx.memory) {
      try {
        const memCtx = await this.execCtx.memory.buildContext(prompt, 5)
        if (memCtx.formatted) {
          system = `${system}\n\n${memCtx.formatted}`
        }
      } catch {
        // memory retrieval failed — continue without context
      }
    }

    let output: string
    try {
      output = await this.execCtx.llmFn(system, prompt, model)
    } catch (err) {
      log.error({ node_id: node.id, err }, 'AiGenerate LLM call failed')
      output = this.selectAiFallback(cfg, ctx, node.id)
    }

    // ── Reflexion self-healing loop ──────────────────────────────────────────
    // If reflexion config is present, evaluate the output against the criterion
    // and retry up to max_cycles times if the evaluator says it fails.
    if (cfg.reflexion?.criterion) {
      output = await this.runReflexion(output, cfg, model, ctx, node.id)
    }

    if (this.shouldReplaceGeneratedOutput(output, cfg)) {
      output = this.selectAiFallback(cfg, ctx, node.id)
    }

    if (cfg.max_chars && cfg.max_chars > 0 && output.length > cfg.max_chars) {
      output = this.truncateAtWord(output, cfg.max_chars)
    }

    // Store the output in memory for future runs
    if (this.execCtx.memory && cfg.output_key) {
      this.execCtx.memory.remember({
        key: `${node.id}_last_output`,
        value: output,
        summary: output.slice(0, 200),
        tags: [node.id, cfg.output_key, 'ai_generate'],
        runId: this.execCtx.runId,
        nodeId: node.id,
        ttlDays: 30,
        memoryType: 'episodic',
      }).catch(() => {}) // fire-and-forget, don't block execution
    }

    return { [cfg.output_key]: output }
  }

  private selectAiFallback(cfg: AiGenerateConfig, ctx: TemplateContext, nodeId: string): string {
    const options = cfg.fallbacks?.length
      ? cfg.fallbacks
      : (cfg.fallback ? [cfg.fallback] : [])

    if (options.length === 0) {
      return 'Unable to generate response. Please review manually.'
    }

    const seed = `${this.execCtx.tenantId}:${this.execCtx.workflowId}:${nodeId}:${this.execCtx.runId}:${Date.now()}`
    const index = Math.abs(this.hashString(seed)) % options.length
    return resolveTemplate(options[index]!, ctx)
  }

  private shouldReplaceGeneratedOutput(output: string, cfg: AiGenerateConfig): boolean {
    const normalized = this.normalizeGeneratedText(output)
    if (!normalized) return true

    const blocked = (cfg.blocked_phrases ?? []).map(phrase => this.normalizeGeneratedText(phrase))
    if (blocked.some(phrase => phrase && normalized.includes(phrase))) return true

    // Guard against prompt/task copy being accidentally sent to approval.
    const promptLeakSignals = [
      'requirements maximum',
      'output only the post text',
      'write one x post',
      'turn grow twitter presence',
      'set kpis like follower count',
      'detector alerts when you re behind pace',
    ]
    return promptLeakSignals.some(phrase => normalized.includes(phrase))
  }

  private normalizeGeneratedText(value: string): string {
    return value
      .toLowerCase()
      .replace(/[\u201c\u201d"']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  }

  private hashString(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i)
      hash |= 0
    }
    return hash
  }

  private truncateAtWord(value: string, maxChars: number): string {
    const trimmed = value.trim()
    if (trimmed.length <= maxChars) return trimmed
    const cut = trimmed.slice(0, maxChars).trimEnd()
    const lastSentence = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'))
    if (lastSentence > Math.max(40, Math.floor(maxChars * 0.55))) {
      return cut.slice(0, lastSentence + 1).trimEnd()
    }
    const lastSpace = cut.lastIndexOf(' ')
    return (lastSpace > Math.max(40, Math.floor(maxChars * 0.6))
      ? cut.slice(0, lastSpace)
      : cut).trimEnd()
  }

  // ── Reflexion Self-Healing ───────────────────────────────────────────────────
  // Evaluates AI output against a criterion; retries with failure reason if needed.
  // Implements: Shinn et al. "Reflexion: Language Agents with Verbal Reinforcement Learning"
  //
  // P1 cost optimisation:
  //   - Uses callStructured with Zod schema (eliminates regex JSON parsing,
  //     gets free retries on malformed output)
  //   - Early exit on high confidence: if the evaluator returns pass=true
  //     with confidence >= 0.95, skip remaining cycles. The first cycle
  //     already validated the output — re-evaluating adds no value.

  private static readonly ReflexionEvalSchema = z.object({
    pass: z.boolean(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(300).optional(),
  })

  private async runReflexion(
    initialOutput: string,
    cfg: AiGenerateConfig,
    model: string,
    ctx: TemplateContext,
    nodeId: string,
  ): Promise<string> {
    const reflexion = cfg.reflexion!
    const maxCycles = reflexion.max_cycles ?? 2
    let output = initialOutput

    const evaluatorSystem = `You are a strict quality evaluator. Your only job is to check whether a given text satisfies a stated criterion.
Respond with ONLY valid JSON: {"pass": true, "confidence": 0.95} if satisfied, or {"pass": false, "confidence": 0.5, "reason": "<concise explanation of what is wrong>"}.
The confidence field is your confidence in your evaluation (0.0 to 1.0). No other output.`

    for (let cycle = 0; cycle < maxCycles; cycle++) {
      const evaluatorPrompt = `Criterion: "${reflexion.criterion}"

Text to evaluate:
---
${output}
---

Does the text satisfy the criterion?`

      let evalResult: z.infer<typeof NodeExecutor.ReflexionEvalSchema>
      try {
        // Wrap llmFn so model is optional (callStructured expects platform LlmFn
        // with optional model; workflows LlmFn requires model).
        const wrappedLlm = (s: string, p: string, m?: string) => this.execCtx.llmFn(s, p, m ?? 'tier:fast')
        const result = await callStructured(wrappedLlm, {
          schema: NodeExecutor.ReflexionEvalSchema,
          system: evaluatorSystem,
          prompt: evaluatorPrompt,
          model: 'tier:fast',
          maxRetries: 1,
          outputDescription: 'a pass/fail evaluation with confidence and optional reason',
        })
        evalResult = result.data
      } catch {
        break // evaluator call failed — accept current output
      }

      if (evalResult.pass) {
        // Early exit on high confidence: if the evaluator is very confident
        // the output passes, skip remaining cycles. Re-evaluating a clearly
        // passing output adds ~$0.0003/cycle with zero accuracy gain.
        if (evalResult.confidence >= 0.95) {
          log.info({ node_id: nodeId, cycle: cycle + 1, confidence: evalResult.confidence }, 'Reflexion passed with high confidence — early exit')
        } else {
          log.info({ node_id: nodeId, cycle: cycle + 1 }, 'Reflexion passed criterion')
        }
        break
      }

      log.info({ node_id: nodeId, cycle: cycle + 1, reason: evalResult.reason }, 'Reflexion cycle failed')

      // On the last cycle, check on_failure policy
      if (cycle === maxCycles - 1) {
        const policy = reflexion.on_failure ?? 'fallback'
        if (policy === 'fallback' && (cfg.fallback || cfg.fallbacks?.length)) {
          output = this.selectAiFallback(cfg, ctx, nodeId)
        }
        // 'human_approval' and 'retry' just return the last output with a note
        if (policy === 'human_approval') {
          output = `[NEEDS REVIEW — criterion not met after ${maxCycles} attempts] ${output}`
        }
        break
      }

      // Retry generation with the failure reason as an additional constraint
      const retrySystem = `${resolveTemplate(cfg.system ?? 'You are a helpful assistant.', ctx)}

## Quality requirement (MUST satisfy)
${reflexion.criterion}

## Previous attempt failed this check
${evalResult.reason ?? 'The output did not satisfy the criterion.'}

Please revise your response to satisfy the requirement.`

      try {
        output = await this.execCtx.llmFn(retrySystem, resolveTemplate(cfg.prompt, ctx), model)
      } catch {
        break // retry generation failed — return last known output
      }
    }

    return output
  }

  // ── HTTP ─────────────────────────────────────────────────────────────

  private async runHttp(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = resolveTemplateObject(node.config as unknown as HttpConfig, ctx)
    const updates: Partial<WorkflowState> = {}

    try {
      const init: RequestInit = {
        method: cfg.method,
        headers: { 'Content-Type': 'application/json', ...cfg.headers },
      }
      if (cfg.body && cfg.method !== 'GET') {
        init.body = JSON.stringify(cfg.body)
      }

      assertExternalUrlAllowed(cfg.url, `workflow node ${node.id}`)
      const res = await this.execCtx.fetchFn(cfg.url, init)
      const body = res.ok ? await res.json().catch(() => ({})) : {}

      // Map response fields to state using JSONPath-like output spec
      if (cfg.output) {
        for (const [stateKey, jsonPath] of Object.entries(cfg.output)) {
          updates[stateKey] = extractJsonPath({ body, status: res.status }, jsonPath)
        }
      }

      updates[`__http_${node.id}_status`] = res.status
    } catch (err) {
      log.error({ node_id: node.id, err }, 'HttpNode request failed')
      updates[`__http_${node.id}_error`] = String(err)
    }

    return updates
  }

  // ── Human Approval ────────────────────────────────────────────────────
  // If we're resuming after approval, return the resolution; otherwise throw InterruptSignal.

  private async runHumanApproval(
    node: WorkflowNodeDef,
    ctx: TemplateContext,
    state: WorkflowState,
  ): Promise<Partial<WorkflowState>> {
    const cfg = node.config as unknown as HumanApprovalConfig
    const { pendingApproval } = this.execCtx

    // Autonomous bypass: skip the approval gate entirely when the tenant has
    // opted into auto-execution for this condition — no InterruptSignal, no
    // approval record, no SSE, no click. Checked before the resume branch so
    // it only ever applies on first entry, never to an in-flight approval.
    if (cfg.auto_approve_condition && pendingApproval?.nodeId !== node.id) {
      try {
        const fn = compileExpression(cfg.auto_approve_condition)
        // Strict === true, not just truthy: filtrex doesn't throw for a
        // missing/unknown property reference — it returns the internal
        // UnknownPropertyError object as the expression's result, which is
        // itself truthy. A loose truthy check here would fail OPEN (bypass
        // the approval gate) on malformed or incomplete state instead of
        // failing closed to human review, which is the one thing this gate
        // must never do.
        if (fn(state as Record<string, unknown>) === true) {
          return { __outcome: cfg.auto_approve_outcome ?? 'auto_execute' }
        }
      } catch (err) {
        log.warn({ node_id: node.id, err }, 'auto_approve_condition failed to evaluate — falling back to human approval')
      }
    }

    // Resuming: human already responded
    if (pendingApproval?.nodeId === node.id) {
      const updates: Partial<WorkflowState> = {
        __outcome: pendingApproval.action,
      }
      if (pendingApproval.edits) {
        Object.assign(updates, pendingApproval.edits)
      }
      
      // Check max_auto_approve_per_day cap if this is an auto-approval from timeout
      if (pendingApproval.action === 'auto_approve' && cfg.max_auto_approve_per_day) {
        const counterKey = `__auto_approve_count_${this.execCtx.workflowId}_${new Date().toDateString()}`
        const currentCount = (this.execCtx.nodeOutputs[counterKey] as number) || 0
        if (currentCount >= cfg.max_auto_approve_per_day) {
          log.warn({ 
            node_id: node.id, 
            workflow_id: this.execCtx.workflowId, 
            cap: cfg.max_auto_approve_per_day 
          }, 'max_auto_approve_per_day cap exceeded, falling back to auto_dismiss')
          updates.__outcome = 'auto_dismiss'
        } else {
          // Increment the counter
          this.execCtx.nodeOutputs[counterKey] = currentCount + 1
        }
      }
      
      return updates
    }

    // First time: interrupt execution and request human input
    const timeoutMs = parseDuration(cfg.timeout ?? '24h')
    const timeoutAt = new Date(Date.now() + timeoutMs)

    const approvalRequest: InterruptSignal['approvalRequest'] = {
      workflow_run_id: this.execCtx.runId,
      workflow_id: this.execCtx.workflowId,
      workflow_name: this.execCtx.workflowName,
      node_id: node.id,
      node_label: node.label,
      tenant_id: this.execCtx.tenantId,
      urgency: (cfg.urgency ?? 'high') as ApprovalRequest['urgency'],
      display: cfg.display.map(d => ({
        label: d.label,
        value: resolveTemplate(d.value, ctx),
        type: 'text' as const,
      })),
      actions: cfg.actions,
      timeout_at: timeoutAt,
      dedup_key: String((ctx.event as Record<string, unknown> | undefined)?.['ticker'] ?? 'account'),
    }

    // Throw to suspend graph execution — caught by WorkflowEngine
    throw new InterruptSignal(approvalRequest)
  }

  // ── Trade Intent ─────────────────────────────────────────────────────
  // Always runs (single-node wave — never fanned out with a sibling, so it
  // can't hit the parallel-execution/edge-condition gap in
  // WorkflowEngine.execute()). Pure pass-through unless the upstream node
  // set __outcome to an execution outcome; never calls a broker or
  // connector directly — only ever creates a `pending_trades` record via
  // the injected fn, which still goes through the full guarded confirm path.

  private async runTradeIntent(node: WorkflowNodeDef, state: WorkflowState): Promise<Partial<WorkflowState>> {
    // Gap #8 (TRADING_ENGINE_GAPS.md): the manual approval path was a dead
    // end — clicking 'Propose trim to target weight' (action id: propose_trim)
    // only sent a Slack notification, never created a trade. The button
    // implies a trim will be actioned, but the old check
    // (state['__outcome'] !== 'auto_execute') meant only the autonomous
    // bypass path ever reached createPendingTradeFn. Now also fire on
    // 'propose_trim' — the human-approved action. This uses origin: 'manual'
    // (set by createPendingTradeFn in server.ts) and goes through the exact
    // same guarded confirm/cancel path (5-minute window, evaluateTradeExecution
    // caps) as the auto path. The only difference is origin — the human
    // explicitly clicked "propose trim" rather than the auto-approval bypass.
    const outcome = state['__outcome']
    if (outcome !== 'auto_execute' && outcome !== 'propose_trim') return {}

    const { createPendingTradeFn, triggerEvent, tenantId } = this.execCtx
    if (!createPendingTradeFn || !triggerEvent.detector_id) return {}

    try {
      const result = await createPendingTradeFn({
        tenantId,
        detectorId: triggerEvent.detector_id,
        eventData: triggerEvent.data,
        // origin: 'manual' for human-approved propose_trim, 'auto' for the
        // autonomous bypass. createPendingTradeFn in server.ts uses this to
        // set the pending trade's origin field, which controls the
        // confirmation window and audit trail.
        origin: outcome === 'propose_trim' ? 'manual' : 'auto',
        // Persist a durable link from the trade back to the specific detector
        // event and insight that caused it — without this there's no way to
        // answer "which alert caused this trade" after the fact. See
        // TRADING_ENGINE_GAPS.md gap #25.
        sourceEventId: triggerEvent.id,
        sourceInsightId: triggerEvent.insight_id,
        // Gap #32: thread goal_id from the event data (set by the detector
        // from feature_snapshot) into the pending trade, creating the durable
        // link from trade → goal that the goal dashboard needs for attribution.
        goalId: typeof triggerEvent.data['goal_id'] === 'string'
          ? triggerEvent.data['goal_id'] as string
          : undefined,
      })
      return { __trade_intent_created: result.created, __trade_intent_id: result.tradeId, __trade_intent_reason: result.reason }
    } catch (err) {
      log.error({ node_id: node.id, err }, 'trade_intent failed')
      return { __trade_intent_created: false, __trade_intent_error: String(err) }
    }
  }

  // ── Connector Action ──────────────────────────────────────────────────

  private async runConnectorAction(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = resolveTemplateObject(node.config as unknown as ConnectorActionConfig, ctx)
    const updates: Partial<WorkflowState> = {}

    // Use real ConnectorActionExecutor if available (injected by WorkflowEngine)
    if (this.execCtx.connectorExecutor) {
      try {
        const result = await this.execCtx.connectorExecutor.execute(
          this.execCtx.tenantId,
          cfg.connector,
          cfg.action,
          (cfg.params ?? {}) as Record<string, unknown>,
        )
        updates[`__action_${node.id}_ok`] = result.ok
        updates[`__action_${node.id}_status`] = result.status
        if (!result.ok && result.error) {
          updates[`__action_${node.id}_error`] = result.error
          log.error({ connector: cfg.connector, action: cfg.action, error: result.error }, 'ConnectorAction failed')
        } else {
          // Merge action state updates (id, url, post_id, etc.)
          Object.assign(updates, result.state_updates)
        }
      } catch (err) {
        log.error({ node_id: node.id, err }, 'ConnectorAction executor threw')
        updates[`__action_${node.id}_error`] = String(err)
      }
      return updates
    }

    // Fallback: direct HTTP (legacy / dev mode without DB)
    try {
      const actionUrl = `/connectors/${cfg.connector}/actions/${cfg.action}`
      const res = await this.execCtx.fetchFn(`http://localhost:3001${actionUrl}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg.params),
      })
      const body = res.ok ? await res.json().catch(() => ({})) as Record<string, unknown> : {}
      updates[`__action_${node.id}_ok`] = res.ok
      updates[`__action_${node.id}_status`] = res.status
      if (res.ok) Object.assign(updates, body)
    } catch (err) {
      log.error({ node_id: node.id, err }, 'ConnectorAction HTTP fallback failed')
      updates[`__action_${node.id}_error`] = String(err)
    }

    return updates
  }

  // ── Notify ─────────────────────────────────────────────────────────────

  private async runNotify(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = node.config as unknown as NotifyConfig
    const message = resolveTemplate(cfg.template, ctx)
    const dest = resolveTemplate(cfg.destination, ctx)

    try {
      await this.execCtx.notifyFn(cfg.channel, dest, message)
    } catch (err) {
      log.error({ node_id: node.id, err }, 'NotifyNode failed')
    }

    return {}
  }

  // ── Wait ────────────────────────────────────────────────────────────────

  private async runWait(node: WorkflowNodeDef, _ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = node.config as unknown as WaitConfig
    const ms = parseDuration(cfg.duration)
    // In production: schedule resume via job queue (not blocking sleep)
    // For demo: short waits only
    if (ms <= 60000) {
      await new Promise(r => setTimeout(r, ms))
    } else {
      log.warn({ node_id: node.id, duration: cfg.duration }, 'WaitNode skipping long wait in dev mode')
    }
    return {}
  }

  // ── Transform ────────────────────────────────────────────────────────────

  private async runTransform(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = node.config as unknown as TransformConfig
    const updates: Partial<WorkflowState> = {}
    for (const [key, template] of Object.entries(cfg.mappings)) {
      updates[key] = resolveTemplate(template, ctx)
    }
    return updates
  }

  // ── Skill ────────────────────────────────────────────────────────────────
  // Runs one of the 12 AI skill primitives (classify/extract/summarize/etc.)

  private async runSkill(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const raw = resolveTemplateObject(node.config as unknown as Record<string, unknown>, ctx)
    const cfg = raw as unknown as SkillConfig
    const skillEngine = new SkillEngine(this.execCtx.llmFn)
    try {
      const result = await skillEngine.run(cfg)
      // Store skill output in memory
      if (this.execCtx.memory && cfg.output_key) {
        this.execCtx.memory.remember({
          key: `${node.id}_last_output`,
          value: result[cfg.output_key] ?? result,
          summary: JSON.stringify(result).slice(0, 200),
          tags: [node.id, cfg.skill, 'skill'],
          runId: this.execCtx.runId,
          nodeId: node.id,
          ttlDays: 14,
          memoryType: 'episodic',
        }).catch(() => {})
      }
      return result
    } catch (err) {
      log.error({ node_id: node.id, err }, 'SkillNode failed')
      return { [`__skill_${node.id}_error`]: String(err) }
    }
  }

  // ── Detector ────────────────────────────────────────────────────────────────

  private async runDetector(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = node.config as { detector_id: string; [key: string]: unknown }
    const detectorId = cfg.detector_id as keyof typeof detectors

    if (!detectorId || !(detectorId in detectors)) {
      log.error({ node_id: node.id, detector_id: detectorId }, 'Detector not found in registry')
      return { [`__detector_${node.id}_error`]: `Detector not found: ${detectorId}` }
    }

    const detector = detectors[detectorId] as Detector<unknown, unknown>

    // Build detector context
    const detectorContext: DetectorContext = {
      tenant_id: this.execCtx.tenantId,
      logger: {
        info: (message, meta) => log.info({ node_id: node.id, ...meta }, message),
        warn: (message, meta) => log.warn({ node_id: node.id, ...meta }, message),
        error: (message, meta) => log.error({ node_id: node.id, ...meta }, message),
      },
    }

    // Resolve config values from template context
    const resolvedConfig = resolveTemplateObject(cfg, ctx)

    try {
      const signal = await detector.execute(detectorContext, resolvedConfig)
      
      // Extract output mapping if specified
      const result: Partial<WorkflowState> = {}
      if (node.output) {
        for (const [stateKey, jsonPath] of Object.entries(node.output)) {
          const value = extractJsonPath(signal, jsonPath)
          if (value !== undefined) {
            result[stateKey] = value
          }
        }
      }
      
      // Always store the full signal data under a default key
      result[`${node.id}_signal`] = signal.data
      result[`${node.id}_metadata`] = signal.metadata
      
      return result
    } catch (err) {
      log.error({ node_id: node.id, detector_id: detectorId, err }, 'Detector execution failed')
      return { [`__detector_${node.id}_error`]: String(err) }
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  // A loop node sets up iteration context in state.
  //
  // ARCHITECTURE NOTE: True per-item graph iteration (running downstream nodes
  // for each item) requires the WorkflowEngine to re-enter the subgraph for
  // each iteration — a loop body is a sub-graph, not a single node.
  // The current flat graph executor does not yet support this.
  //
  // What this node DOES provide today:
  //  - `{item_key}`        — the current item (first item on entry; incremented
  //                          by the engine via `__loop_{nodeId}_cursor` on each pass)
  //  - `{item_key}_index`  — 0-based index of the current item
  //  - `{item_key}_count`  — total number of items
  //  - `{item_key}_all`    — the full (capped) item array for batch transforms
  //  - `__loop_{nodeId}_remaining` — items not yet processed (for conditional edges)
  //
  // Downstream nodes can fan-out over `{item_key}_all` using a transform node,
  // or use `__loop_{nodeId}_remaining` to drive a conditional edge back to
  // the loop node for the next iteration.

  private async runLoop(node: WorkflowNodeDef, _ctx: TemplateContext, state: WorkflowState): Promise<Partial<WorkflowState>> {
    const cfg = node.config as unknown as { items_key: string; item_key: string; max_iterations?: number }
    const items = (state[cfg.items_key] ?? []) as unknown[]
    const max = Math.min(items.length, cfg.max_iterations ?? 100)

    // Determine current iteration cursor (persisted in state across loop-back edges)
    const cursorKey = `__loop_${node.id}_cursor`
    const cursor = typeof state[cursorKey] === 'number' ? (state[cursorKey] as number) : 0
    const cappedItems = items.slice(0, max)

    return {
      [cfg.item_key]: cappedItems[cursor] ?? null,
      [`${cfg.item_key}_index`]: cursor,
      [`${cfg.item_key}_count`]: cappedItems.length,
      [`${cfg.item_key}_all`]: cappedItems,
      [cursorKey]: cursor + 1,
      [`__loop_${node.id}_remaining`]: cappedItems.slice(cursor + 1),
      [`__loop_${node.id}_done`]: cursor >= cappedItems.length - 1,
    }
  }

  // ── Sub-workflow ──────────────────────────────────────────────────────────
  // Triggers another workflow and optionally waits for its result

  private async runSubWorkflow(node: WorkflowNodeDef, ctx: TemplateContext): Promise<Partial<WorkflowState>> {
    const cfg = resolveTemplateObject(node.config as unknown as { workflow_id: string; input: Record<string, unknown>; output_key?: string }, ctx)
    // Sub-workflow triggering is handled by the engine via internal event
    // The engine will inject a __sub_workflow_fn into execCtx when available
    const fn = (this.execCtx as unknown as Record<string, unknown>).triggerSubWorkflow as ((id: string, input: Record<string, unknown>) => Promise<string>) | undefined
    if (fn) {
      try {
        const runId = await fn(cfg.workflow_id as string, (cfg.input ?? {}) as Record<string, unknown>)
        return { [cfg.output_key as string ?? `__sub_${node.id}_run_id`]: runId }
      } catch (err) {
        return { [`__sub_${node.id}_error`]: String(err) }
      }
    }
    log.warn({ node_id: node.id }, 'SubWorkflow: no triggerSubWorkflow fn registered')
    return {}
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildTemplateContext(state: WorkflowState): TemplateContext {
    return {
      state: state as Record<string, unknown>,
      event: this.execCtx.triggerEvent.data,
      tenant: { id: this.execCtx.tenantId },
      nodes: this.execCtx.nodeOutputs,
    }
  }
}
