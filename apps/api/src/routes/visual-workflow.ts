/**
 * Visual Workflow Builder — Low-code/no-code workflow management.
 *
 * Phase 5 Feature: Low-Code/No-Code Foundation
 *
 * Routes:
 *   GET  /workflows/visual/:id  — Get visual workflow (nodes, connections)
 *   POST /workflows/visual/:id  — Save visual workflow
 *   POST /workflows/nl-to-visual  — Convert natural language to visual workflow
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { createLlmRouter, createLlmRouterFromEnv, createLogger, type LlmProvider } from '@kairos/platform'
import { getTenantLlmConfig } from './settings.js'
import { guardLlmBudget } from '../lib/llm-guard.js'

const log = createLogger({ service: 'visual-workflow', version: '0.0.0' })

// ── Schema ─────────────────────────────────────────────────────────────────────

const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['trigger', 'ai', 'human', 'action', 'condition', 'loop', 'delay', 'connector']),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: z.record(z.any()),
  config: z.record(z.any()).optional(),
})

const WorkflowConnectionSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(['default', 'success', 'failure', 'condition_true', 'condition_false']),
  label: z.string().optional(),
})

const VisualWorkflowSchema = z.object({
  workflow_id: z.string(),
  tenant_id: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema),
  connections: z.array(WorkflowConnectionSchema),
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    version: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
})

const NLToVisualRequestSchema = z.object({
  description: z.string(),
  context: z.record(z.any()).optional(),
})

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowConnection = z.infer<typeof WorkflowConnectionSchema>
export type VisualWorkflow = z.infer<typeof VisualWorkflowSchema>

// ── NL to Visual Prompt Template ─────────────────────────────────────────────────

const NL_TO_VISUAL_PROMPT = `You are a workflow design expert for Kairos, a low-code/no-code automation platform.

Your role is to convert natural language descriptions into visual workflow structures.

Guidelines:
1. Identify the trigger (what starts the workflow)
2. Identify key actions (what the workflow does)
3. Identify conditions (branching logic)
4. Identify human approval points
5. Identify connectors (external API calls)
6. Organize nodes in a logical left-to-right flow

Available node types:
- trigger: Workflow entry point (e.g., webhook, schedule, signal)
- ai: AI processing or analysis
- human: Human approval or input
- action: Perform an action (send email, update database, call API)
- condition: Branching logic (if/else)
- loop: Repeat actions
- delay: Wait for a specified time
- connector: External system integration

Output Format: JSON with the following structure:
{
  "nodes": [
    {
      "id": "node-1",
      "type": "trigger",
      "position": { "x": 100, "y": 200 },
      "data": { "label": "Webhook", "config": { "path": "/webhook" } }
    }
  ],
  "connections": [
    {
      "id": "conn-1",
      "source": "node-1",
      "target": "node-2",
      "type": "default"
    }
  ]
}

IMPORTANT: You must respond with valid JSON only. No markdown, no explanations outside the JSON.`

// ── Route Handlers ─────────────────────────────────────────────────────────────

export async function registerVisualWorkflowRoutes(app: FastifyInstance, db: Db) {
  const col = db.collection<VisualWorkflow>('visual_workflows')
  // Compound index ensures tenant isolation — same workflow_id can exist for different tenants
  col.createIndex({ workflow_id: 1, tenant_id: 1 }, { unique: true }).catch(() => {})

  // ── GET /workflows/visual/:id ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/workflows/visual/:id', async (req, reply) => {
    const { id: workflowId } = req.params
    const tenant_id = req.authContext.tenant_id

    try {
      const workflow = await col.findOne({ workflow_id: workflowId, tenant_id })
      
      if (!workflow) {
        // Return empty workflow
        return reply.status(200).send({
          workflow_id: workflowId,
          nodes: [],
          connections: [],
          metadata: {
            name: 'Untitled Workflow',
            description: '',
            version: '1.0.0',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        })
      }

      return reply.status(200).send(workflow)
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch visual workflow')
      return reply.status(500).send({
        error: 'Failed to fetch visual workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /workflows/visual/:id ─────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/workflows/visual/:id', async (req, reply) => {
    const { id: workflowId } = req.params
    const tenant_id = req.authContext.tenant_id

    const parsed = VisualWorkflowSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid visual workflow',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const workflow: VisualWorkflow = {
      ...parsed.data,
      workflow_id: workflowId,
      tenant_id,
      nodes: parsed.data.nodes || [],
      connections: parsed.data.connections || [],
      metadata: {
        name: parsed.data.metadata?.name || 'Untitled Workflow',
        description: parsed.data.metadata?.description || '',
        version: parsed.data.metadata?.version || '1.0.0',
        created_at: parsed.data.metadata?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    }

    try {
      await col.updateOne(
        { workflow_id: workflowId, tenant_id },
        { $set: workflow },
        { upsert: true }
      )

      return reply.status(200).send(workflow)
    } catch (error) {
      log.error({ err: error }, 'Failed to save visual workflow')
      return reply.status(500).send({
        error: 'Failed to save visual workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /workflows/nl-to-visual ─────────────────────────────────────────────────
  app.post('/workflows/nl-to-visual', async (req, reply) => {
    const { tenant_id } = req.authContext

    const parsed = NLToVisualRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid NL to visual request',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const { description, context } = parsed.data

    // Build LLM function with tenant config
    let llmFn = createLlmRouterFromEnv()
    if (db) {
      try {
        const tenantCfg = await getTenantLlmConfig(db, tenant_id)
        if (tenantCfg) {
          llmFn = createLlmRouter({
            provider: tenantCfg.provider as LlmProvider,
            defaultModel: tenantCfg.model,
            temperature: tenantCfg.temperature,
            maxTokens: tenantCfg.maxTokens,
            ...(tenantCfg.apiKey !== undefined ? { apiKey: tenantCfg.apiKey } : {}),
            ...(tenantCfg.azureEndpoint !== undefined ? { azureEndpoint: tenantCfg.azureEndpoint } : {}),
            ...(tenantCfg.azureDeployment !== undefined ? { azureDeployment: tenantCfg.azureDeployment } : {}),
            ...(tenantCfg.azureApiVersion !== undefined ? { azureApiVersion: tenantCfg.azureApiVersion } : {}),
            ...(tenantCfg.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: tenantCfg.ollamaBaseUrl } : {}),
          })
        }
      } catch (error) {
        log.error({ err: error }, 'Error loading tenant config')
        /* use env fallback */
      }
    }

    // Enforce tenant LLM budget before spending their key
    const guard = await guardLlmBudget(db, tenant_id)
    if (!guard.allowed) {
      return reply.status(429).send({ error: guard.reason, code: 'LLM_BUDGET_EXHAUSTED' })
    }

    try {
      let prompt = `User wants to create a workflow: ${description}\n\n`
      
      if (context) {
        prompt += `Context:\n${JSON.stringify(context, null, 2)}\n\n`
      }

      const response = await llmFn(NL_TO_VISUAL_PROMPT, prompt)
      const visualWorkflow = JSON.parse(response)

      return reply.status(200).send(visualWorkflow)
    } catch (error) {
      log.error({ err: error }, 'Failed to convert NL to visual workflow')
      return reply.status(500).send({
        error: 'Failed to convert NL to visual workflow',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
