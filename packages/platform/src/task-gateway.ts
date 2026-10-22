/**
 * AI Task Gateway — the mandatory policy resolution point for every model
 * call (ARCHITECTURE.md §8.4, PRD-142, CLAUDE.md rule 3).
 *
 * The task registry (definitions/ai-tasks.yaml) declares what a task is
 * allowed to do: which models, how much input/output, how long it may run,
 * which data boundary applies. This module enforces that contract at call
 * time instead of trusting each call site:
 *
 *   - unknown task_id           → TaskPolicyError (fail closed in
 *                               production; warn + permissive default in dev)
 *   - model outside allowlist   → TaskPolicyError
 *   - input over token ceiling  → TaskPolicyError
 *   - budget exhausted          → BudgetExhaustedError (existing check)
 *   - call over deadline        → TaskDeadlineError
 *   - provider incident         → per-task circuit breaker fails fast
 *   - input/output guards       → applied here, symmetric across providers —
 *                               the local path previously skipped them
 *   - usage                     → reported through the router's onUsage and
 *                               attributed to (task, tenant) via
 *                               llmCallContext
 *
 * Call sites keep the plain LlmFn/DecisionFn shape — they change only WHERE
 * the function comes from (governedLlm / governedDecide), which is what the
 * tripwire test enforces.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from './logger.js'
import type { LlmCallOptions, LlmFn } from './llm.js'
import type { DecisionFn, LocalDecisionRequest, LocalDecisionResult } from './local-decision.js'
import { LlmInputGuard, LlmOutputGuard, type LlmGuardEvent } from './llm-guards.js'
import { getCircuitBreaker } from './llm-circuit-breaker.js'
import { BudgetExhaustedError } from './structured-llm.js'
import type { GuardEventSink } from './guard-event-sink.js'
import type { LlmBudgetDecision } from './llm-budget.js'
import {
  checkProcessorForTask,
  type ProcessorRegistry,
  type ProcessorViolation,
} from './ai-processors.js'

const log = createLogger({ service: 'task-gateway', version: '0.0.0' })

// ── Task policy (enforceable subset of ARCHITECTURE.md §8.4 AiTaskPolicy) ──

export interface AiTaskPolicy {
  task_id: string
  purpose?: string
  risk?: 'internal' | 'user_visible' | 'workflow_affecting' | 'external_effect'
  authority?: 'language_only' | 'candidate_for_review' | 'bounded_decision'
  /** `lifekeel_infra` may fall back to hosted when the local model is
   *  undeployed; `lifekeel_infra_required` fails closed instead — for
   *  tasks whose data must never leave LifeKeel-operated infrastructure. */
  data_boundary:
    'device_only' | 'lifekeel_infra' | 'lifekeel_infra_required' | 'approved_hosted_provider'
  processor_terms_ref?: string
  provider_retention_class?:
    'none' | 'service_transient' | 'zero_data_retention' | 'limited_abuse_log'
  allowed_models: string[]
  primary_model: string
  /** `on_device` = the feature prefers on-device execution; each
   *  server-side invocation is an *authorized fallback* and is counted as
   *  a device_escalation metric so coverage can be measured. For a hard
   *  boundary use `data_boundary: device_only` (no server path at all). */
  preferred_execution?:
    | 'deterministic'
    | 'local_encoder'
    | 'local_cpu'
    | 'on_device'
    | 'hosted_sync'
    | 'hosted_batch'
    | 'self_hosted_accelerated'
  deadline_ms: number
  max_input_tokens: number
  max_output_tokens: number
  budget_class?: string
  guard_policy?: string
  /** Processor ids (definitions/ai-processors.yaml) that may serve this task. */
  allowed_processors?: string[]
}

export type TaskRegistry = Map<string, AiTaskPolicy>

