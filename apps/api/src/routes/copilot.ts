import type { FastifyInstance } from 'fastify'
import type { Db } from 'mongodb'
import { LRUCache } from 'lru-cache'
import { createLlmRouter } from '@kairos/platform'
import type { LlmProvider } from '@kairos/platform'
import { getTenantLlmConfig } from './settings.js'

interface BusinessContext {
  tenant_id: string
  page: string
  conversation_history: Array<{ role: string; content: string }>
}

interface CopilotResponse {
  response: string
  type: 'text' | 'insight' | 'action' | 'chart' | 'table'
  metadata?: {
    confidence?: number
    sources?: string[]
  }
}

/**
 * Pulls the tenant's real recent activity — insights, portfolio holdings,
 * goals — into a text block the LLM can ground its answer in. Without this
 * the model has nothing but the raw user message and would either refuse
 * to answer specifics or hallucinate numbers.
 *
 * P1 cost optimisation: results are cached in an LRU with 5-minute TTL.
 * The context (recent insights, holdings, goals) changes infrequently —
 * at most a few times per minute on an active tenant — so a 5-min TTL
 * saves ~99% of MongoDB aggregation queries for chatty copilot users
 * with zero observable staleness. The cache is per-process (in-memory),
 * which is sufficient because the context is a summary, not a precise
 * snapshot. Cache is busted on writes via the `invalidateTenantContext`
 * helper (called from insight/portfolio/goal mutation routes).
 */
const tenantContextCache = new LRUCache<string, string>({
  max: 500, // up to 500 tenants
  ttl: 5 * 60_000, // 5 minutes
})

/** Invalidate the cached tenant context — call after mutations. */
export function invalidateTenantContext(tenantId: string): void {
  tenantContextCache.delete(tenantId)
}

export async function buildTenantContext(db: Db, tenantId: string): Promise<string> {
  const cached = tenantContextCache.get(tenantId)
  if (cached !== undefined) return cached

  const context = await buildTenantContextUncached(db, tenantId)
  tenantContextCache.set(tenantId, context)
  return context
}

async function buildTenantContextUncached(db: Db, tenantId: string): Promise<string> {
  const sections: string[] = []

  const insights = await db.collection('insights')
    .find({ tenant_id: tenantId, state: { $nin: ['dismissed', 'archived'] } })
    .sort({ created_at: -1 })
    .limit(10)
    .toArray()
  if (insights.length > 0) {
    const lines = insights.map(i => {
      const low = Number(i['estimated_impact_low'] ?? 0)
      const high = Number(i['estimated_impact_high'] ?? 0)
      const impact = high > 0 ? ` (impact £${(low / 100).toFixed(0)}-£${(high / 100).toFixed(0)})` : ''
      const confidence = i['confidence_breakdown'] && typeof i['confidence_breakdown'] === 'object'
        ? Number((i['confidence_breakdown'] as Record<string, unknown>)['overall'] ?? 0)
        : 0
      return `- [${i['state']}] ${i['hypothesis'] ?? 'Untitled insight'}${impact}${confidence ? ` — ${Math.round(confidence * 100)}% confidence` : ''}`
    })
    sections.push(`Open insights (most recent first):\n${lines.join('\n')}`)
  }

  // Portfolio holdings — same dedup-by-ticker fix as /portfolio/holdings,
  // since the raw `signals` collection has one doc per sync cycle, not one
  // per ticker (see buildHoldingsFromSignals in portfolio.ts).
  const signals = await db.collection('signals')
    .find({ tenant_id: tenantId, signal_type: { $in: ['portfolio_position', 'portfolio_summary'] } })
    .sort({ created_at: -1 })
    .limit(200)
    .toArray()
  const latestPositionByTicker = new Map<string, Record<string, unknown>>()
  let summary: Record<string, unknown> | undefined
  for (const s of signals) {
    const data = s['data'] as Record<string, unknown> | undefined
    if (!data) continue
    if (s['signal_type'] === 'portfolio_summary' && !summary) summary = data
    if (s['signal_type'] === 'portfolio_position') {
      const ticker = String(data['ticker'] ?? '')
      if (ticker && !latestPositionByTicker.has(ticker)) latestPositionByTicker.set(ticker, data)
    }
  }
  if (latestPositionByTicker.size > 0 || summary) {
    const lines: string[] = []
    if (summary) {
      lines.push(`Total value: £${(Number(summary['total_value'] ?? 0) / 100).toFixed(2)}, cash: £${(Number(summary['cash'] ?? 0) / 100).toFixed(2)}`)
    }
    for (const pos of latestPositionByTicker.values()) {
      const current = Number(pos['current_price'] ?? 0) / 100
      const avg = Number(pos['avg_price'] ?? 0) / 100
      const qty = Number(pos['quantity'] ?? 0)
      const changePct = avg > 0 ? (((current - avg) / avg) * 100).toFixed(1) : '0'
      lines.push(`- ${pos['ticker']}: ${qty} units @ £${current.toFixed(2)} (avg cost £${avg.toFixed(2)}, ${changePct}%)`)
    }
    sections.push(`Portfolio holdings:\n${lines.join('\n')}`)
  }

  const goals = await db.collection('goals')
    .find({ tenant_id: tenantId, status: { $ne: 'archived' } })
    .sort({ created_at: -1 })
    .limit(5)
    .toArray()
  if (goals.length > 0) {
    const lines = goals.map(g => `- ${g['name'] ?? 'Untitled goal'} (${g['overall_status'] ?? 'in progress'})`)
    sections.push(`Active goals:\n${lines.join('\n')}`)
  }

  return sections.length > 0
    ? sections.join('\n\n')
    : 'No insights, holdings, or goals recorded for this tenant yet.'
}

