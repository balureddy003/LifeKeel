/**
 * Task gateway wiring — the single place the API turns an LlmFn/DecisionFn
 * into a policy-governed one (ARCHITECTURE.md §8.4, PRD-142, intent 01).
 *
 * Boot: initTaskGateway(db) loads definitions/ai-tasks.yaml and builds the
 * dependency set (budget guard, guard-event sink, usage→cost ledger).
 * Call sites then use:
 *
 *   taskLlm('email.policy_relevance.v1', tenantId)        → governed LlmFn
 *   taskLlmFor('insight.score_enrichment.v1')             → (tenantId) => governed LlmFn
 *   taskDecide('insight.delivery_judge.v1', tenantId, raw)→ governed DecisionFn
 *   taskDecideFor('insight.delivery_judge.v1', raw)       → (tenantId) => governed DecisionFn
 *
 * Any other way of obtaining a model call in apps/api (createLlmRouter,
 * createLlmRouterFromEnv, familyDataLlmFromEnv, localDecisionFromEnv) is
 * restricted to factory files by the ai-task-gateway fitness test — a new
 * direct call site fails CI.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import type { Db } from 'mongodb'
import {
  CostLedger,
  LlmBudgetGuard,
  createGuardEventSink,
  createLlmRouterFromEnv,
  detectActiveProvider,
  parseProcessorRegistry,
  governedDecide,
  governedLlm,
  governedVision,
  llmCallContext,
  parseTaskRegistry,
  repoRoot,
  resolveTaskPolicy,
  computeCost,
  TaskPolicyError,
  type AiTaskPolicy,
  type DecisionFn,
  type LlmFn,
  type LlmTokenUsage,
  type ProcessorRegistry,
  type ProcessorViolation,
  type TaskGatewayDeps,
  type TaskRegistry,
  type VisionFn,
} from '@lifekeel/platform'
import { createLogger } from '@lifekeel/platform'
import { deploymentConfig } from '../config/deployment.js'
import { checkPlanSpendBudget } from '../spend-ledger.js'
import { familyDataLlmFromEnv, localDecisionFromEnv } from '../local-model.js'
import {
  recordDeviceEscalation,
  recordLocalModelCall,
  recordProcessorViolation,
} from '../routes/metrics.js'

const log = createLogger({ service: 'task-gateway', version: '0.0.0' })

let deps: TaskGatewayDeps | null = null
let registry: TaskRegistry = new Map()
let processorRegistry: ProcessorRegistry = new Map()
let usageLedger: CostLedger | null = null
let llmBudgetGuard: LlmBudgetGuard

export type ProcessorEnforcement = 'off' | 'warn' | 'enforce'

/**
 * AI_PROCESSOR_ENFORCEMENT (PRD-142). Local-first default: outside `dev` an
 * unapproved processor is refused (`enforce`); in `dev` it is logged and
 * counted but served (`warn`) so local work needs no reviewed processors.
 * Set `warn` explicitly to run a non-dev deployment without approvals.
 */
export function processorEnforcementFromEnv(
  raw: string | undefined = process.env['AI_PROCESSOR_ENFORCEMENT'],
  mode: string = deploymentConfig.mode,
): ProcessorEnforcement {
  const fallback: ProcessorEnforcement = mode === 'dev' ? 'warn' : 'enforce'
  if (raw === 'off' || raw === 'warn' || raw === 'enforce') return raw
  if (raw) log.error({ value: raw }, `Invalid AI_PROCESSOR_ENFORCEMENT, using '${fallback}'`)
  return fallback
}

/**
 * Whether a `lifekeel_infra` task may fall back to a hosted provider when the
 * self-hosted model is off. Local-first: denied outside `dev`, so family
 * content never silently leaves LifeKeel infra. `AI_HOSTED_FALLBACK=allow`
 * re-enables it deliberately.
 */