/** Closed enums — a typo'd value must fail load, not silently pass. */
const ENUM_FIELDS: ReadonlyArray<{
  field: keyof AiTaskPolicy
  values: readonly string[]
}> = [
  {
    field: 'data_boundary',
    values: [
      'device_only',
      'lifekeel_infra',
      'lifekeel_infra_required',
      'approved_hosted_provider',
    ],
  },
  {
    field: 'preferred_execution',
    values: [
      'deterministic',
      'local_encoder',
      'local_cpu',
      'on_device',
      'hosted_sync',
      'hosted_batch',
      'self_hosted_accelerated',
    ],
  },
  {
    field: 'risk',
    values: ['internal', 'user_visible', 'workflow_affecting', 'external_effect'],
  },
  {
    field: 'authority',
    values: ['language_only', 'candidate_for_review', 'bounded_decision'],
  },
  {
    field: 'provider_retention_class',
    values: ['none', 'service_transient', 'zero_data_retention', 'limited_abuse_log'],
  },
]

/** Required fields — an entry missing any of these is rejected at load. */
const REQUIRED_POLICY_FIELDS: ReadonlyArray<keyof AiTaskPolicy> = [
  'purpose',
  'data_boundary',
  'processor_terms_ref',
  'provider_retention_class',
  'allowed_models',
  'primary_model',
  'deadline_ms',
  'max_input_tokens',
  'max_output_tokens',
]

export class TaskPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskPolicyError'
  }
}

/**
 * A call was refused because the processor that would serve it is not approved
 * for this task (PRD-142). Typed and final: the gateway never falls back to a
 * different provider.
 */
export class ProcessorPolicyError extends TaskPolicyError {
  constructor(public readonly violation: ProcessorViolation) {
    super(`Processor policy: ${violation.detail}`)
    this.name = 'ProcessorPolicyError'
  }
}

export class TaskDeadlineError extends Error {
  constructor(taskId: string, deadlineMs: number) {
    super(`Task '${taskId}' exceeded its ${deadlineMs}ms deadline`)
    this.name = 'TaskDeadlineError'
  }
}

/**
 * Validate a parsed YAML document into a registry. Structural checks only —
 * the loader decides whether an invalid doc is fatal (production) or a
 * warning (dev), because a permissive dev default keeps local runs working
 * without the definitions checkout.
 */
export function parseTaskRegistry(doc: unknown): TaskRegistry {
  if (doc === null || typeof doc !== 'object') {
    throw new TaskPolicyError('Task registry is not a mapping document')
  }
  const tasks = (doc as Record<string, unknown>)['tasks']
  if (tasks === null || typeof tasks !== 'object') {
    throw new TaskPolicyError("Task registry has no 'tasks' mapping")
  }
  const registry: TaskRegistry = new Map()
  for (const [taskId, raw] of Object.entries(tasks as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') {
      throw new TaskPolicyError(`Task '${taskId}' is not a mapping`)
    }
    const policy = raw as Record<string, unknown>
    for (const field of REQUIRED_POLICY_FIELDS) {
      if (policy[field] === undefined || policy[field] === null || policy[field] === '') {
        throw new TaskPolicyError(`Task '${taskId}' is missing required field '${field}'`)
      }
    }
    const allowed = policy['allowed_models']
    if (!Array.isArray(allowed) || allowed.length === 0) {
      throw new TaskPolicyError(`Task '${taskId}' has an empty allowed_models list`)
    }
    for (const { field, values } of ENUM_FIELDS) {
      const value = policy[field]
      if (value !== undefined && !values.includes(value as string)) {
        throw new TaskPolicyError(
          `Task '${taskId}' has invalid ${field} '${String(value)}' — expected one of: ${values.join(', ')}`,
        )
      }
    }
    const procs = policy['allowed_processors']
    if (!Array.isArray(procs) || procs.some((x) => typeof x !== 'string' || x === '')) {
      throw new TaskPolicyError(`Task '${taskId}' needs an allowed_processors list`)
    }
    // A device_only task has no server-side processor; every other task must name at least one.
    if ((policy['data_boundary'] === 'device_only') !== (procs.length === 0)) {
      throw new TaskPolicyError(
        `Task '${taskId}': allowed_processors must be empty for device_only tasks and non-empty for all others`,
      )
    }
    registry.set(taskId, { ...(policy as unknown as AiTaskPolicy), task_id: taskId })
  }
  if (registry.size === 0) throw new TaskPolicyError('Task registry contains no tasks')
  return registry
}

