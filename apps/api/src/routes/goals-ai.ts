/**
 * Goals AI — AI-powered goal refinement and assistance.
 *
 * Phase 1 Feature: Conversational Goal Setting
 *
 * Routes:
 *   POST /goals/ai-refine            — Refine natural language into structured goal
 *   POST /goals/ai-suggest           — Get AI suggestions for current goal state
 */

import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { createLlmRouter, createLlmRouterFromEnv, createLogger, repoRoot, type LlmProvider } from '@kairos/platform'
import { loadVerticals } from '@kairos/workflows'
import type { Vertical } from '@kairos/specifications'
import { getTenantLlmConfig } from './settings.js'
import { guardLlmBudget } from '../lib/llm-guard.js'
import type { AIPersonality } from './ai-personality.js'

const log = createLogger({ service: 'goals-ai', version: '0.0.0' })

// ── Vertical manifest cache ───────────────────────────────────────────────────
//
// The goal-refine prompt used to branch on a hardcoded if/else over
// active_vertical with stale ids ('sme', 'real-estate', 'healthcare') that
// matched no shipped vertical — so only 'trading-investment' ever fired and
// four of five verticals got no LLM context. Loaded once at module init from
// verticals/*.yaml (file-loaded, not per-request); a server restart picks up
// manifest edits, same as the detector/workflow loaders.
const VERTICALS: Vertical[] = loadVerticals(repoRoot())

/**
 * Build a vertical-context prefix for the goal-refine system prompt, derived
 * from the active vertical's own manifest fields (tagline, persona
 * jobs_to_be_done, kpi_vocabulary) — the same fields the UI and onboarding
 * read. Returns '' when the vertical id is unknown or no vertical is set, so
 * the caller falls back to the generic prompt unchanged.
 *
 * Exported for unit testing — the regression guard against re-introducing
 * the stale-id dead branches ('sme', 'real-estate', 'healthcare') that the
 * data-driven lookup replaced.
 */
export function verticalPromptFor(activeVerticalId: string | undefined): string {
  if (!activeVerticalId) return ''
  const v = VERTICALS.find((x) => x.id === activeVerticalId)
  if (!v) return ''
  const jobs = v.personas.flatMap((p) => p.jobs_to_be_done).slice(0, 6)
  const kpis = v.kpi_vocabulary.slice(0, 6)
  return [
    `This user is on the ${v.name} vertical: ${v.tagline}.`,
    jobs.length ? `Suggest goals aligned with these jobs-to-be-done: ${jobs.join('; ')}.` : '',
    kpis.length ? `Prefer KPIs from this vocabulary: ${kpis.join(', ')}.` : '',
    `Avoid goals outside this vertical's scope.`,
  ].filter(Boolean).join(' ')
}

// ── Personality Prompts (simplified for integration) ─────────────────────────────

const PERSONALITY_PROMPTS: Record<string, string> = {
  'professional-beginner-concise': 'Use formal language, explain simply, keep brief.',
  'professional-beginner-balanced': 'Use formal language, explain simply, provide moderate detail.',
  'professional-beginner-detailed': 'Use formal language, explain thoroughly, provide comprehensive details.',
  'professional-intermediate-concise': 'Use formal language, assume intermediate knowledge, keep brief.',
  'professional-intermediate-balanced': 'Use formal language, assume intermediate knowledge, provide balanced detail.',
  'professional-intermediate-detailed': 'Use formal language, assume intermediate knowledge, provide comprehensive analysis.',
  'professional-expert-concise': 'Use formal language, assume expert knowledge, deliver concise insights.',
  'professional-expert-balanced': 'Use formal language, assume expert knowledge, provide balanced depth.',
  'professional-expert-detailed': 'Use formal language, assume expert knowledge, provide exhaustive analysis.',
  'friendly-beginner-concise': 'Use warm language, explain simply, keep brief and encouraging.',
  'friendly-beginner-balanced': 'Use warm language, explain simply, provide helpful detail.',
  'friendly-beginner-detailed': 'Use warm language, explain thoroughly, be patient and supportive.',
  'friendly-intermediate-concise': 'Use warm language, assume intermediate knowledge, keep brief.',
  'friendly-intermediate-balanced': 'Use warm language, assume intermediate knowledge, provide balanced detail.',
  'friendly-intermediate-detailed': 'Use warm language, assume intermediate knowledge, be thorough.',
  'friendly-expert-concise': 'Use warm language, assume expert knowledge, deliver concise insights.',
  'friendly-expert-balanced': 'Use warm language, assume expert knowledge, provide balanced depth.',
  'friendly-expert-detailed': 'Use warm language, assume expert knowledge, be thorough.',
  'casual-beginner-concise': 'Use relaxed language, explain simply, keep brief.',
  'casual-beginner-balanced': 'Use relaxed language, explain simply, provide helpful detail.',
  'casual-beginner-detailed': 'Use relaxed language, explain thoroughly, be conversational.',
  'casual-intermediate-concise': 'Use relaxed language, assume intermediate knowledge, keep brief.',
  'casual-intermediate-balanced': 'Use relaxed language, assume intermediate knowledge, provide balanced detail.',
  'casual-intermediate-detailed': 'Use relaxed language, assume intermediate knowledge, be thorough.',
  'casual-expert-concise': 'Use relaxed language, assume expert knowledge, deliver concise insights.',
  'casual-expert-balanced': 'Use relaxed language, assume expert knowledge, provide balanced depth.',
  'casual-expert-detailed': 'Use relaxed language, assume expert knowledge, be thorough.',
}

