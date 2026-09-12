/**
 * Workflow routes — list, run, inspect workflow runs + manage approvals.
 * Also serves connector registry and skill catalogue for the Studio.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Db } from 'mongodb'
import { randomUUID } from 'crypto'
import type { WorkflowEngine } from '@kairos/workflows'
import type { WorkflowLoader } from '@kairos/workflows'
import type { EventPayload } from '@kairos/workflows'
import { connectorRegistry, SkillEngine, WorkflowSimulator } from '@kairos/workflows'
import { SkillOptimizer, checkSkillOptimizerQuota, DEFAULT_QUOTA } from '@kairos/engine'
import type { OptTarget } from '@kairos/engine'
import type { SkillConfig } from '@kairos/workflows'
import { createLlmRouter, createLlmRouterFromEnv, CostLedger, computeCost, LlmBudgetGuard } from '@kairos/platform'
import type { LlmProvider } from '@kairos/platform'
import { getTenantLlmConfig } from './settings.js'

// Fallback LLM for skill test-runs when no tenant config available
const _envLlm = createLlmRouterFromEnv()

function requireAdmin(req: { authContext: { roles: string[] } }, reply: FastifyReply): boolean {
  if (req.authContext.roles.includes('admin')) return true
  reply.status(403).send({ error: 'Admin role required' })
  return false
}

/** Build an onUsage callback that writes to the cost ledger (non-blocking). */
function makeCostCallback(
  ledger: CostLedger,
  tenantId: string,
  workflowId?: string,
  workflowRunId?: string,
) {
  return (usage: { input_tokens: number; output_tokens: number; model: string; provider: string; latency_ms: number }) => {
    ledger.record({
      tenant_id: tenantId,
      ...(workflowId ? { workflow_id: workflowId } : {}),
      ...(workflowRunId ? { workflow_run_id: workflowRunId } : {}),
      model: usage.model,
      provider: usage.provider,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cost_microdollars: computeCost(usage.model, usage.input_tokens, usage.output_tokens),
      latency_ms: usage.latency_ms,
    }).catch(() => {}) // fire-and-forget, never block workflow execution
  }
}

/** Recursively collect `{{event.X}}` field references from a workflow's node
 * configs. Used to synthesize sample event data for manual "Run now" triggers
 * of detector-driven workflows: without it, the trigger event data is empty,
 * so every `{{event.ticker}}` (etc.) resolves to its literal and gets echoed
 * into AI-drafted notes shipped to human reviewers. */
const EVENT_REF_RE = /\{\{\s*event\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

function collectEventRefs(nodes: unknown[]): Set<string> {
  const refs = new Set<string>()
  const walk = (val: unknown): void => {
    if (typeof val === 'string') {
      for (const m of val.matchAll(EVENT_REF_RE)) refs.add(m[1]!)
    } else if (Array.isArray(val)) {
      val.forEach(walk)
    } else if (val && typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) walk(v)
    }
  }
  walk(nodes)
  return refs
}
export { collectEventRefs }

/** Best-effort typed placeholder for a referenced event field, so a manually
 * run workflow produces a coherent (if clearly fake) note instead of raw
 * `{{event.*}}` literals. Field names follow the trading detector
 * feature_snapshot conventions (ticker, *_gbp, *_pct, quantity, …). */
function sampleValueFor(field: string): string | number {
  const f = field.toLowerCase()
  if (f === 'ticker' || f === 'symbol') return 'SAMPLE'
  if (f.endsWith('_display')) return '100.00'
  if (f.endsWith('_gbp')) return 100
  if (f === 'quantity' || f.endsWith('_shares') || f.endsWith('_tickers')) return 10
  if (f.endsWith('_pct') || f.endsWith('_weight')) return 50
  if (f.includes('price')) return 100
  if (f.includes('threshold') || f.includes('fraction') || f.includes('score')) return 0.5
  return 1
}

/** For detector-triggered workflows run manually with no real event data,
 * fill in placeholder values for every `{{event.X}}` the workflow references
 * but the caller didn't supply. Marks the data with `_sample: true` so downstream
 * nodes can tell this isn't a real signal. */
function synthesizeSampleEventData(
  nodes: unknown[],
  provided: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(provided ?? {}) }
  // Only synthesize when the caller passed little/no real data — a manual run
  // passes just `{ source: 'studio_manual' }`, a real detector signal passes
  // the full feature_snapshot (ticker, prices, …).
  const realFieldCount = Object.keys(data).filter(k => !['source', 'test', '_test'].includes(k)).length
  if (realFieldCount > 3) return data
  for (const field of collectEventRefs(nodes)) {
    if (!(field in data)) data[field] = sampleValueFor(field)
  }
  if (Object.keys(data).length > 0) data['_sample'] = true
  return data
}
export { synthesizeSampleEventData }