const SYSTEM_PROMPT = `You are Kairos's business copilot, embedded in a live operations and trading intelligence app. You answer the user's question using ONLY the real data provided below — never invent numbers, tickers, or figures that aren't in the context. If the context doesn't contain enough information to answer precisely, say so plainly rather than guessing. Keep answers concise and actionable. When discussing trading positions, be factual and avoid giving direct investment advice — describe what the data shows and what Kairos's own detectors have already flagged, rather than making buy/sell recommendations yourself.`

/**
 * Calls the tenant's configured LLM with real context. Returns a
 * user-facing message directly (never throws) so route handlers can send
 * it as-is whether the call succeeded, failed, or no provider is set up.
 */
async function callCopilotLlm(
  db: Db,
  tenantId: string,
  message: string,
  history: Array<{ role: string; content: string }>,
): Promise<{ text: string; ok: boolean }> {
  const tenantCfg = await getTenantLlmConfig(db, tenantId)
  if (!tenantCfg) {
    return {
      ok: false,
      text: 'No AI provider is configured for this workspace yet. Add one in Settings → AI Provider to enable the copilot.',
    }
  }

  const llm = createLlmRouter({
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

  const context = await buildTenantContext(db, tenantId)
  const recentTurns = history.slice(-6).map(h => `${h.role}: ${h.content}`).join('\n')
  const prompt = [
    `Real data for this tenant:\n${context}`,
    recentTurns ? `\nRecent conversation:\n${recentTurns}` : '',
    `\nUser's question: ${message}`,
  ].filter(Boolean).join('\n')

  try {
    const text = await llm(SYSTEM_PROMPT, prompt, tenantCfg.model)
    return { ok: true, text }
  } catch (err) {
    return { ok: false, text: `I couldn't reach the configured AI provider (${err instanceof Error ? err.message : String(err)}). Check the connection in Settings → AI Provider.` }
  }
}

export async function registerCopilotRoutes(
  app: FastifyInstance,
  db: Db,
  corsOrigin: string | boolean = true,
): Promise<void> {
  // @fastify/cors injects Access-Control-Allow-Origin via Fastify's onSend
  // hook, which only fires for responses sent through reply.send() — SSE
  // streaming writes straight to reply.raw and never triggers it, so the
  // browser silently rejects the (perfectly valid) response for missing
  // CORS headers. Set it manually, honouring the same origin policy passed
  // to the global cors plugin registration.
  const setCorsHeader = (requestOrigin: string | undefined, raw: { setHeader: (name: string, value: string) => void }) => {
    if (corsOrigin === false) return
    const allowed = corsOrigin === true ? (requestOrigin ?? '*') : corsOrigin
    raw.setHeader('Access-Control-Allow-Origin', allowed)
    raw.setHeader('Vary', 'Origin')
  }

  app.post('/api/copilot/business', async (request, reply) => {
    const tenantId = request.authContext.tenant_id
    try {
      const body = request.body as { message: string; context?: BusinessContext }
      if (!body?.message) {
        return reply.status(400).send({ error: 'Message is required' })
      }

      const result = await callCopilotLlm(db, tenantId, body.message, body.context?.conversation_history ?? [])
      const response: CopilotResponse = { response: result.text, type: 'text' }
      return reply.send(response)
    } catch (error) {
      request.log.error(error)
      return reply.status(500).send({
        response: "I'm experiencing technical difficulties. Please try again.",
        type: 'text',
      })
    }
  })

  // Stream endpoint — the underlying LLM call isn't token-streamed (llm.ts
  // returns a complete string per provider), so this gets the full real
  // response first, then chunks it out over SSE to preserve the existing
  // "typing" UX the frontend already expects.
  app.post('/api/copilot/business/stream', async (request, reply) => {
    const tenantId = request.authContext.tenant_id
    try {
      const body = request.body as { message: string; context?: BusinessContext }

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      setCorsHeader(request.headers.origin, reply.raw)

      const result = await callCopilotLlm(db, tenantId, body?.message ?? '', body?.context?.conversation_history ?? [])

      const chunks = result.text.split(' ')
      for (const chunk of chunks) {
        reply.raw.write(`data: ${JSON.stringify({ chunk: chunk + ' ' })}\n\n`)
      }

      reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`)
      reply.raw.end()
    } catch (err) {
      request.log.error({ err, tenantId }, 'Copilot stream failed')
      reply.raw.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`)
      reply.raw.end()
    }
  })

  // Parse natural language goal description into a structured goal via the LLM.
  app.post('/api/copilot/parse-goal', async (request, reply) => {
    const tenantId = request.authContext.tenant_id
    try {
      const body = request.body as { description: string }
      if (!body?.description) {
        return reply.status(400).send({ error: 'Goal description is required' })
      }

      const tenantCfg = await getTenantLlmConfig(db, tenantId)
      if (!tenantCfg) {
        return reply.status(400).send({ error: 'No AI provider configured. Add one in Settings → AI Provider.' })
      }

      const llm = createLlmRouter({
        provider: tenantCfg.provider as LlmProvider,
        defaultModel: tenantCfg.model,
        temperature: 0.2,
        maxTokens: tenantCfg.maxTokens,
        ...(tenantCfg.apiKey !== undefined ? { apiKey: tenantCfg.apiKey } : {}),
        ...(tenantCfg.azureEndpoint !== undefined ? { azureEndpoint: tenantCfg.azureEndpoint } : {}),
        ...(tenantCfg.azureDeployment !== undefined ? { azureDeployment: tenantCfg.azureDeployment } : {}),
        ...(tenantCfg.azureApiVersion !== undefined ? { azureApiVersion: tenantCfg.azureApiVersion } : {}),
        ...(tenantCfg.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: tenantCfg.ollamaBaseUrl } : {}),
      })

      const system = `You convert a plain-English business goal into structured JSON. Respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly this shape:
{"name": string, "target_metric": string (snake_case), "target_value": string, "timeline_days": number, "unit": string, "suggested_kpis": [{"metric": string, "label": string, "target": string, "unit": string}], "suggested_workflows": [string]}`

      const raw = await llm(system, body.description, tenantCfg.model)
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''))
      } catch {
        return reply.status(502).send({ error: 'AI provider returned an unparseable response. Try rephrasing the goal.' })
      }

      const goal = {
        name: String(parsed['name'] ?? 'Untitled goal'),
        description: body.description,
        target_metric: String(parsed['target_metric'] ?? 'value'),
        target_value: String(parsed['target_value'] ?? ''),
        timeline_days: Number(parsed['timeline_days'] ?? 90),
        suggested_kpis: Array.isArray(parsed['suggested_kpis']) ? parsed['suggested_kpis'] : [],
        suggested_workflows: Array.isArray(parsed['suggested_workflows']) ? parsed['suggested_workflows'] : [],
        confidence: 0.85,
      }

      return reply.send({ goal })
    } catch (error) {
      request.log.error(error)
      return reply.status(500).send({ error: 'Failed to parse goal' })
    }
  })
}