/** Permissive policy used when a dev-mode call names an unregistered task. */
const DEV_FALLBACK_POLICY: Omit<AiTaskPolicy, 'task_id'> = {
  data_boundary: 'approved_hosted_provider',
  allowed_models: ['tier:fast', 'tier:balanced', 'tier:powerful'],
  primary_model: 'tier:fast',
  deadline_ms: 60_000,
  max_input_tokens: 16_000,
  max_output_tokens: 4_000,
}

/**
 * Resolve a task's policy. In production an unknown task_id is a hard
 * failure — the call never reaches a provider. In dev it warns and returns
 * a permissive default so unregistered experiments still run locally.
 */
export function resolveTaskPolicy(
  registry: TaskRegistry,
  taskId: string,
  failClosed: boolean,
): AiTaskPolicy {
  const policy = registry.get(taskId)
  if (policy) return policy
  if (failClosed) {
    throw new TaskPolicyError(
      `Unknown AI task '${taskId}' — register it in definitions/ai-tasks.yaml before calling`,
    )
  }
  log.warn({ task_id: taskId }, 'Unknown AI task — running under permissive dev default')
  return { ...DEV_FALLBACK_POLICY, task_id: taskId }
}

// ── Per-call context ──────────────────────────────────────────────────────

export interface LlmCallContext {
  task_id: string
  tenant_id: string
}

/**
 * Carries (task, tenant) from governedLlm into the router's onUsage
 * callback, so the CostLedger record is attributed to the task that caused
 * it — not just the tenant. AsyncLocalStorage keeps it correct under
 * concurrent calls sharing one router.
 */
export const llmCallContext = new AsyncLocalStorage<LlmCallContext>()

// ── Gateway dependencies ──────────────────────────────────────────────────

export interface TaskGatewayDeps {
  registry: TaskRegistry
  /**
   * Fail closed on unknown task_ids. The app wires this to
   * "not dev mode"; it defaults to NODE_ENV === 'production'.
   */
  failClosed?: boolean
  /** Per-tenant budget check run before the provider call. `policy` lets the
   *  guard differentiate batch vs interactive tasks (Stage B8 plan caps
   *  only deny batch-class spend). */
  budgetGuard?: {
    check(tenantId: string, detectorId?: string, policy?: AiTaskPolicy): Promise<LlmBudgetDecision>
  }
  /** Receives guard events (injection, PII redaction, forbidden output). */
  guardEventSink?: GuardEventSink
  /**
   * Processor approval (PRD-142). `off` skips it, `warn` reports a violation
   * through `onProcessorViolation` and still serves the call, `enforce` refuses
   * with ProcessorPolicyError. Absent means off.
   */
  processorGuard?: {
    mode: 'off' | 'warn' | 'enforce'
    registry: ProcessorRegistry
    /** Which processor will serve a task here (mirrors the app's provider selection). */
    resolveProcessor: (policy: AiTaskPolicy) => string | null
    now?: () => Date
    onProcessorViolation?: (v: ProcessorViolation, mode: 'warn' | 'enforce') => void
  }
  /** Called after every governed call, success or failure, for telemetry. */
  onCall?: (event: {
    task_id: string
    tenant_id: string
    model: string
    ok: boolean
    latency_ms: number
  }) => void
  /**
   * Fired at invocation time when a `on_device` task reaches the
   * server path — i.e. the device tier was unavailable or abstained and
   * this call is an authorized fallback. Emitted once per call attempt
   * (not at policy resolution) so the device-vs-hosted coverage ratio is
   * measured on real invocations, not wrapped functions. Task_id only —
   * no content.
   */
  onDeviceEscalation?: (taskId: string) => void
}

/**
 * Apply the processor check before any provider is contacted. `processor`
 * overrides the resolver for paths that know their provider (vision).
 */
function enforceProcessor(
  deps: TaskGatewayDeps,
  policy: AiTaskPolicy,
  model: string,
  processor?: string,
): void {
  const guard = deps.processorGuard
  if (!guard || guard.mode === 'off') return
  const id = processor ?? guard.resolveProcessor(policy)
  // A null processor is a path with no model provider at all (device_only has no
  // server path), so there is nothing to check.
  if (!id) return
  const violation = checkProcessorForTask(
    guard.registry,
    policy,
    id,
    model,
    guard.now?.() ?? new Date(),
  )
  if (!violation) return
  try {
    guard.onProcessorViolation?.(violation, guard.mode)
  } catch {
    /* telemetry must never fail a call */
  }
  if (guard.mode === 'enforce') throw new ProcessorPolicyError(violation)
}