export function hostedFallbackAllowed(
  raw: string | undefined = process.env['AI_HOSTED_FALLBACK'],
  mode: string = deploymentConfig.mode,
): boolean {
  if (raw === 'allow') return true
  if (raw === 'deny') return false
  return mode === 'dev'
}

/** Map the router's provider name to a processor-registry id. */
function processorForProvider(provider: string | null): string {
  // createLlmRouterFromEnv defaults to anthropic when nothing is configured.
  return provider === null || provider === 'auto' ? 'anthropic' : provider
}

const localTextConfigured = () =>
  !!process.env['LOCAL_JUDGE_BASE_URL'] && process.env['LOCAL_TEXT_ENABLED'] === 'true'

/**
 * Which processor will serve a task in this deployment. Mirrors baseFor():
 * a `lifekeel_infra` task runs on the self-hosted model only when it is on,
 * and otherwise falls back to the hosted router. That fallback is exactly what
 * the processor check exists to see.
 */
export function resolveServingProcessor(policy: AiTaskPolicy): string | null {
  switch (policy.data_boundary) {
    case 'device_only':
      return null
    case 'lifekeel_infra_required':
      return 'ollama'
    case 'lifekeel_infra':
      return localTextConfigured() ? 'ollama' : processorForProvider(detectActiveProvider())
    default:
      return processorForProvider(detectActiveProvider())
  }
}

function onProcessorViolation(v: ProcessorViolation, mode: 'warn' | 'enforce'): void {
  recordProcessorViolation(v.reason, mode)
  // Names and reasons only: never a prompt, completion or tenant.
  log.warn(
    { task_id: v.task_id, processor: v.processor, reason: v.reason, mode },
    mode === 'enforce'
      ? 'AI call refused by processor policy'
      : 'AI call served despite processor policy',
  )
}

/** The loaded processor registry, for the disclosure endpoint. */
export function getProcessorRegistry(): ProcessorRegistry {
  return processorRegistry
}

export function getTaskRegistry(): TaskRegistry {
  return registry
}

/** Load + validate the registries and build the shared dependency set. */
export function initTaskGateway(db: Db): void {
  const path = join(repoRoot(), 'definitions', 'ai-tasks.yaml')
  registry = parseTaskRegistry(loadYaml(readFileSync(path, 'utf8')))
  processorRegistry = parseProcessorRegistry(
    loadYaml(readFileSync(join(repoRoot(), 'definitions', 'ai-processors.yaml'), 'utf8')),
  )
  // Every processor a task names must exist, so a typo cannot silently block or allow a call.
  for (const [taskId, policy] of registry) {
    for (const id of policy.allowed_processors ?? []) {
      if (!processorRegistry.has(id)) {
        throw new Error(`Task '${taskId}' allows unknown processor '${id}'`)
      }
    }
  }
  usageLedger = new CostLedger(db)
  llmBudgetGuard = new LlmBudgetGuard(db)
  deps = {
    registry,
    // Dev keeps the permissive unknown-task default; every real deployment
    // mode fails closed.
    failClosed: deploymentConfig.mode !== 'dev',
    // Two-layer spend control (B8): the per-tenant LLM budget check runs
    // first; the plan-level all-service spend cap runs second and denies
    // only batch-class tasks — a family's live session is never hard-stopped
    // on platform cost.
    budgetGuard: {
      check: async (tenantId, detectorId, policy) => {
        const llm = await llmBudgetGuard.check(tenantId, detectorId)
        if (!llm.allowed) return llm
        return checkPlanSpendBudget(db, tenantId, policy)
      },
    },
    processorGuard: {
      mode: processorEnforcementFromEnv(),
      registry: processorRegistry,
      resolveProcessor: resolveServingProcessor,
      onProcessorViolation,
    },
    guardEventSink: createGuardEventSink(db, 'task-gateway'),
    onCall: (e) => {
      if (!e.ok) recordLocalModelCall('task', false, e.latency_ms / 1000, 0, 0)
      // PRD-217: one metadata row per governed call — /operator/ai-health
      // aggregates these into per-task outcome mix and latency percentiles.
      // Task/model/outcome/latency only — prompt and completion content
      // never lands here.
      const policy = registry.get(e.task_id)
      try {
        void db
          .collection('ai_task_calls')
          .insertOne({
            task_id: e.task_id,
            model: e.model,
            ok: e.ok,
            latency_ms: e.latency_ms,
            processor: policy ? resolveServingProcessor(policy) : null,
            created_at: new Date(),
          })
          .catch(() => {})
      } catch {
        /* telemetry must never fail a call */
      }
    },
    // Device-first metric: fired per actual server-side invocation of a
    // on_device task — the device tier was unavailable or abstained.
    // Counter label is task_id only; no content.
    onDeviceEscalation: (taskId) => {
      recordDeviceEscalation(taskId)
      log.info(
        { task_id: taskId, event: 'device_escalation' },
        'on_device task executed server-side',
      )
    },
  }
  log.info(
    {
      tasks: registry.size,
      processors: processorRegistry.size,
      fail_closed: deps.failClosed,
      processor_enforcement: deps.processorGuard?.mode,
    },
    'AI task registry loaded',
  )
}

