/**
 * Goal Compiler — natural language → structured goal with KPI definitions + detector YAML.
 *
 * Routes:
 *   POST /goals/compile         — compile a free-text goal description into a full spec
 *   POST /goals/compile/confirm — save the compiled spec (create goal + write detector YAML)
 *
 * Flow:
 *   1. User writes: "Reduce overdue invoices to zero in 60 days"
 *   2. LLM extracts:
 *      - goal name, description, timeline
 *      - KPI definitions with source, signal_types, aggregation, field, filter
 *      - Suggested detector IDs (from the engine's loaded inventory)
 *      - Reasoning about WHY these KPIs and detectors were chosen
 *   3. Returns a CompiledGoalSpec for review in Studio
 *   4. User edits targets / removes KPIs / changes timeline
 *   5. POST /goals/compile/confirm saves:
 *      - Goal to MongoDB (via GoalStore)
 *      - Any generated detector YAML to disk (hot-reloaded by engine)
 *
 * The LLM is given:
 *   - The available signal types (from engine.registeredSignalTypes + tenant signals)
 *   - The existing detector inventory (so it can reference real detector IDs)
 *   - The KPI examples from GET /goals/kpi-sources
 *   - The goal description
 *
 * Output is validated against KpiSchema before returning — the LLM cannot
 * produce an invalid goal structure even if it hallucinates.
 */

import { z } from 'zod'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { LRUCache } from 'lru-cache'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import type { Engine } from '@kairos/engine'
import { GoalDecompositionAgent, type GoalDecompositionTraceEntry } from '@kairos/skills'
import { LlmBudgetGuard, createLlmRouter } from '@kairos/platform'
import type { LlmProvider, LlmFn } from '@kairos/platform'
import { loadGoalTemplates } from '@kairos/workflows'
import type { CompiledGoalSpec, CompiledKpi } from '@kairos/specifications'
import { refreshGoalDetectorActivations } from '../goals/goal-detector-activations.js'
import { getTenantLlmConfig } from './settings.js'
import { createGoalIdempotently } from '../goals/goal-idempotency.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../../../..')
const DETECTORS_DIR = join(ROOT, 'detectors', 'generated')

// Loaded once at startup from definitions/goal-templates/ — see
// packages/workflows/src/loader/GoalTemplateLoader.ts. Replaces a hardcoded
// TS array that had drifted out of sync with the YAML content and with the
// goal_templates ids verticals reference.
const GOAL_TEMPLATES = loadGoalTemplates(ROOT)
function getGoalTemplate(id: string) {
  return GOAL_TEMPLATES.find(t => t.id === id)
}

// ── Compiled-goal cache ──────────────────────────────────────────────────────
// P2 cost optimisation: cache compiled goals by hash(goalText + signalTypes +
// detectorInventory + connectedConnectors). The same goal text compiled twice
// (common when users tweak targets in Studio and recompile) returns the cached
// spec without hitting the LLM. 1-hour TTL — long enough for a user session,
// short enough to pick up newly connected data sources.
const compiledGoalCache = new LRUCache<string, { spec: CompiledGoalSpecWithTrace; matchedTemplateId?: string }>({
  max: 1000,
  ttl: 60 * 60_000, // 1 hour
})

export function compiledGoalCacheKey(opts: {
  tenantId: string
  goal: string
  context?: unknown
  signalTypes: string[]
  detectorInventory: Array<{ id: string; name: string; signal_types: string[] }>
  connectedConnectors: string[]
}): string {
  return createHash('sha256').update(JSON.stringify({
    tenantId: opts.tenantId,
    goal: opts.goal,
    context: opts.context,
    signalTypes: [...opts.signalTypes].sort(),
    detectorIds: opts.detectorInventory.map(d => d.id).sort(),
    connectedConnectors: [...opts.connectedConnectors].sort(),
  })).digest('hex')
}

// ── Types ──────────────────────────────────────────────────────────────────────
// CompiledKpi/CompiledDetector/CompiledGoalSpec are imported from
// @kairos/specifications — the same shape goal templates are validated
// against (GoalTemplateSchema.spec). decomposition_trace is runtime-only
// debug metadata from the LLM agent, not part of the curated template
// content, so it's added here rather than in the shared schema.
type CompiledGoalSpecWithTrace = CompiledGoalSpec & { decomposition_trace?: GoalDecompositionTraceEntry[] }