function isFailClosed(deps: TaskGatewayDeps): boolean {
  return deps.failClosed ?? process.env['NODE_ENV'] === 'production'
}

/** Rough token estimate — 4 chars/token is close enough for ceilings. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

async function withDeadline<T>(
  taskId: string,
  deadlineMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // A racing-out deadline that leaves the provider running creates
          // orphaned generations and backlog (the October Ask Keel outage).
          // Abort so the transport actually stops.
          controller.abort()
          reject(new TaskDeadlineError(taskId, deadlineMs))
        }, deadlineMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

// ── Governed function factories ───────────────────────────────────────────

/**
 * Wrap an LlmFn in task policy. The returned function has the same
 * signature, so call sites drop it in where the raw fn was used; the
 * enforcement is inside.
 */
export function governedLlm(
  base: LlmFn,
  deps: TaskGatewayDeps,
  taskId: string,
  tenantId: string,
  opts: { detectorId?: string } = {},
): LlmFn {
  const policy = resolveTaskPolicy(deps.registry, taskId, isFailClosed(deps))
  const breaker = getCircuitBreaker(`task:${taskId}`)
  const inputGuard = new LlmInputGuard({ tenantId })
  const outputGuard = new LlmOutputGuard({ tenantId })

  return async function governed(system: string, prompt: string, model?: string): Promise<string> {
    if (policy.preferred_execution === 'on_device') {
      try {
        deps.onDeviceEscalation?.(taskId)
      } catch {
        /* metrics must never fail a call */
      }
    }
    const resolvedModel = model ?? policy.primary_model
    if (!policy.allowed_models.includes(resolvedModel)) {
      throw new TaskPolicyError(
        `Model '${resolvedModel}' is not in task '${taskId}' allowlist [${policy.allowed_models.join(', ')}]`,
      )
    }
    if (estimateTokens(system) + estimateTokens(prompt) > policy.max_input_tokens) {
      throw new TaskPolicyError(
        `Task '${taskId}' input exceeds its ${policy.max_input_tokens}-token ceiling`,
      )
    }
    enforceProcessor(deps, policy, resolvedModel)

    if (deps.budgetGuard) {
      const decision = await deps.budgetGuard.check(tenantId, opts.detectorId, policy)
      if (!decision.allowed) {
        throw new BudgetExhaustedError(
          `LLM budget exceeded for tenant ${tenantId}: ${decision.reason}`,
          decision,
        )
      }
    }

    const guardedPrompt = inputGuard.guard(prompt)
    const started = Date.now()
    let ok = false
    try {
      // callOnce: the provider-level retry inside the router stays the
      // single transport retry layer; the breaker only counts outcomes.
      const raw = await breaker.callOnce(() =>
        withDeadline(taskId, policy.deadline_ms, (signal) =>
          llmCallContext.run({ task_id: taskId, tenant_id: tenantId }, () =>
            base(system, guardedPrompt.value, resolvedModel, { signal }),
          ),
        ),
      )
      ok = true
      const guardedOutput = outputGuard.guard(raw)
      const events = [...guardedPrompt.events, ...guardedOutput.events]
      if (events.length > 0) void deps.guardEventSink?.(events).catch(() => {})
      return guardedOutput.value
    } catch (err) {
      const events: LlmGuardEvent[] = [...guardedPrompt.events]
      if (events.length > 0) void deps.guardEventSink?.(events).catch(() => {})
      throw err
    } finally {
      try {
        deps.onCall?.({
          task_id: taskId,
          tenant_id: tenantId,
          model: resolvedModel,
          ok,
          latency_ms: Date.now() - started,
        })
      } catch {
        /* metrics must never fail a call */
      }
    }
  }
}

/**
 * Vision call shape — the OpenAI-compatible message `content` array minus
 * the role wrapper. Carries image parts an LlmFn's string prompt cannot.
 */
export type VisionContent = Array<
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
>
export type VisionFn = (content: VisionContent, opts?: LlmCallOptions) => Promise<string>