/** For tests and dev scripts that run without boot. */
export function initTaskGatewayForTests(
  reg: TaskRegistry,
  overrides: Partial<TaskGatewayDeps> = {},
): void {
  registry = reg
  deps = { registry, failClosed: true, ...overrides }
}

export function taskPolicy(taskId: string): AiTaskPolicy {
  if (!deps)
    throw new TaskPolicyError('Task gateway not initialised — call initTaskGateway(db) first')
  return resolveTaskPolicy(registry, taskId, deps.failClosed ?? true)
}

// ── Base model functions ──────────────────────────────────────────────────

let cloudBase: LlmFn | undefined
let familyBase: LlmFn | undefined

/**
 * Router usage → CostLedger. The (task, tenant) attribution comes from
 * llmCallContext, which governedLlm sets around the provider call —
 * AsyncLocalStorage keeps it correct for concurrent tenants sharing this
 * router.
 */
function recordUsage(u: LlmTokenUsage): void {
  const ctx = llmCallContext.getStore()
  void usageLedger
    ?.record({
      tenant_id: ctx?.tenant_id ?? 'unknown',
      // task_id rides in workflow_id — it is the "which unit of work"
      // dimension the ledger already groups by.
      workflow_id: ctx?.task_id,
      model: u.model,
      provider: u.provider,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cost_microdollars: computeCost(u.model, u.input_tokens, u.output_tokens),
      latency_ms: u.latency_ms,
    })
    .catch(() => {})
}

function cloudLlm(): LlmFn {
  cloudBase ??= createLlmRouterFromEnv({ onUsage: recordUsage })
  return cloudBase
}

/**
 * The family-data text path: self-hosted Ollama when LOCAL_TEXT_ENABLED,
 * otherwise the cloud router. lifekeel_infra tasks prefer this so data
 * stays in our infra when the local model is deployed.
 */
function familyLlm(): LlmFn {
  familyBase ??= familyDataLlmFromEnv({ onUsage: recordUsage })
  return familyBase
}

/** Pick the base fn the task's data boundary permits. */
function baseFor(policy: AiTaskPolicy): LlmFn {
  if (policy.data_boundary === 'device_only') {
    throw new TaskPolicyError(
      `Task '${policy.task_id}' is device_only — it must run on-device and has no server-side path`,
    )
  }
  if (policy.data_boundary === 'lifekeel_infra_required') {
    // Youth-class tasks (intent 09): no silent hop to a hosted provider
    // when the self-hosted model is undeployed — the call fails closed.
    const localTextConfigured =
      !!process.env['LOCAL_JUDGE_BASE_URL'] && process.env['LOCAL_TEXT_ENABLED'] === 'true'
    if (!localTextConfigured) {
      throw new TaskPolicyError(
        `Task '${policy.task_id}' requires the self-hosted model (lifekeel_infra_required) — LOCAL_TEXT_ENABLED is not on`,
      )
    }
    return familyLlm()
  }
  if (policy.data_boundary === 'lifekeel_infra') {
    if (!localTextConfigured() && !hostedFallbackAllowed()) {
      throw new TaskPolicyError(
        `Task '${policy.task_id}' needs the self-hosted model and hosted fallback is denied (LOCAL_TEXT_ENABLED is not on; AI_HOSTED_FALLBACK=allow overrides)`,
      )
    }
    return familyLlm()
  }
  return cloudLlm()
}