// ── LLM prompt ────────────────────────────────────────────────────────────────

function buildCompilerPrompt(opts: {
  goalText: string
  signalTypes: string[]
  detectorInventory: Array<{ id: string; name: string; signal_types: string[] }>
  kpiExamples: Array<Record<string, unknown>>
}): string {
  return `You are a business goal compiler for Kairos, an SMB intelligence platform.

Convert the user's goal into a structured specification. Respond ONLY with valid JSON.

## Available signal types (data already flowing into the system):
${opts.signalTypes.slice(0, 50).join(', ')}

## Available detectors (already loaded, can be referenced directly):
${opts.detectorInventory.slice(0, 30).map(d => `- ${d.id}: "${d.name}" (signals: ${d.signal_types.join(', ')})`).join('\n')}

## KPI definition examples:
${JSON.stringify(opts.kpiExamples.slice(0, 6), null, 2)}

## User's goal:
"${opts.goalText}"

## Instructions:
1. Extract goal name, description, and timeline_days (default 90 if not specified)
2. **Extract every specific numeric constraint from the user's goal text.** If the user
   says "cap any single stock at 15%" or "keep 5% cash", each of those becomes its own
   KPI with the user's exact target value (15, 5) — do NOT replace user-specified
   thresholds with generic defaults. The user's explicit numbers always win.
3. Define 1–4 KPIs. For each KPI:
   - Choose source: 'external_api' for connected social/account metrics such as X/Twitter followers, impressions, and engagement rate
   - Choose source: 'signals' if a relevant signal_type exists, otherwise 'manual'
   - For 'signals' source: pick the best aggregation (count/sum/avg/last/rate) and field
   - Set the target to the user's specified value when they gave one; otherwise estimate a realistic target
   - Set direction: 'increase' or 'decrease'
   - Write a brief reasoning (1 sentence) explaining why this KPI
4. List relevant detectors from the inventory above. If none match, suggest a new detector
   with a generated YAML config (5-line format)
5. Assign overall confidence (0–1) based on how well the available signals match the goal
6. List any warnings (missing data sources, ambiguous targets, etc.)

## Response format (strict JSON, no markdown):
{
  "name": "string",
  "description": "string",
  "timeline_days": number,
  "kpis": [{
    "metric": "snake_case_name",
    "label": "Human readable label",
    "unit": "unit string",
    "target": number,
    "start_value": 0,
    "current": 0,
    "direction": "increase|decrease",
    "source": "signals|external_api|manual",
    "signal_types": ["signal.type"],
    "aggregation": "count|sum|avg|last|rate",
    "field": "data.field_name or null",
    "filter": "filtrex expression or null",
    "window_days": number_or_null,
    "reasoning": "one sentence"
  }],
  "detectors": [{
    "id": "detector_id",
    "name": "Detector name",
    "existing": true,
    "reasoning": "one sentence"
  }],
  "tags": ["tag1", "tag2"],
  "confidence": 0.85,
  "reasoning": "2-3 sentence summary of the compilation choices",
  "warnings": ["warning if any"]
}`
}

// ── YAML generator for new detectors ─────────────────────────────────────────

function generateDetectorYaml(
  id: string,
  name: string,
  kpis: CompiledKpi[],
  goalName: string,
): string {
  const primaryKpi = kpis.find(k => k.source === 'signals' && k.signal_types?.length)
  const signalTypes = primaryKpi?.signal_types ?? ['goal.kpi.updated']

  const lines = [
    `id: ${id}`,
    `name: "${name.replace(/"/g, '\\"')}"`,
    `description: "Auto-generated for goal: ${goalName.replace(/"/g, '\\"')}"`,
    `version: "1.0.0"`,
    `signal_types:`,
    ...signalTypes.map(s => `  - ${s}`),
    `industries:`,
    `  - "*"`,
    `rules:`,
  ]

  for (const kpi of kpis) {
    const ruleId = `${kpi.metric}_off_track`
    lines.push(`  - id: ${ruleId}`)
    lines.push(`    name: "${kpi.label} off track"`)

    if (kpi.source === 'signals') {
      if (kpi.direction === 'decrease') {
        lines.push(`    condition: "data.value > data.target * 1.1"`)
      } else {
        lines.push(`    condition: "data.pct_complete < 0.5 and data.pct_time_elapsed > 0.5"`)
      }
    } else {
      lines.push(`    condition: "data.metric == '${kpi.metric}'"`)
    }

    lines.push(`    confidence: 0.82`)
    lines.push(`    impact_low: 0`)
    lines.push(`    impact_high: 0`)
    lines.push(`    reasoning_template: |`)
    lines.push(`      ${kpi.label} is off track for goal "${goalName}".`)
    lines.push(`      Current: {{data.value}} ${kpi.unit} | Target: ${kpi.target} ${kpi.unit}`)
    lines.push(`    actions:`)
    lines.push(`      - "Review ${kpi.label.toLowerCase()} and take corrective action"`)
    lines.push(`    dedup_window_ms: 86400000`)
  }

  return lines.join('\n') + '\n'
}