/**
 * Wrap a VisionFn in the same policy as text calls: input guard on the
 * text parts, token ceiling on the text, deadline, per-task breaker, usage
 * context. Image bytes are not token-estimated — the input ceiling still
 * bounds the text the caller controls.
 */
export function governedVision(
  base: VisionFn,
  deps: TaskGatewayDeps,
  taskId: string,
  tenantId: string,
  opts: { processor?: string } = {},
): VisionFn {
  const policy = resolveTaskPolicy(deps.registry, taskId, isFailClosed(deps))
  const breaker = getCircuitBreaker(`task:${taskId}`)
  const inputGuard = new LlmInputGuard({ tenantId })
  const outputGuard = new LlmOutputGuard({ tenantId })

  return async function vision(content: VisionContent): Promise<string> {
    if (policy.preferred_execution === 'on_device') {
      try {
        deps.onDeviceEscalation?.(taskId)
      } catch {
        /* metrics must never fail a call */
      }
    }
    const textTokens = content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .reduce((n, c) => n + estimateTokens(c.text), 0)
    if (textTokens > policy.max_input_tokens) {
      throw new TaskPolicyError(
        `Task '${taskId}' input exceeds its ${policy.max_input_tokens}-token ceiling`,
      )
    }
    enforceProcessor(deps, policy, policy.primary_model, opts.processor)
    const guarded = content.map((c) =>
      c.type === 'text' ? { ...c, text: inputGuard.guard(c.text).value } : c,
    ) as VisionContent
    const t0 = Date.now()
    let ok = false
    try {
      const raw = await breaker.callOnce(() =>
        withDeadline(taskId, policy.deadline_ms, (signal) =>
          llmCallContext.run({ task_id: taskId, tenant_id: tenantId }, () =>
            base(guarded, { signal }),
          ),
        ),
      )
      ok = true
      return outputGuard.guard(raw).value
    } finally {
      try {
        deps.onCall?.({
          task_id: taskId,
          tenant_id: tenantId,
          model: policy.primary_model,
          ok,
          latency_ms: Date.now() - t0,
        })
      } catch {
        /* metrics must never fail a call */
      }
    }
  }
}

/**
 * Wrap a DecisionFn (structured local decisions) in the same policy:
 * input guard, deadline, per-task breaker, usage context. The output is
 * already Zod-validated inside the decision fn, so the output guard is
 * redundant there.
 */
export function governedDecide(
  base: DecisionFn,
  deps: TaskGatewayDeps,
  taskId: string,
  tenantId: string,
  opts: { processor?: string } = {},
): DecisionFn {
  const policy = resolveTaskPolicy(deps.registry, taskId, isFailClosed(deps))
  const breaker = getCircuitBreaker(`task:${taskId}`)
  const inputGuard = new LlmInputGuard({ tenantId })

  return async function decide<T>(req: LocalDecisionRequest<T>): Promise<LocalDecisionResult<T>> {
    if (estimateTokens(req.system) + estimateTokens(req.prompt) > policy.max_input_tokens) {
      throw new TaskPolicyError(
        `Task '${taskId}' input exceeds its ${policy.max_input_tokens}-token ceiling`,
      )
    }
    enforceProcessor(deps, policy, policy.primary_model, opts.processor)
    const guardedPrompt = inputGuard.guard(req.prompt)
    const t0 = Date.now()
    let ok = false
    try {
      const result = await breaker.callOnce(() =>
        withDeadline(taskId, policy.deadline_ms, (signal) =>
          llmCallContext.run({ task_id: taskId, tenant_id: tenantId }, () =>
            base({ ...req, prompt: guardedPrompt.value }, { signal }),
          ),
        ),
      )
      ok = true
      if (guardedPrompt.events.length > 0) {
        void deps.guardEventSink?.(guardedPrompt.events).catch(() => {})
      }
      return result
    } catch (err) {
      if (guardedPrompt.events.length > 0) {
        void deps.guardEventSink?.(guardedPrompt.events).catch(() => {})
      }
      throw err
    } finally {
      try {
        deps.onCall?.({
          task_id: taskId,
          tenant_id: tenantId,
          model: policy.primary_model,
          ok,
          latency_ms: Date.now() - t0,
        })
      } catch {
        /* metrics must never fail a call */
      }
    }
  }
}
