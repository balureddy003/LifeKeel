/**
 * Token Cost Ledger — per-tenant, per-workflow LLM cost tracking.
 *
 * Every LLM call records input/output token counts, computes cost in integer
 * minor units (USD cents × 100 = "micro-dollars"), and writes to MongoDB.
 *
 * This is the #1 missing feature for enterprise B2B: without cost attribution,
 * tenants cannot budget their AI usage and LifeKeel cannot offer usage-based pricing.
 *
 * Pricing table: static defaults, overridable via LIFEKEEL_LLM_PRICING_JSON env var.
 * Prices are per 1,000 tokens, in micro-dollars (USD cents × 100).
 *
 * Usage:
 *   const ledger = new CostLedger(db)
 *   await ledger.record({ tenant_id, workflow_id, model, ... })
 *   const summary = await ledger.getSummary(tenantId, 30)
 */

import type { Collection, Db } from 'mongodb'

// ── Pricing ────────────────────────────────────────────────────────────────────

/**
 * Pricing in micro-dollars (USD cents × 100) per 1,000 tokens.
 * 1 micro-dollar = $0.000001 USD.
 * e.g. claude-haiku-4-5 input: 25 = $0.00025 / 1K tokens = $0.25 / 1M tokens.
 */
export interface ModelPricing {
  input_per_1k: number // micro-dollars per 1K input tokens
  output_per_1k: number // micro-dollars per 1K output tokens
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-haiku-4-5': { input_per_1k: 25, output_per_1k: 125 },
  'claude-3-5-haiku-20241022': { input_per_1k: 80, output_per_1k: 400 },
  'claude-3-5-sonnet-20241022': { input_per_1k: 300, output_per_1k: 1500 },
  'claude-opus-4': { input_per_1k: 1500, output_per_1k: 7500 },
  // OpenAI
  'gpt-4o-mini': { input_per_1k: 15, output_per_1k: 60 },
  'gpt-4o': { input_per_1k: 250, output_per_1k: 1000 },
  'o3-mini': { input_per_1k: 110, output_per_1k: 440 },
  o3: { input_per_1k: 1000, output_per_1k: 4000 },
  // Groq (significantly cheaper — open models via inference API)
  'llama-3.1-8b-instant': { input_per_1k: 5, output_per_1k: 8 },
  'llama-3.1-70b-versatile': { input_per_1k: 59, output_per_1k: 79 },
  // xAI Grok — grok-4.3 $1.25/$2.50 and grok-4.7 $2/$6 per 1M (short-context
  // global rates; the US regional endpoint adds ~10%).
  'grok-4.3': { input_per_1k: 125, output_per_1k: 250 },
  'grok-4.7': { input_per_1k: 200, output_per_1k: 600 },
  // Vertex AI Gemini — global-endpoint list prices ($/1M: flash-lite
  // $0.30/$2.50, flash $1.50/$9.00, argon $2/$10 intro until 2026-12-01 then
  // $4/$20). Regional endpoints run ~10% higher; Flex/batch ~50% lower.
  // Reasoning tokens count as output. Override via LIFEKEEL_LLM_PRICING_JSON
  // as prices shift.
  'gemini-3.5-flash-lite': { input_per_1k: 30, output_per_1k: 250 },
  'gemini-3.5-flash': { input_per_1k: 150, output_per_1k: 900 },
  'gemini-4-argon': { input_per_1k: 200, output_per_1k: 1000 },
  // Ollama — local, zero cost
  'llama3.2:3b': { input_per_1k: 0, output_per_1k: 0 },
  'qwen2.5:7b': { input_per_1k: 0, output_per_1k: 0 },
  'qwen2.5:14b': { input_per_1k: 0, output_per_1k: 0 },
  'qwen2.5:1.5b': { input_per_1k: 0, output_per_1k: 0 },
  'qwen2.5:3b': { input_per_1k: 0, output_per_1k: 0 },
}

function loadPricingTable(): Record<string, ModelPricing> {
  try {
    const override = process.env['LIFEKEEL_LLM_PRICING_JSON']
    if (override)
      return { ...DEFAULT_PRICING, ...JSON.parse(override) } as Record<string, ModelPricing>
  } catch {
    /* ignore malformed override */
  }
  return DEFAULT_PRICING
}

const PRICING = loadPricingTable()

/** Compute cost in micro-dollars for a given model and token counts. */
export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  // Fuzzy match: strip date suffixes (gpt-4o-2024-11-20 → gpt-4o)
  const pricing =
    PRICING[model] ?? PRICING[model.replace(/-\d{8}$/, '')] ?? PRICING['claude-haiku-4-5']!
  return Math.round(
    (inputTokens / 1000) * pricing.input_per_1k + (outputTokens / 1000) * pricing.output_per_1k,
  )
}

// ── Record type ────────────────────────────────────────────────────────────────