// ── Routes ─────────────────────────────────────────────────────────────────────

const CompileSchema = z.object({
  goal: z.string().min(5).max(500),
  context: z.object({
    industry:   z.string().optional(),
    company_size: z.string().optional(),
    current_values: z.record(z.number()).optional(),
  }).optional(),
})

const InboundGoalMessageSchema = z.object({
  from: z.string().min(3),
  body: z.string().min(5).max(500),
  channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
})

const ConfirmSchema = z.object({
  spec:         z.unknown(),   // the CompiledGoalSpec returned by /compile
  generate_detectors: z.boolean().default(true),
  template_id: z.string().optional(),
  parent_goal_id: z.string().optional(),
  autonomy_enabled: z.boolean().default(true),
})

const KpiAggregationSchema = z.enum(['count','sum','avg','last','min','max','rate'])
const DotPathSchema = z.string().regex(/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*)*$/)
const SimpleFilterSchema = z.string().regex(/^[\w.]+\s*(>|>=|<|<=|==|!=)\s*(?:-?\d+(?:\.\d+)?|['"][^'"]*['"]|[A-Za-z0-9_.-]+)$/)

function isKnownSignalType(signalType: string, known: Set<string>): boolean {
  return known.has(signalType)
}

function sanitizeCompiledSpec(spec: CompiledGoalSpecWithTrace, allSignalTypes: string[]): CompiledGoalSpecWithTrace {
  const knownSignalTypes = new Set(allSignalTypes)
  const warnings = new Set(spec.warnings ?? [])
  spec.kpis = (spec.kpis ?? []).map(kpi => {
    const clean: CompiledKpi = {
      metric:      kpi.metric ?? 'unknown_metric',
      label:       kpi.label  ?? kpi.metric,
      unit:        kpi.unit   ?? '',
      target:      Number(kpi.target ?? 0),
      start_value: 0,
      current:     0,
      direction:   kpi.direction === 'decrease' ? 'decrease' : 'increase',
      source:      kpi.source === 'signals' || kpi.source === 'external_api' ? kpi.source : 'manual',
      reasoning:   kpi.reasoning ?? '',
    }
    if (kpi.signal_types?.length) {
      const known = kpi.signal_types.filter(st => isKnownSignalType(st, knownSignalTypes))
      if (known.length > 0) clean.signal_types = known
      if (known.length !== kpi.signal_types.length) {
        warnings.add(`One or more suggested signal types for '${clean.metric}' are not available and were removed.`)
      }
    }
    if (clean.source === 'signals' && !clean.signal_types?.length) {
      clean.source = 'manual'
      warnings.add(`KPI '${clean.metric}' was changed to manual because no matching signal type is available.`)
    }
    if (kpi.aggregation && KpiAggregationSchema.safeParse(kpi.aggregation).success) clean.aggregation = kpi.aggregation
    if (kpi.field && kpi.field !== 'null') {
      if (DotPathSchema.safeParse(kpi.field).success) clean.field = kpi.field
      else warnings.add(`Invalid field path for '${clean.metric}' was removed.`)
    }
    if (kpi.filter && kpi.filter !== 'null') {
      if (SimpleFilterSchema.safeParse(kpi.filter).success) clean.filter = kpi.filter
      else warnings.add(`Unsupported filter for '${clean.metric}' was removed; use a simple single-field comparison.`)
    }
    if (kpi.window_days) clean.window_days = kpi.window_days
    if (kpi.denominator_signal_types?.length) {
      const knownDenominators = kpi.denominator_signal_types.filter(st => isKnownSignalType(st, knownSignalTypes))
      if (knownDenominators.length > 0) clean.denominator_signal_types = knownDenominators
    }
    return clean
  })
  spec.warnings = [...warnings]
  return spec
}