// ── Schema ─────────────────────────────────────────────────────────────────────

const AIRefineRequestSchema = z.object({
  userMessage: z.string().min(1).max(2000),
  currentGoalState: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    timeline_days: z.number().optional(),
    kpis: z.array(z.any()).optional(),
  }).optional(),
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
  llmProvider: z.enum(['cloud', 'ollama', 'auto']).optional(),
})

const AIRefineResponseSchema = z.object({
  reasoning: z.array(z.string()),
  structuredGoal: z.object({
    name: z.string(),
    description: z.string(),
    timeline_days: z.number(),
    kpis: z.array(z.object({
      metric: z.string(),
      label: z.string(),
      unit: z.string(),
      target: z.number(),
      start_value: z.number(),
      direction: z.enum(['increase', 'decrease']),
      source: z.enum(['signals', 'external_api', 'manual']),
    })),
    cadence: z.enum(['daily', 'weekly']),
  }),
  suggestions: z.array(z.object({
    label: z.string(),
    action: z.string(), // 'add_kpi', 'set_timeline', 'adjust_target'
    value: z.any(),
  })),
  // Phase 2: Multi-option suggestions
  options: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    timeline_days: z.number(),
    kpis: z.array(z.object({
      metric: z.string(),
      label: z.string(),
      unit: z.string(),
      target: z.number(),
      start_value: z.number(),
      direction: z.enum(['increase', 'decrease']),
      source: z.enum(['signals', 'external_api', 'manual']),
    })),
    tradeoffs: z.array(z.string()),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
    recommended: z.boolean(),
  })).optional(),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarifyingQuestion: z.string().optional(),
})

export type AIRefineRequest = z.infer<typeof AIRefineRequestSchema>
export type AIRefineResponse = z.infer<typeof AIRefineResponseSchema>

// ── Prompt Templates ───────────────────────────────────────────────────────────

const GOAL_REFINE_SYSTEM_PROMPT = `You are a goal determination expert for Kairos, an AI-powered business goal tracking platform.

Your role is to help users transform vague intentions into structured, measurable goals with KPIs.

Guidelines:
1. Interpret the user's intent into a clear, specific goal name
2. Suggest appropriate KPIs based on the goal type (social media, sales, operations, etc.)
3. Recommend a realistic timeline (30-90 days for most goals)
4. Suggest a cadence (daily for fast-moving metrics like social media, weekly for slower metrics)
5. Provide reasoning for your decisions
6. If the goal is vague, ask a clarifying question instead of guessing
7. Phase 2: When appropriate, provide 2-3 alternative goal options with trade-offs

KPI Examples:
- Social Media: followers, impressions, engagement_rate, mentions
- Sales: revenue, deals_closed, conversion_rate, pipeline_value
- Operations: tasks_completed, avg_response_time, error_rate, uptime
- Customer Satisfaction: nps_score, csat_score, churn_rate, retention_rate

IMPORTANT: You must respond with valid JSON only. No markdown, no explanations outside the JSON.

Output Format: JSON with the following structure:
{
  "reasoning": ["step 1", "step 2", ...],
  "structuredGoal": {
    "name": "Clear goal name",
    "description": "Detailed description",
    "timeline_days": 90,
    "kpis": [
      {
        "metric": "kpi_name",
        "label": "Human-readable label",
        "unit": "unit (e.g., followers, $, %)",
        "target": 10000,
        "start_value": 0,
        "direction": "increase",
        "source": "signals"
      }
    ],
    "cadence": "daily"
  },
  "suggestions": [
    {
      "label": "Add follower growth KPI",
      "action": "add_kpi",
      "value": { "metric": "followers", "label": "Followers", "unit": "followers", "target": 10000, "start_value": 0, "direction": "increase", "source": "external_api" }
    }
  ],
  "options": [
    {
      "id": "option-1",
      "name": "Alternative goal name",
      "description": "Different approach",
      "timeline_days": 60,
      "kpis": [...],
      "tradeoffs": ["Trade-off 1", "Trade-off 2"],
      "pros": ["Pro 1", "Pro 2"],
      "cons": ["Con 1", "Con 2"],
      "recommended": false
    }
  ],
  "confidence": 0.85,
  "needsClarification": false,
  "clarifyingQuestion": "Optional question if goal is vague"
}`