// ── Public factories ──────────────────────────────────────────────────────

/** Governed LlmFn bound to one task + tenant. */
export function taskLlm(taskId: string, tenantId: string, opts?: { detectorId?: string }): LlmFn {
  if (!deps)
    throw new TaskPolicyError('Task gateway not initialised — call initTaskGateway(db) first')
  return governedLlm(baseFor(taskPolicy(taskId)), deps, taskId, tenantId, opts)
}

/** Per-tenant factory — for constructors that serve many tenants from one instance. */
export function taskLlmFor(
  taskId: string,
  opts?: { detectorId?: string },
): (tenantId: string) => LlmFn {
  return (tenantId) => taskLlm(taskId, tenantId, opts)
}

/**
 * Governed DecisionFn for a self-hosted decision model. `raw` is the
 * unwrapped fn from localDecisionFromEnv — undefined passes through so
 * callers keep their existing "no local model configured" handling.
 */
export function taskDecide(
  taskId: string,
  tenantId: string,
  raw: DecisionFn | undefined,
): DecisionFn | undefined {
  if (!deps)
    throw new TaskPolicyError('Task gateway not initialised — call initTaskGateway(db) first')
  if (!raw) return undefined
  resolveTaskPolicy(registry, taskId, deps.failClosed ?? true) // resolve eagerly so unknown tasks fail here
  // A DecisionFn is the self-hosted decision model by construction.
  return governedDecide(raw, deps, taskId, tenantId, { processor: 'ollama' })
}

export function taskDecideFor(
  taskId: string,
  raw: DecisionFn | undefined,
): (tenantId: string) => DecisionFn | undefined {
  return (tenantId) => taskDecide(taskId, tenantId, raw)
}

// ── Vision ────────────────────────────────────────────────────────────────

/**
 * Governed vision call for document extraction. The raw OpenAI/Azure SDK
 * client lives in ocr/extract.ts (endpoint handling shared with callAzure);
 * this wraps it so the cloud vision path gets the same policy, breaker,
 * deadline, guards and usage ledger as every other task.
 *
 * Returns undefined when no vision provider is configured, matching the
 * pre-gateway "OCR not configured" behaviour callers already handle.
 */
export async function taskVision(taskId: string, tenantId: string): Promise<VisionFn | undefined> {
  if (!deps)
    throw new TaskPolicyError('Task gateway not initialised — call initTaskGateway(db) first')
  const policy = taskPolicy(taskId) // resolve eagerly so unknown tasks fail here
  const { resolveVisionClient } = await import('../ocr/extract.js')
  const vision = await resolveVisionClient()
  if (!vision) return undefined
  const { client, model, provider } = vision
  const base: VisionFn = async (content, opts) => {
    const started = Date.now()
    const response = await client.chat.completions.create(
      {
        model,
        messages: [{ role: 'user', content }],
        max_tokens: policy.max_output_tokens,
        temperature: 0,
      },
      { signal: opts?.signal },
    )
    const usage = response.usage
    if (usage) {
      recordUsage({
        provider: 'openai',
        model,
        input_tokens: usage.prompt_tokens,
        output_tokens: usage.completion_tokens,
        latency_ms: Date.now() - started,
      })
    }
    return response.choices[0]?.message?.content ?? ''
  }
  return governedVision(base, deps, taskId, tenantId, { processor: provider })
}