function cloneTemplateSpec(templateId: string): { templateId: string; spec: CompiledGoalSpec } | null {
  const template = getGoalTemplate(templateId)
  if (!template) return null
  return { templateId, spec: structuredClone(template.spec) }
}

function templateForGoalText(goalText: string): { templateId: string; spec: CompiledGoalSpec } | null {
  const normalized = goalText.toLowerCase()
  const socialTerms = ['social', 'x ', 'twitter', 'post', 'posts', 'posting', 'followers', 'engagement', 'impressions']
  if (socialTerms.some(term => normalized.includes(term))) {
    return cloneTemplateSpec('social-x-growth')
  }
  if (normalized.includes('invoice') || normalized.includes('overdue') || normalized.includes('receivable')) {
    return cloneTemplateSpec('invoice-recovery')
  }
  if (normalized.includes('cash flow') || normalized.includes('cash position')) {
    return cloneTemplateSpec('protect-cash-flow')
  }
  if (normalized.includes('churn') || normalized.includes('retention')) {
    return cloneTemplateSpec('churn-prevention')
  }
  if (normalized.includes('support') || normalized.includes('ticket') || normalized.includes('response')) {
    return cloneTemplateSpec('sla-prevention')
  }
  if (normalized.includes('review') || normalized.includes('rating') || normalized.includes('feedback')) {
    return cloneTemplateSpec('reputation-reviews')
  }
  if (normalized.includes('realistic') || normalized.includes('8%') || normalized.includes('long-run')) {
    return cloneTemplateSpec('realistic-compound-growth-trading')
  }
  if (normalized.includes('compound') || normalized.includes('monthly return') || normalized.includes('reinvest')) {
    return cloneTemplateSpec('compound-growth-trading')
  }
  if (normalized.includes('portfolio') || normalized.includes('yield') || normalized.includes('dividend') || normalized.includes('stock') || normalized.includes('trading') || normalized.includes('concentration')) {
    return cloneTemplateSpec('diversified-portfolio-yield')
  }
  if (normalized.includes('buy-to-let') || normalized.includes('buy to let') || normalized.includes('rental') || normalized.includes('property') || normalized.includes('landlord') || normalized.includes('refinance')) {
    return cloneTemplateSpec('buy-to-let-yield')
  }
  return null
}

function buildGenericSpec(goalText: string): CompiledGoalSpec {
  return {
    name: goalText,
    description: goalText,
    timeline_days: 90,
    kpis: [
      {
        metric: 'goal_progress',
        label: 'Goal progress',
        unit: 'percent',
        target: 100,
        start_value: 0,
        current: 0,
        direction: 'increase',
        source: 'manual',
        reasoning: 'Placeholder KPI until a measurable signal is connected.',
      },
    ],
    detectors: [],
    tags: ['custom'],
    confidence: 0.5,
    reasoning: 'The AI compiler was unavailable and no curated template matched the goal. A placeholder plan is provided so you can refine it manually.',
    warnings: [
      'AI compilation unavailable and no matching template was found. Add a connected data source and edit the KPIs to make this goal trackable.',
    ],
  }
}

/**
 * Gap A5: resolve the LLM function per-request using the tenant's saved
 * config (Settings → AI Provider), falling back to the env-based globalLlmFn
 * only when no tenant config exists. Same pattern as copilot.ts:callCopilotLlm
 * and workflows.ts. Without this, /goals/compile only ever reads
 * ANTHROPIC_API_KEY from the process env and ignores whatever the tenant
 * configured in the UI.
 */
async function resolveTenantLlm(
  db: Db,
  tenantId: string,
  fallbackLlmFn: LlmFn,
): Promise<LlmFn> {
  const tenantCfg = await getTenantLlmConfig(db, tenantId)
  if (!tenantCfg) return fallbackLlmFn
  return createLlmRouter({
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
  })
}