export interface LlmUsageRecord {
  _id?: unknown
  tenant_id: string
  workflow_id?: string
  workflow_run_id?: string
  node_id?: string
  skill_id?: string
  model: string
  provider: string
  input_tokens: number
  output_tokens: number
  /** Cost in micro-dollars (USD cents × 100). Integer. */
  cost_microdollars: number
  latency_ms: number
  created_at: Date
}

// ── Summary types ──────────────────────────────────────────────────────────────

export interface CostSummary {
  /** Total cost in micro-dollars over the window. */
  total_cost_microdollars: number
  /** Total cost formatted as "$0.0123" */
  total_cost_display: string
  total_input_tokens: number
  total_output_tokens: number
  total_calls: number
  by_workflow: Record<string, number> // workflow_id → cost_microdollars
  by_model: Record<string, number> // model → cost_microdollars
  by_day: Array<{ date: string; cost_microdollars: number; calls: number }>
  most_expensive_run?: { workflow_run_id: string; cost_microdollars: number }
}

// ── CostLedger ─────────────────────────────────────────────────────────────────

export class CostLedger {
  private col: Collection<LlmUsageRecord>

  constructor(db: Db) {
    this.col = db.collection<LlmUsageRecord>('llm_usage')
    // Ensure indexes on first use (non-blocking)
    this.ensureIndexes().catch(() => {})
  }

  private async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ tenant_id: 1, created_at: -1 })
    await this.col.createIndex({ tenant_id: 1, workflow_run_id: 1 })
    // TTL: auto-delete records older than 365 days
    await this.col.createIndex({ created_at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 })
  }

  async record(record: Omit<LlmUsageRecord, '_id' | 'created_at'>): Promise<void> {
    await (this.col as any).insertOne({
      ...record,
      created_at: new Date(),
    })
  }

  /** Aggregate cost summary for a tenant over the last `days` days. */
  async getSummary(tenantId: string, days = 30): Promise<CostSummary> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)

    const records = await this.col
      .find({ tenant_id: tenantId, created_at: { $gte: since } })
      .toArray()

    let totalCost = 0
    let totalInput = 0
    let totalOutput = 0
    const byWorkflow: Record<string, number> = {}
    const byModel: Record<string, number> = {}
    const byDayMap: Record<string, { cost: number; calls: number }> = {}
    const byRun: Record<string, number> = {}

    for (const r of records) {
      totalCost += r.cost_microdollars
      totalInput += r.input_tokens
      totalOutput += r.output_tokens

      if (r.workflow_id) {
        byWorkflow[r.workflow_id] = (byWorkflow[r.workflow_id] ?? 0) + r.cost_microdollars
      }
      byModel[r.model] = (byModel[r.model] ?? 0) + r.cost_microdollars

      const day = r.created_at.toISOString().slice(0, 10)
      if (!byDayMap[day]) byDayMap[day] = { cost: 0, calls: 0 }
      byDayMap[day]!.cost += r.cost_microdollars
      byDayMap[day]!.calls++

      if (r.workflow_run_id) {
        byRun[r.workflow_run_id] = (byRun[r.workflow_run_id] ?? 0) + r.cost_microdollars
      }
    }

    // Most expensive run
    let mostExpensiveRun: CostSummary['most_expensive_run']
    let maxRunCost = 0
    for (const [runId, cost] of Object.entries(byRun)) {
      if (cost > maxRunCost) {
        maxRunCost = cost
        mostExpensiveRun = { workflow_run_id: runId, cost_microdollars: cost }
      }
    }

    // Sort by-day ascending
    const byDay = Object.entries(byDayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { cost, calls }]) => ({ date, cost_microdollars: cost, calls }))

    return {
      total_cost_microdollars: totalCost,
      total_cost_display: formatMicroDollars(totalCost),
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      total_calls: records.length,
      by_workflow: byWorkflow,
      by_model: byModel,
      by_day: byDay,
      ...(mostExpensiveRun ? { most_expensive_run: mostExpensiveRun } : {}),
    }
  }

  /** Per-workflow cost breakdown — useful for the Studio Workflows page. */
  async getWorkflowCost(
    tenantId: string,
    workflowId: string,
    days = 30,
  ): Promise<{
    cost_microdollars: number
    cost_display: string
    total_calls: number
    avg_cost_per_run: number
  }> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000)
    const records = await this.col
      .find({ tenant_id: tenantId, workflow_id: workflowId, created_at: { $gte: since } })
      .toArray()

    const cost = records.reduce((s, r) => s + r.cost_microdollars, 0)
    const runs = new Set(records.map((r) => r.workflow_run_id).filter(Boolean)).size

    return {
      cost_microdollars: cost,
      cost_display: formatMicroDollars(cost),
      total_calls: records.length,
      avg_cost_per_run: runs > 0 ? Math.round(cost / runs) : 0,
    }
  }
}

/** Format micro-dollars as human-readable USD string. */
export function formatMicroDollars(microdollars: number): string {
  const dollars = microdollars / 1_000_000
  if (dollars < 0.01) return `$${(dollars * 100).toFixed(3)}¢`
  return `$${dollars.toFixed(4)}`
}