export function registerWorkflowRoutes(
  fastify: FastifyInstance,
  loader: WorkflowLoader,
  engine: WorkflowEngine,
  db?: Db,
): void {
  // Cost ledger — records LLM usage per tenant per workflow run
  const costLedger = db ? new CostLedger(db) : null

  // ── Workflow definitions ──────────────────────────────────────────

  // GET /workflows — list all workflow definitions
  fastify.get('/workflows', async (_req, _reply) => {
    const defs = loader.getAll().map(w => ({
      id: w.id,
      name: w.name,
      description: w.description,
      version: w.version,
      enabled: w.enabled,
      trigger: w.trigger,
      node_count: w.nodes.length,
      has_human_approval: w.nodes.some(n => n.type === 'human_approval'),
    }))
    return { workflows: defs, total: defs.length }
  })

  // GET /workflows/:id — get full workflow definition
  fastify.get<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    const requestedId = req.params.id
    const def = loader.get(requestedId)
    if (!def) {
      // AUTO-01: every playbook tested in the audit returned a 404 here,
      // even though GET /workflows (list) returned the same playbooks
      // successfully. Log enough to distinguish the likely causes:
      //   - empty loader (workflows dir missing / loadAll never ran)
      //   - id mismatch (list returns id X but get(X) misses — encoding,
      //     casing, or a list source that diverges from the loader Map)
      //   - per-tenant scoping that the list doesn't apply
      const allIds = loader.getAll().map(w => w.id)
      req.log.warn(
        {
          requested_id: requestedId,
          tenant_id: req.authContext?.tenant_id,
          loader_count: allIds.length,
          loaded_ids: allIds.slice(0, 30),
        },
        '[workflows] GET /workflows/:id — not found',
      )
      return reply.status(404).send({ error: 'Workflow not found', requested_id: requestedId })
    }
    return { workflow: def }
  })

  // POST /workflows — create or update a workflow definition from JSON
  fastify.post<{ Body: { workflow: Record<string, unknown> } }>('/workflows', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const { workflow } = req.body
    if (!workflow?.id) return reply.status(400).send({ error: 'workflow.id required' })

    // Save to YAML file (triggers hot-reload watcher + auto-versions)
    loader.saveWorkflow(workflow as unknown as Parameters<typeof loader.saveWorkflow>[0], req.authContext.user_id)
    return reply.status(201).send({ id: workflow.id, saved: true })
  })

  // DELETE /workflows/:id
  fastify.delete<{ Params: { id: string } }>('/workflows/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    loader.deleteWorkflow(req.params.id)
    return { deleted: true }
  })

  // ── Workflow runs ────────────────────────────────────────────────

  // POST /workflows/:id/run — manually trigger a workflow
  fastify.post<{
    Params: { id: string }
    Body: { event_data?: Record<string, unknown> }
  }>('/workflows/:id/run', async (req, reply) => {
    const def = loader.get(req.params.id)
    if (!def) return reply.status(404).send({ error: 'Workflow not found' })

    const tenantId = req.authContext.tenant_id

    if (db && req.params.id === 'marketing_kairos_x_daily_capability') {
      const pending = await db.collection('workflow_approvals').findOne({
        tenant_id: tenantId,
        workflow_id: req.params.id,
        status: 'pending',
      })
      if (pending) {
        return {
          run_id: pending['workflow_run_id'],
          status: 'waiting_approval',
          thread_id: `${req.params.id}:${pending['workflow_run_id']}`,
          approval_id: pending['id'],
          deduped: true,
        }
      }
    }

    // Build a per-tenant LLM function: use saved config if available, else env vars
    let llmFnForRun = _envLlm
    if (db) {
      try {
        const tenantCfg = await getTenantLlmConfig(db, tenantId)
        if (tenantCfg) {
          llmFnForRun = createLlmRouter({
            provider: tenantCfg.provider as LlmProvider,
            defaultModel: tenantCfg.model,
            temperature: tenantCfg.temperature,
            maxTokens: tenantCfg.maxTokens,
            ...(tenantCfg.apiKey !== undefined ? { apiKey: tenantCfg.apiKey } : {}),
            ...(tenantCfg.azureEndpoint !== undefined ? { azureEndpoint: tenantCfg.azureEndpoint } : {}),
            ...(tenantCfg.azureDeployment !== undefined ? { azureDeployment: tenantCfg.azureDeployment } : {}),
            ...(tenantCfg.azureApiVersion !== undefined ? { azureApiVersion: tenantCfg.azureApiVersion } : {}),
            ...(tenantCfg.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: tenantCfg.ollamaBaseUrl } : {}),
            ...(tenantCfg.tierModels !== undefined ? { tierModels: tenantCfg.tierModels } : {}),
            // Wire cost ledger — records tokens + cost for every LLM call
            ...(costLedger ? { onUsage: makeCostCallback(costLedger, tenantId, def.id) } : {}),
          })
        }
      } catch { /* use env fallback */ }
    }

    const event: EventPayload = {
      id: randomUUID(),
      tenant_id: tenantId,
      event_type: 'manual_trigger',
      // Manual "Run now" of a detector-driven workflow otherwise starts with
      // empty event data, leaving every {{event.*}} template unresolved — the
      // AI note then ships raw "{{event.ticker}}" to the review queue. Fill in
      // placeholder values for any referenced fields the caller didn't supply.
      data: def.trigger.detector
        ? synthesizeSampleEventData(def.nodes as unknown[], req.body?.event_data)
        : (req.body?.event_data ?? {}),
      created_at: new Date(),
    }

    const run = await engine.start(def, event, tenantId, llmFnForRun)
    return { run_id: run.id, status: run.status, thread_id: run.thread_id }
  })

  // GET /workflows/runs — list runs for tenant
  fastify.get('/workflows/runs', async (req) => {
    const tenantId = req.authContext.tenant_id
    const runs = await engine.getRunsByTenant(tenantId, 50)
    return {
      runs: runs.map(r => ({
        id: r.id,
        workflow_id: r.workflow_id,
        status: r.status,
        current_node: r.current_node,
        started_at: r.started_at,
        completed_at: r.completed_at,
        error: r.error,
        trigger_event_type: r.trigger_event.event_type,
      })),
    }
  })

  // GET /workflows/runs/:runId — get full run state (tenant-scoped)
  fastify.get<{ Params: { runId: string } }>('/workflows/runs/:runId', async (req, reply) => {
    const run = await engine.getRun(req.params.runId, req.authContext.tenant_id)
    if (!run) return reply.status(404).send({ error: 'Run not found' })
    return { run }
  })

  // ── Connector registry ───────────────────────────────────────────

  // GET /connectors — list all available connectors for Studio
  fastify.get('/connectors', async () => {
    return { connectors: connectorRegistry.summary() }
  })

  // GET /connectors/search?q= — search connectors (must be before /:id)
  fastify.get<{ Querystring: { q?: string } }>('/connectors/search', async (req) => {
    const results = req.query.q
      ? connectorRegistry.search(req.query.q)
      : connectorRegistry.all()
    return { connectors: results.map(c => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, category: c.category })) }
  })

  // GET /connectors/:id — full connector definition (actions, triggers, params)
  fastify.get<{ Params: { id: string } }>('/connectors/:id', async (req, reply) => {
    const def = connectorRegistry.get(req.params.id)
    if (!def) return reply.status(404).send({ error: 'Connector not found' })
    // Strip base_url (has credential placeholders) — Studio only needs actions/triggers
    const { base_url: _, ...safe } = def
    return { connector: safe }
  })

  // GET /connectors/:id/agent-tools — agent-native metadata for skill/tool builders
  fastify.get<{ Params: { id: string } }>('/connectors/:id/agent-tools', async (req, reply) => {
    const def = connectorRegistry.get(req.params.id)
    if (!def) return reply.status(404).send({ error: 'Connector not found' })
    if (!def.agent_tool_pack) return reply.status(404).send({ error: 'Connector has no agent tool pack' })
    return {
      connector_id: def.id,
      tool_pack: def.agent_tool_pack,
      actions: def.actions.map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        method: action.method,
        params: action.params,
      })),
    }
  })

  // ── Skills catalogue ──────────────────────────────────────────────

  // GET /skills — list all available AI skill primitives
  fastify.get('/skills', async () => {
    const skills = [
      { id: 'classify',  label: 'Classify',  description: 'Assign one or more labels from a fixed set', icon: '🏷️',  inputs: ['text', 'labels'], output: '{ labels, confidence, reasoning }' },
      { id: 'extract',   label: 'Extract',   description: 'Pull structured fields from unstructured text', icon: '🔍', inputs: ['text', 'fields'], output: '{ field1, field2, ... }' },
      { id: 'summarize', label: 'Summarize', description: 'Condense long content to key points', icon: '📝',         inputs: ['text', 'style', 'max_sentences'], output: 'string' },
      { id: 'sentiment', label: 'Sentiment', description: 'Score tone: positive / neutral / negative', icon: '😊',    inputs: ['text'], output: '{ score, label, confidence, emotions }' },
      { id: 'generate',  label: 'Generate',  description: 'Free-form text with persona + tone', icon: '✍️',          inputs: ['prompt', 'persona', 'tone', 'max_words'], output: 'string' },
      { id: 'translate', label: 'Translate', description: 'Translate to any target language', icon: '🌍',            inputs: ['text', 'target_language'], output: 'string' },
      { id: 'score',     label: 'Score',     description: 'Rate a value against a rubric (0–100)', icon: '📊',       inputs: ['subject', 'rubric'], output: '{ score, reasoning, strengths, weaknesses }' },
      { id: 'decide',    label: 'Decide',    description: 'Make a decision from a list of options', icon: '🎯',      inputs: ['question', 'context', 'options'], output: '{ decision, confidence, reasoning, risks }' },
      { id: 'route',     label: 'Route',     description: 'Pick the best path from a list of routes', icon: '🔀',    inputs: ['description', 'routes'], output: '{ route_id, confidence, reasoning }' },
      { id: 'compare',   label: 'Compare',   description: 'Compare two versions (A/B)', icon: '⚖️',                 inputs: ['version_a', 'version_b', 'criteria'], output: '{ winner, scores, reasoning }' },
      { id: 'enrich',    label: 'Enrich',    description: 'Infer missing fields from existing data', icon: '✨',     inputs: ['data', 'infer_fields'], output: 'enriched data object' },
      { id: 'plan',      label: 'Plan',      description: 'Break a goal into ordered steps', icon: '📋',             inputs: ['goal', 'constraints'], output: '{ steps[], total_estimated_minutes }' },
    ]
    return { skills, total: skills.length }
  })

  // POST /skills/run — test-run a skill from Studio (dev/preview only)
  fastify.post<{ Body: { skill: string; config: Record<string, unknown> } }>('/skills/run', async (req, reply) => {
    const tenantId = req.authContext.tenant_id
    let llmFn = _envLlm
    if (db) {
      try {
        const tenantCfg = await getTenantLlmConfig(db, tenantId)
        if (tenantCfg) {
          llmFn = createLlmRouter({
            provider: tenantCfg.provider as LlmProvider,
            defaultModel: tenantCfg.model,
            temperature: tenantCfg.temperature,
            maxTokens: tenantCfg.maxTokens,
            ...(tenantCfg.apiKey !== undefined ? { apiKey: tenantCfg.apiKey } : {}),
          })
        }
      } catch { /* use env fallback */ }
    }
    const skillEngine = new SkillEngine(llmFn)
    try {
      const result = await skillEngine.run(req.body.config as unknown as SkillConfig)
      return { result }
    } catch (err) {
      return reply.status(400).send({ error: String(err) })
    }
  })

  // ── Internal trigger (called by detector engine on signal) ──────

  // POST /internal/workflow-trigger — called by detector engine on signal
  // SECURITY: tenant_id comes from JWT authContext, NOT from request body
  // SECURITY: requires X-Internal-Token header to prevent external abuse
  fastify.post<{
    Body: {
      detector_id: string
      insight_id: string
      event_data: Record<string, unknown>
    }
  }>('/internal/workflow-trigger', async (req, reply) => {
    // Internal-service guard: accept either JWT (from engine) or X-Internal-Token
    const internalToken = req.headers['x-internal-token']
    const expectedToken = process.env['INTERNAL_TOKEN']
    if (expectedToken && internalToken !== expectedToken) {
      return reply.status(403).send({ error: 'Invalid internal token' })
    }

    // SECURITY: tenant always from JWT, never from body
    const tenant_id = req.authContext.tenant_id
    const { detector_id, insight_id, event_data } = req.body

    const matchingWorkflows = loader.getByDetector(detector_id)
    const triggered: string[] = []

    for (const def of matchingWorkflows) {
      const event: EventPayload = {
        id: randomUUID(),
        tenant_id,
        event_type: 'detector_signal',
        detector_id,
        insight_id,
        data: event_data,
        created_at: new Date(),
      }
      const run = await engine.start(def, event, tenant_id)
      triggered.push(run.id)
    }

    return { triggered: triggered.length, run_ids: triggered }
  })

  // ── Simulation ───────────────────────────────────────────────────────────

  // POST /workflows/:id/simulate — dry-run with a sample event (no side effects)
  fastify.post<{
    Params: { id: string }
    Body: { event_data?: Record<string, unknown> }
  }>('/workflows/:id/simulate', async (req, reply) => {
    const def = loader.get(req.params.id)
    if (!def) return reply.status(404).send({ error: 'Workflow not found' })
    if (!db) return reply.status(503).send({ error: 'Simulation requires database connection' })

    const tenantId = req.authContext.tenant_id
    const simulator = new WorkflowSimulator(db, _envLlm)

    const sampleEvent: EventPayload = {
      id: `sim_${randomUUID()}`,
      tenant_id: tenantId,
      event_type: def.trigger.event_type ?? 'manual_trigger',
      data: req.body?.event_data ?? {},
      created_at: new Date(),
    }

    const result = await simulator.dryRun(def, sampleEvent, tenantId)
    return result
  })

  // GET /workflows/:id/estimate — static cost/structure analysis (no LLM calls)
  fastify.get<{ Params: { id: string } }>('/workflows/:id/estimate', async (req, reply) => {
    const def = loader.get(req.params.id)
    if (!def) return reply.status(404).send({ error: 'Workflow not found' })
    if (!db) return reply.status(503).send({ error: 'Estimate requires database connection' })
    const simulator = new WorkflowSimulator(db)
    return simulator.estimate(def)
  })

  // ── Analytics ─────────────────────────────────────────────────────────────

  // GET /analytics/costs?days=30 — per-tenant LLM cost summary
  fastify.get<{ Querystring: { days?: string } }>('/analytics/costs', async (req) => {
    if (!costLedger) return { error: 'Cost ledger not available — database not connected' }
    const tenantId = req.authContext.tenant_id
    const days = Math.min(90, Math.max(1, parseInt(req.query.days ?? '30', 10) || 30))
    const summary = await costLedger.getSummary(tenantId, days)
    return { days, ...summary }
  })

  // POST /analytics/optimize — run SkillOptimizer for a skill or detector
  // Runs the full Rollout → Reflect → Edit → Gate loop and persists the result.
  fastify.post<{
    Body: { target: string; target_id: string; iterations?: number; budget_chars?: number }
  }>('/analytics/optimize', async (req, reply) => {
    if (!db) return reply.status(503).send({ error: 'Optimization requires database connection' })
    const { target, target_id, iterations = 3, budget_chars = 400 } = req.body
    if (!target || !target_id) return reply.status(400).send({ error: 'target and target_id required' })

    const tenantId = req.authContext.tenant_id

    // 1. Quota check
    const quotaResult = await checkSkillOptimizerQuota(db, tenantId, target_id, DEFAULT_QUOTA)
    if (!quotaResult.allowed) {
      return reply.status(429).send({
        error: 'SkillOptimizer quota exceeded',
        reason: quotaResult.reason,
        detail: quotaResult.detail,
      })
    }

    // 2. LLM budget check
    const budgetGuard = new LlmBudgetGuard(db)
    const budgetCheck = await budgetGuard.check(tenantId)
    if (!budgetCheck.allowed) {
      return reply.status(429).send({
        error: 'LLM budget exhausted',
        spent_usd: budgetCheck.spent_microdollars / 1_000_000,
      })
    }

    const optimizer = new SkillOptimizer(db, _envLlm)
    const result = await optimizer.run({
      target: target as OptTarget,
      target_id,
      tenant_id: tenantId,
      iterations,
      budget_chars,
    })
    return result
  })

  // GET /analytics/optimize/history — list past optimization runs for tenant
  fastify.get<{ Querystring: { target?: string; limit?: string } }>('/analytics/optimize/history', async (req) => {
    if (!db) return { runs: [] }
    const tenantId = req.authContext.tenant_id
    const limit = Math.min(50, parseInt(req.query.limit ?? '20', 10) || 20)
    const filter: Record<string, unknown> = { tenant_id: tenantId }
    if (req.query.target) filter['target'] = req.query.target
    const runs = await db.collection('skill_opt_history')
      .find(filter).sort({ completed_at: -1 }).limit(limit).toArray()
    return { runs }
  })

  // GET /analytics/costs/workflow/:id — cost for a specific workflow
  fastify.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    '/analytics/costs/workflow/:id',
    async (req) => {
      if (!costLedger) return { error: 'Cost ledger not available' }
      const tenantId = req.authContext.tenant_id
      const days = Math.min(90, Math.max(1, parseInt(req.query.days ?? '30', 10) || 30))
      return costLedger.getWorkflowCost(tenantId, req.params.id, days)
    },
  )
}