export function registerGoalCompilerRoutes(
  app: FastifyInstance,
  db: Db,
  engine: Engine,
  llmFn: LlmFn,
): void {
  const budgetGuard = new LlmBudgetGuard(db)

  app.get('/goal-templates', async () => ({
    templates: GOAL_TEMPLATES,
    total: GOAL_TEMPLATES.length,
  }))

  app.post<{ Body: z.infer<typeof InboundGoalMessageSchema> }>('/inbound/messages', async (req, reply) => {
    const parsed = InboundGoalMessageSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'from and body are required' })

    const phoneField = parsed.data.channel === 'whatsapp' ? 'whatsapp_to' : 'sms_to'
    const preferences = await db.collection('delivery_preferences').findOne({
      [phoneField]: parsed.data.from,
      enabled: true,
    })
    const tenantId = preferences?.['tenant_id']
    if (typeof tenantId !== 'string') {
      return reply.status(404).send({ error: 'No tenant is configured for this sender' })
    }

    const [signalTypes, connectedConnectors] = await Promise.all([
      db.collection('signals').distinct('signal_type', { tenant_id: tenantId }),
      db.collection('connector_credentials').distinct('connector_id', { tenant_id: tenantId }),
    ])
    const detectorInventory = engine.inventory().map(detector => ({
      id: detector.id,
      name: detector.name,
      signal_types: detector.signal_types,
    }))
    const allSignalTypes = [...new Set([...signalTypes, ...engine.registeredSignalTypes])]
    const prompt = buildCompilerPrompt({
      goalText: parsed.data.body,
      signalTypes: allSignalTypes,
      detectorInventory,
      kpiExamples: [],
    })
    // ADR-0031: enforce LLM budget before calling the agent
    const budgetDecision = await budgetGuard.check(tenantId)
    if (!budgetDecision.allowed) {
      return reply.status(429).send({ error: `LLM budget exceeded: ${budgetDecision.reason}` })
    }

    // Gap A5: resolve the tenant's configured LLM (Azure OpenAI, etc.) instead
    // of always using the env-based globalLlmFn.
    const tenantLlmFn = await resolveTenantLlm(db, tenantId, llmFn)

    const agent = new GoalDecompositionAgent<CompiledGoalSpecWithTrace>({
      tools: {
        listAvailableDetectors: async () => detectorInventory,
        listConnectedConnectors: async () => connectedConnectors,
        validateGoalDraft: async draft => draft.kpis?.some(kpi =>
          (kpi.source === 'signals' && kpi.signal_types?.some(type => allSignalTypes.includes(type)))
          || (kpi.source === 'external_api' && connectedConnectors.length > 0),
        ) ? [] : ['No KPI can be connected to an available evidence source'],
      },
      callStructured: async agentPrompt => {
        // 'tier:fast' resolves per-provider via createLlmRouter (BYOI: whichever
        // provider the tenant's env configures — Anthropic/OpenAI/Azure/Groq/
        // Ollama — not a hardcoded Anthropic model id).
        const raw = await tenantLlmFn(
          'You are a precise business goal compiler. Output ONLY valid JSON.',
          `${prompt}\n\n## Agent tool context\n${agentPrompt}`,
          'tier:fast',
        )
        return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) as CompiledGoalSpecWithTrace
      },
    })
    const result = await agent.decompose(parsed.data.body)
    if (!result.draft) {
      return reply.status(422).send({ error: result.errors.join('; '), decomposition_trace: result.trace })
    }

    const draft = sanitizeCompiledSpec(result.draft, allSignalTypes)
    draft.decomposition_trace = result.trace
    const confirmationId = (await import('node:crypto')).randomUUID()
    await db.collection('inbound_goal_drafts').insertOne({
      id: confirmationId,
      tenant_id: tenantId,
      from: parsed.data.from,
      channel: parsed.data.channel,
      draft,
      status: 'pending_confirmation',
      created_at: new Date(),
    })
    return reply.status(202).send({
      confirmation_id: confirmationId,
      requires_confirmation: true,
      draft,
    })
  })

  // ── POST /goals/compile ──────────────────────────────────────────────────────
  app.post<{ Body: z.infer<typeof CompileSchema> }>('/goals/compile', async (req, reply) => {
    const parsed = CompileSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'goal text required (5–500 chars)' })
    }

    const { tenant_id } = req.authContext
    const { goal, context } = parsed.data

    // Gather context for the LLM
    const [signalTypes, kpiSources, connectedConnectors] = await Promise.all([
      // Signals this tenant has already seen
      db.collection('signals').distinct('signal_type', { tenant_id }).catch(() => [] as string[]),
      // KPI examples from the goals route
      Promise.resolve([
        { label: 'Overdue invoice count',  source: 'signals', signal_types: ['invoice.overdue'],     aggregation: 'count' },
        { label: 'Monthly revenue',        source: 'signals', signal_types: ['payment.received'],     aggregation: 'sum',   field: 'data.amount_minor', window_days: 30 },
        { label: 'Avg days to pay',        source: 'signals', signal_types: ['payment.received'],     aggregation: 'avg',   field: 'data.days_to_pay' },
        { label: 'Churn rate',             source: 'signals', signal_types: ['subscription.cancelled'], aggregation: 'rate', denominator_signal_types: ['subscription.created'] },
        { label: 'Avg review score',       source: 'signals', signal_types: ['review.created'],       aggregation: 'avg',   field: 'data.rating' },
        { label: 'Support tickets open',   source: 'signals', signal_types: ['ticket.created'],       aggregation: 'count', filter: 'data.status == "open"' },
        { label: 'X followers',            source: 'external_api', metric: 'twitter_followers',       connector_id: 'twitter_x' },
        { label: 'X impressions',          source: 'external_api', metric: 'twitter_impressions',     connector_id: 'twitter_x' },
        { label: 'X engagement rate',      source: 'external_api', metric: 'twitter_engagement_rate', connector_id: 'twitter_x' },
      ]),
      db.collection('connector_credentials')
        .distinct('connector_id', { tenant_id })
        .catch(() => [] as string[]),
    ])

    // Also include registered signal types from the engine
    const engineSignalTypes = engine.registeredSignalTypes
    const allSignalTypes = [...new Set([...signalTypes, ...engineSignalTypes])]

    // Detector inventory
    const detectorInventory = engine.inventory().map(d => ({
      id: d.id,
      name: d.name,
      signal_types: d.signal_types,
    }))

    // P2: check the compiled-goal cache before calling the LLM. Same goal
    // text + same tenant context (signal types, detectors, connectors) =
    // same compiled spec. Saves the full LLM call (~$0.01/compile) on
    // recompiles, which are common when users tweak targets in Studio.
    const cacheKey = compiledGoalCacheKey({
      tenantId: tenant_id, goal, context,
      signalTypes: allSignalTypes,
      detectorInventory,
      connectedConnectors,
    })
    const cached = compiledGoalCache.get(cacheKey)
    if (cached) {
      // Return the cached spec with a flag so the client knows it's cached
      return reply.send({ ...cached.spec, _cached: true, matched_template: cached.matchedTemplateId })
    }

    const prompt = buildCompilerPrompt({
      goalText: goal + (context ? ` (${JSON.stringify(context)})` : ''),
      signalTypes: allSignalTypes,
      detectorInventory,
      kpiExamples: kpiSources,
    })

    const system = 'You are a precise business goal compiler. Output ONLY valid JSON with no markdown, no explanation, no code fences.'

    let spec: CompiledGoalSpecWithTrace
    let matchedTemplateId: string | undefined
    let aiUnavailable = false
    try {
      // ADR-0031: enforce LLM budget before calling the agent
      const compileBudget = await budgetGuard.check(tenant_id)
      if (!compileBudget.allowed) {
        return reply.status(429).send({ error: `LLM budget exceeded: ${compileBudget.reason}` })
      }

      // Gap A5: resolve the tenant's configured LLM (Azure OpenAI, etc.)
      // instead of always using the env-based globalLlmFn.
      const tenantLlmFn = await resolveTenantLlm(db, tenant_id, llmFn)

      const agent = new GoalDecompositionAgent<CompiledGoalSpecWithTrace>({
        tools: {
          listAvailableDetectors: async () => detectorInventory,
          listConnectedConnectors: async () => connectedConnectors,
          validateGoalDraft: async draft => {
            const errors: string[] = []
            if (!draft.name?.trim()) errors.push('Goal name is required')
            if (!draft.kpis?.length) errors.push('At least one KPI is required')
            const hasTrackableKpi = draft.kpis?.some(kpi =>
              (kpi.source === 'signals' && kpi.signal_types?.some(type => allSignalTypes.includes(type)))
              || (kpi.source === 'external_api' && connectedConnectors.length > 0),
            )
            if (!hasTrackableKpi) errors.push('No KPI can be connected to an available evidence source')
            return errors
          },
        },
        callStructured: async agentPrompt => {
          const raw = await tenantLlmFn(system, `${prompt}\n\n## Agent tool context\n${agentPrompt}`, 'tier:fast')
          const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'').trim()
          return JSON.parse(cleaned) as CompiledGoalSpecWithTrace
        },
      })
      const result = await agent.decompose(goal)
      if (!result.draft) {
        return reply.status(422).send({
          error: 'Goal cannot be tracked with the currently connected evidence sources',
          issues: result.errors,
          decomposition_trace: result.trace,
        })
      }
      spec = result.draft
      spec.decomposition_trace = result.trace
    } catch (err) {
      aiUnavailable = true
      const fallbackSpec = templateForGoalText(goal) ?? {
        templateId: 'generic',
        spec: buildGenericSpec(goal),
      }
      matchedTemplateId = fallbackSpec.templateId
      spec = fallbackSpec.spec
      spec.reasoning = `${spec.reasoning} Used a fallback because AI compilation was unavailable.`
      spec.warnings = [
        ...(spec.warnings ?? []),
        `AI compilation unavailable; used fallback. Detail: ${String(err)}`,
      ]
    }

    // Validate KPIs — strip fields that are null/undefined from LLM output
    spec = sanitizeCompiledSpec(spec, allSignalTypes)

    // Add YAML for any new (non-existing) detectors
    for (const det of spec.detectors ?? []) {
      if (!det.existing) {
        det.yaml = generateDetectorYaml(det.id, det.name, spec.kpis, spec.name)
      }
    }

    // Add warnings for missing signal data
    for (const kpi of spec.kpis) {
      if (kpi.source === 'signals' && kpi.signal_types?.length) {
        const hasSeen = kpi.signal_types.some(st => allSignalTypes.includes(st))
        if (!hasSeen) {
          spec.warnings = spec.warnings ?? []
          spec.warnings.push(`No data yet for signal type '${kpi.signal_types[0]}'. Connect the relevant data source first.`)
        }
      }
    }

    // P2: cache the compiled spec so recompiles of the same goal text
    // (common when users tweak targets in Studio) return instantly without
    // hitting the LLM. Only cache successful AI compilations, not fallbacks
    // (fallbacks are deterministic and don't benefit from caching).
    if (!aiUnavailable) {
      compiledGoalCache.set(cacheKey, { spec, matchedTemplateId })
    }

    return { spec, goal_text: goal, template_id: matchedTemplateId, ai_unavailable: aiUnavailable }
  })

  // ── POST /goals/compile/confirm ──────────────────────────────────────────────
  app.post<{ Body: z.infer<typeof ConfirmSchema> }>('/goals/compile/confirm', async (req, reply) => {
    const parsed = ConfirmSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: 'spec required' })

    const { tenant_id, user_id } = req.authContext
    const { spec: rawSpec, generate_detectors, template_id, parent_goal_id, autonomy_enabled } = parsed.data
    const template = template_id ? getGoalTemplate(template_id) : undefined
    let spec = rawSpec as CompiledGoalSpecWithTrace
    const [tenantSignalTypes, tenantSettings] = await Promise.all([
      db.collection('signals').distinct('signal_type', { tenant_id }).catch(() => [] as string[]),
      db.collection('tenant_settings').findOne({ tenant_id }),
    ])
    const vertical = String(tenantSettings?.['active_vertical'] ?? template?.domain ?? 'default')
    spec = sanitizeCompiledSpec(spec, [...new Set([...tenantSignalTypes, ...engine.registeredSignalTypes])])

    // Connector pre-flight check for KPIs with source: 'signals'
    const connectedConnectors = await db.collection('connector_credentials')
      .find({ tenant_id })
      .project({ connector_id: 1 })
      .toArray()
    const connectedConnectorIds = new Set(connectedConnectors.map(c => c['connector_id'] as string))
    
    // Map signal types to required connectors
    const signalTypeToConnector: Record<string, string> = {
      'xero.invoice.paid': 'xero',
      'xero.invoice.created': 'xero',
      'stripe.payment.succeeded': 'stripe',
      'stripe.invoice.paid': 'stripe',
      'hubspot.contact.created': 'hubspot',
      'hubspot.deal.created': 'hubspot',
      // Add more mappings as needed
    }
    
    const kpiStatusMap: Record<string, 'live' | 'pending_connector' | 'manual_only'> = {}
    spec.kpis.forEach(kpi => {
      let kpiStatus: 'live' | 'pending_connector' | 'manual_only' = 'live'
      
      if (kpi.source === 'manual') {
        kpiStatus = 'manual_only'
      } else if (kpi.source === 'signals' && kpi.signal_types) {
        // Check if any signal type requires a connector that's not connected
        const missingConnector = kpi.signal_types.some(signalType => {
          const requiredConnector = signalTypeToConnector[signalType]
          return requiredConnector && !connectedConnectorIds.has(requiredConnector)
        })
        if (missingConnector) {
          kpiStatus = 'pending_connector'
        }
      }
      
      kpiStatusMap[kpi.metric] = kpiStatus
    })

    // 1. Write generated detector YAMLs to disk (engine hot-reloads automatically)
    const savedDetectors: string[] = []
    if (generate_detectors) {
      // Ensure directory exists
      const { mkdir } = await import('node:fs/promises')
      await mkdir(DETECTORS_DIR, { recursive: true }).catch(() => {})

      for (const det of spec.detectors ?? []) {
        if (!det.existing && det.yaml && det.id) {
          const filePath = join(DETECTORS_DIR, `${det.id}.yaml`)
          // Don't overwrite existing detectors
          if (!existsSync(filePath)) {
            await writeFile(filePath, det.yaml, 'utf8')
            savedDetectors.push(det.id)
          }
        }
      }
    }
    if (savedDetectors.length > 0) {
      await engine.load()
    }

    // 2. Create goal in GoalStore
    // BUG-002 safeguard: idempotent dedup — if an active goal with the same
    // name already exists for this tenant, return it instead of creating a
    // duplicate. Without this, confirming a compile twice produces two goal
    // documents with different IDs and disagreeing progress values.
    const existingGoal = await db.collection('goals').findOne({
      tenant_id,
      name: spec.name,
      status: { $nin: ['archived', 'achieved', 'failed'] },
    })
    if (existingGoal) {
      return reply.status(200).send({
        goal: existingGoal,
        detectors_saved: savedDetectors.length,
        kpi_status_map: kpiStatusMap,
        deduplicated: true,
        message: 'An active goal with this name already exists.',
      })
    }

    const { randomUUID } = await import('node:crypto')
    const now = new Date()
    const goal = {
      id:           randomUUID(),
      tenant_id,
      name:         spec.name,
      description:  spec.description,
      timeline_days: spec.timeline_days ?? 90,
      start_date:   now,
      target_date:  new Date(now.getTime() + (spec.timeline_days ?? 90) * 86_400_000),
      kpis:         spec.kpis.map(kpi => ({ ...kpi, kpi_status: kpiStatusMap[kpi.metric] ?? 'live' })),
      tags:         [...(spec.tags ?? []), 'ai-compiled'],
      detector_ids: (spec.detectors ?? []).map(d => d.id),
      status:       'active' as const,
      compiled_by:  user_id,
      compiled_from: spec.reasoning,
      decomposition_trace: spec.decomposition_trace ?? [],
      at_risk_threshold: 0.4,
      vertical,
      ...(parent_goal_id ? { parent_goal_id } : {}),
      ...(template ? {
        template_id: template.id,
        domain: template.domain,
        execution_plan: {
          enabled: autonomy_enabled,
          cadence: template.cadence,
          required_connectors: template.required_connectors,
          skills: template.skills,
          steps: template.plan,
          stop_condition: template.stop_condition,
          status: autonomy_enabled ? 'active' : 'paused',
          cycle_count: 0,
          next_run_at: now,
        },
      } : {}),
      created_at:   now,
      updated_at:   now,
    }

    const creation = template
      ? await createGoalIdempotently(db, tenant_id, template.id, vertical, goal, now)
      : { goal, created: true }
    if (!template) await db.collection('goals').insertOne(goal)
    if (creation.created) await refreshGoalDetectorActivations(db, engine, creation.goal)

    return reply.status(creation.created ? 201 : 200).send({
      goal: creation.goal,
      deduplicated: !creation.created,
      detectors_saved: savedDetectors,
      kpi_status_map: kpiStatusMap,
      message: savedDetectors.length > 0
        ? `Goal created. ${savedDetectors.length} new detector(s) saved and hot-loaded.`
        : 'Goal created with existing detectors.',
    })
  })
}
