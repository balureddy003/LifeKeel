/**
 * Skill Orchestrator — Plan → Execute (parallel) → Finalize
 *
 * Three-phase pipeline:
 *   PLAN:     Select relevant skills from the registry (Anthropic SDK or rule fallback)
 *   EXECUTE:  Run selected skills in parallel (Promise.all / LangGraph Send fan-out)
 *   FINALIZE: Deduplicate by skill_id (keep highest confidence), sort, cap
 *
 * LangGraph integration is optional — the same external API works with or without it.
 */

import crypto from 'node:crypto'
import type { Insight } from '@kairos/engine'
import { ApprovalGate } from './approval-gate.js'
import type { SkillManifest, SkillDecision, SkillContext, SkillGraphState } from './schemas.js'

export type SkillFn = (context: SkillContext) => Promise<SkillDecision>

export interface OrchestratorOptions {
  skills: Map<string, SkillFn>
  manifests: SkillManifest[]
  approvalGate?: ApprovalGate
  maxSkills?: number
  anthropicApiKey?: string
}

export interface RunOptions {
  tenant_id: string   // from JWT — orchestrator stamps all decisions with this
  trigger_type: string
  insights: Insight[]
  domain_data?: Record<string, unknown>
}

export class SkillOrchestrator {
  private approvalGate: ApprovalGate

  constructor(private readonly options: OrchestratorOptions) {
    this.approvalGate = options.approvalGate ?? new ApprovalGate()
  }

  /**
   * Run the full Plan → Execute → Finalize pipeline.
   * Returns final decisions (approved or queued for approval).
   */
  async run(options: RunOptions): Promise<{ decisions: SkillDecision[]; pending: string[] }> {
    const { tenant_id, trigger_type, insights, domain_data = {} } = options

    // ── PLAN ──────────────────────────────────────────────────────────────────
    const selectedIds = await this.plan(trigger_type, insights)
    if (selectedIds.length === 0) {
      return { decisions: [], pending: [] }
    }

    // ── EXECUTE (parallel) ────────────────────────────────────────────────────
    const rawDecisions = await this.executeParallel(selectedIds, {
      tenant_id,
      trigger_type,
      insights,
      domain_data,
      token_budget: this.defaultTokenBudget(),
    })

    // ── FINALIZE ──────────────────────────────────────────────────────────────
    const finalDecisions = this.finalize(rawDecisions, tenant_id)

    // ── APPROVAL GATE ─────────────────────────────────────────────────────────
    const autoExecute: SkillDecision[] = []
    const pendingTraceIds: string[] = []

    for (const decision of finalDecisions) {
      if (decision.requires_approval) {
        await this.approvalGate.queue(decision)
        pendingTraceIds.push(decision.trace_id)
      } else {
        autoExecute.push(decision)
      }
    }

    return { decisions: autoExecute, pending: pendingTraceIds }
  }

  // ─── Plan Phase ───────────────────────────────────────────────────────────

  private async plan(triggerType: string, insights: Insight[]): Promise<string[]> {
    const maxSkills = this.options.maxSkills ?? 5

    // Rule-based planner (deterministic fallback — works without LLM)
    const matched = this.options.manifests
      .filter((m) =>
        m.triggers.some(
          (t) =>
            t.type === triggerType ||
            t.type === 'on_demand' ||
            (t.type === 'insight' && insights.length > 0),
        ),
      )
      .slice(0, maxSkills)
      .map((m) => m.id)

    // LLM planner (optional enrichment — same fallback API)
    if (this.options.anthropicApiKey && matched.length > 1) {
      try {
        return await this.llmPlan(matched, triggerType, insights, maxSkills)
      } catch {
        // LLM planner failure = graceful degradation to rule-based
      }
    }

    return matched
  }

  private async llmPlan(
    candidateIds: string[],
    triggerType: string,
    insights: Insight[],
    maxSkills: number,
  ): Promise<string[]> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: this.options.anthropicApiKey })

    const manifestSummary = candidateIds
      .map((id) => {
        const m = this.options.manifests.find((m) => m.id === id)
        return m ? `${id}: ${m.description}` : id
      })
      .join('\n')

    const insightSummary = insights
      .slice(0, 3)
      .map((i) => `${i.hypothesis} (${i.category}, confidence ${i.confidence_breakdown.or_score})`)
      .join(', ')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: `Select the most relevant skill IDs (max ${maxSkills}) for trigger="${triggerType}" with insights: ${insightSummary}.
Available skills:\n${manifestSummary}
Return only a JSON array of skill IDs, e.g. ["skill_a", "skill_b"]`,
        },
      ],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '[]'
    const parsed = JSON.parse(text) as string[]
    return parsed.filter((id) => candidateIds.includes(id)).slice(0, maxSkills)
  }

  // ─── Execute Phase ────────────────────────────────────────────────────────

  private async executeParallel(
    skillIds: string[],
    context: SkillContext,
  ): Promise<SkillDecision[]> {
    const results = await Promise.allSettled(
      skillIds.map(async (id) => {
        const skillFn = this.options.skills.get(id)
        if (!skillFn) return null

        const decision = await skillFn(context)

        // Orchestrator stamps idempotency_key — skills cannot forge it
        const triggerHash = crypto
          .createHash('sha256')
          .update(`${context.trigger_type}:${context.insights.map((i) => i.id).join(',')}`)
          .digest('hex')

        return {
          ...decision,
          tenant_id: context.tenant_id, // orchestrator enforces tenant
          idempotency_key: crypto
            .createHash('sha256')
            .update(`${context.tenant_id}:${id}:${triggerHash}`)
            .digest('hex'),
        } satisfies SkillDecision
      }),
    )

    return results
      .filter((r): r is PromiseFulfilledResult<SkillDecision | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((d): d is SkillDecision => d !== null)
  }

  // ─── Finalize Phase ───────────────────────────────────────────────────────

  private finalize(decisions: SkillDecision[], tenantId: string): SkillDecision[] {
    // Deduplicate: keep highest confidence per skill_id
    const bySkillId = new Map<string, SkillDecision>()
    for (const d of decisions) {
      const existing = bySkillId.get(d.skill_id)
      if (!existing || d.confidence_score > existing.confidence_score) {
        bySkillId.set(d.skill_id, {
          ...d,
          tenant_id: tenantId, // final enforcement
        })
      }
    }

    // Sort by confidence DESC
    return [...bySkillId.values()].sort((a, b) => b.confidence_score - a.confidence_score)
  }

  private defaultTokenBudget() {
    return {
      max_input_tokens: 8000,
      max_output_tokens: 2000,
      used_input: 0,
      used_output: 0,
      remaining_input: 8000,
      remaining_output: 2000,
    }
  }
}