// ── AI Service ─────────────────────────────────────────────────────────────────

async function callAI(prompt: string, systemPrompt: string, llmFn: ReturnType<typeof createLlmRouter>, provider: 'cloud' | 'ollama' | 'auto' = 'auto'): Promise<any> {
  try {
    // LlmFn is a function: (system: string, prompt: string, model?: string) => Promise<string>
    const responseText = await llmFn(systemPrompt, prompt)
    return JSON.parse(responseText)
  } catch (error) {
    log.error({ err: error }, 'AI call error')
    
    // If cloud fails and provider is 'auto' or 'ollama', try Ollama fallback
    if ((provider === 'auto' || provider === 'ollama') && error instanceof Error) {
      try {
        log.info({}, 'Attempting Ollama fallback...')
        const ollamaLlm = createLlmRouter({
          provider: 'ollama',
          defaultModel: 'qwen2.5:7b',
          ollamaBaseUrl: 'http://localhost:11434',
        })
        const responseText = await ollamaLlm(systemPrompt, prompt)
        return JSON.parse(responseText)
      } catch (ollamaError) {
        log.error({ err: ollamaError }, 'Ollama fallback also failed')
        throw new Error(`AI call failed (both cloud and Ollama): ${error.message}`)
      }
    }
    
    throw new Error(`AI call failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ── Route Handlers ─────────────────────────────────────────────────────────────

export async function registerGoalsAIRoutes(app: FastifyInstance, db: any) {
  // Helper function to get user's AI personality settings
  async function getUserAIPersonality(userId: string, tenantId: string): Promise<AIPersonality | null> {
    if (!db) return null
    
    try {
      const col = db.collection('ai_personality_settings')
      const doc = await col.findOne({ user_id: userId, tenant_id: tenantId }) as any
      return doc?.settings || null
    } catch (error) {
      log.error({ err: error }, 'Failed to fetch AI personality settings')
      return null
    }
  }

  // ── POST /goals/ai-refine ─────────────────────────────────────────────────────
  app.post<{ Body: AIRefineRequest }>('/goals/ai-refine', async (req, reply) => {
    const parsed = AIRefineRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      })
    }

    const { userMessage, currentGoalState, conversationHistory, llmProvider } = parsed.data
    const { tenant_id, user_id } = req.authContext

    // Get user's AI personality settings
    const aiPersonality = await getUserAIPersonality(user_id, tenant_id)

    // Build LLM function with tenant config
    let llmFn = createLlmRouterFromEnv()
    if (db) {
      try {
        const tenantCfg = await getTenantLlmConfig(db, tenant_id)
        log.info({ tenant_config: tenantCfg }, 'Tenant config')
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
          log.info({}, 'LLM router created with tenant config')
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

    // Build prompt with context
    let prompt = `User wants to achieve: ${userMessage}\n\n`

    if (currentGoalState) {
      prompt += `Current goal state:\n`
      if (currentGoalState.name) prompt += `- Name: ${currentGoalState.name}\n`
      if (currentGoalState.description) prompt += `- Description: ${currentGoalState.description}\n`
      if (currentGoalState.timeline_days) prompt += `- Timeline: ${currentGoalState.timeline_days} days\n`
      if (currentGoalState.kpis && currentGoalState.kpis.length > 0) {
        prompt += `- Current KPIs: ${JSON.stringify(currentGoalState.kpis)}\n`
      }
      prompt += '\n'
    }

    if (conversationHistory && conversationHistory.length > 0) {
      prompt += `Conversation history:\n`
      conversationHistory.forEach(msg => {
        prompt += `${msg.role}: ${msg.content}\n`
      })
      prompt += '\n'
    }

    prompt += `Please refine this into a structured goal with KPIs.`

    // Load tenant onboarding context so the AI suggests goals that match the
    // user's vertical and risk tolerance instead of generic defaults.
    let verticalPrompt = ''
    try {
      const settingsCol = db.collection('tenant_settings')
      const [mainSettingsDoc, strategyDoc] = await Promise.all([
        settingsCol.findOne({ tenant_id }),
        settingsCol.findOne({ tenant_id, key: 'defensive_trend_strategy' }),
      ])
      const activeVertical = (mainSettingsDoc?.active_vertical as string | undefined) ?? undefined
      const strategyValue = (strategyDoc?.value as Record<string, unknown> | undefined) ?? {}
      const riskTier = typeof strategyValue?.riskTier === 'string' ? strategyValue.riskTier : undefined

      // Data-driven: derive the prompt from the vertical's own manifest
      // (tagline + persona jobs_to_be_done + kpi_vocabulary) instead of a
      // hardcoded if/else. Covers every shipped vertical automatically and
      // kills the stale-id dead branches ('sme', 'real-estate', 'healthcare')
      // that matched no shipped vertical id.
      verticalPrompt = verticalPromptFor(activeVertical)

      if (riskTier) {
        verticalPrompt += ` Their risk tolerance is ${riskTier}.`
      }
    } catch {
      // Context lookup is best-effort; fall back to generic prompt.
    }

    // Build system prompt with AI personality and vertical/risk context
    let systemPrompt = GOAL_REFINE_SYSTEM_PROMPT
    if (verticalPrompt || aiPersonality) {
      const personalityKey = aiPersonality ? `${aiPersonality.tone}-${aiPersonality.expertise}-${aiPersonality.verbosity}` : ''
      const personalityPrompt = PERSONALITY_PROMPTS[personalityKey] || ''
      const prefix = [personalityPrompt, verticalPrompt].filter(Boolean).join('\n\n')
      if (prefix) {
        systemPrompt = `${prefix}\n\n${GOAL_REFINE_SYSTEM_PROMPT}`
      }
    }

    try {
      const aiResponse = await callAI(prompt, systemPrompt, llmFn, llmProvider || 'auto')

      // Validate AI response
      const validated = AIRefineResponseSchema.safeParse(aiResponse)
      if (!validated.success) {
        log.error({ issues: validated.error.issues }, 'AI response validation failed')
        return reply.status(500).send({
          error: 'AI response validation failed',
          rawResponse: aiResponse,
        })
      }

      return reply.status(200).send(validated.data)
    } catch (error) {
      log.error({ err: error }, 'AI refinement error')
      return reply.status(500).send({
        error: 'Failed to refine goal with AI',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  // ── POST /goals/ai-suggest ────────────────────────────────────────────────────
  // Get AI suggestions for current goal state (e.g., add KPI, adjust timeline)
  app.post('/goals/ai-suggest', async (req, reply) => {
    const { tenant_id } = req.authContext
    const { currentGoalState } = req.body as { currentGoalState?: any }

    if (!currentGoalState) {
      return reply.status(400).send({ error: 'currentGoalState is required' })
    }

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

    const prompt = `Current goal state:\n${JSON.stringify(currentGoalState, null, 2)}\n\n` +
      `Please suggest improvements or additions to this goal. Focus on:\n` +
      `1. Missing KPIs that would make the goal more measurable\n` +
      `2. Timeline adjustments if the current timeline seems unrealistic\n` +
      `3. Additional context or refinements\n\n` +
      `Output JSON format:\n` +
      `{\n` +
      `  "suggestions": [\n` +
      `    {\n` +
      `      "label": "Add engagement rate KPI",\n` +
      `      "action": "add_kpi",\n` +
      `      "value": { "metric": "engagement_rate", "label": "Engagement Rate", "unit": "%", "target": 5, "start_value": 0, "direction": "increase", "source": "signals" },\n` +
      `      "reasoning": "Engagement rate is a key metric for social media goals"\n` +
      `    }\n` +
      `  ],\n` +
      `  "reasoning": "Overall reasoning for suggestions"\n` +
      `}`

    try {
      const aiResponse = await callAI(prompt, GOAL_REFINE_SYSTEM_PROMPT, llmFn)
      return reply.status(200).send(aiResponse)
    } catch (error) {
      log.error({ err: error }, 'AI suggestion error')
      return reply.status(500).send({
        error: 'Failed to generate AI suggestions',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
