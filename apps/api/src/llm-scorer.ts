/**
 * LLM Scorer — enriches insight confidence with LLM evaluation.
 *
 * Implements the engine's `LlmScorer` interface. Per-tenant opt-in:
 * checks `tenant_settings` for `llm_scoring_enabled=true` before
 * calling the LLM. Tenants without the setting (or with it disabled)
 * get no LLM enrichment — their insights keep the rule-only score.
 *
 * This closes D1b from AI_DIFFERENTIATION_GAPS.md: the ML calibration
 * path was real code but permanently unreachable because
 * `engine.options.llmScorer` was never assigned. This scorer is
 * wired at startup, opening the gate. The scorer itself decides
 * per-tenant whether to actually call the LLM, so the cost/latency
 * is opt-in per tenant.
 *
 * Optimisations (P0 cost reduction):
 *   1. callStructured with Zod schema — eliminates regex JSON parsing,
 *      gets free retries on malformed output.
 *   2. LlmResponseCache — caches scores by evidence hash so the same
 *      detector firing on similar evidence returns a cached score
 *      without hitting the LLM.
 *   3. LlmBudgetGuard — enforces per-tenant monthly LLM budget. The
 *      scorer refuses to call the LLM if the tenant's budget is
 *      exhausted, falling back to the rule-only score.
 *   4. Disagreement detector — only return the LLM score when it
 *      differs from the rule confidence by more than a threshold
 *      (default 0.15). When the LLM agrees with the rule, the rule
 *      was right and the LLM call added no value.
 *   5. Concurrency — scores insights in parallel (up to 5 at a time)
 *      instead of sequentially.
 */

import type { Db } from 'mongodb'
import { z } from 'zod'
import {
  type LlmFn,
  callStructured,
  LlmBudgetGuard,
  type LlmResponseCache,
  type LlmCacheConfig,
} from '@lifekeel/platform'
import type { Insight, EvaluationContext, ReasoningContext } from '@lifekeel/engine'

const SCORING_SYSTEM_PROMPT = `You are a financial signal evaluator. Score the given insight's confidence (0.0 to 1.0) based on:
- How well the evidence supports the conclusion
- Whether the reasoning is sound and specific
- Whether there are obvious confounders or alternative explanations

Respond with a JSON object matching the requested schema.`

const ScorerOutputSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string().max(200),
})

export interface ApiLlmScorerOptions {
  /** Optional response cache. When set, scores are cached by evidence hash. */
  cache?: LlmResponseCache
  /** Optional per-tenant cache config (read from tenant_settings). */
  cacheConfig?: LlmCacheConfig
  /** Optional budget guard. When set, refuses to call LLM if budget exhausted. */
  budgetGuard?: LlmBudgetGuard
  /**
   * Only return the LLM score when |llmScore - ruleConfidence| exceeds this
   * threshold. When the LLM agrees with the rule, the rule was right and the
   * LLM call added no value — skip the overwrite. Default: 0.15.
   * Set to 0 to always apply the LLM score (original behaviour).
   */
  disagreementThreshold?: number
  /** Max concurrent LLM calls. Default: 5. */
  concurrency?: number
}

export class ApiLlmScorer {
  private settingCache = new Map<string, { enabled: boolean; skipThreshold: number; disagreementThreshold: number; ts: number }>()
  private readonly cacheTtlMs = 60_000 // 1 minute

  constructor(
    private readonly db: Db,
    private readonly llmFn: LlmFn,
    private readonly opts: ApiLlmScorerOptions = {},
  ) {}

  async isLlmScoringEnabled(tenantId: string): Promise<boolean> {
    const settings = await this.getSettings(tenantId)
    return settings.enabled
  }

  private async getSettings(tenantId: string): Promise<{ enabled: boolean; skipThreshold: number; disagreementThreshold: number }> {
    const cached = this.settingCache.get(tenantId)
    if (cached && Date.now() - cached.ts < this.cacheTtlMs) {
      return { enabled: cached.enabled, skipThreshold: cached.skipThreshold, disagreementThreshold: cached.disagreementThreshold }
    }
    try {
      const doc = await this.db.collection('tenant_settings').findOne({
        tenant_id: tenantId,
        key: 'llm_scoring_config',
      })
      const cfg = doc?.['value'] as { enabled?: boolean; skip_threshold?: number; disagreement_threshold?: number } | undefined
      const enabled = cfg?.enabled ?? false
      const skipThreshold = cfg?.skip_threshold ?? 0.90
      const disagreementThreshold = cfg?.disagreement_threshold ?? this.opts.disagreementThreshold ?? 0.15
      this.settingCache.set(tenantId, { enabled, skipThreshold, disagreementThreshold, ts: Date.now() })
      return { enabled, skipThreshold, disagreementThreshold }
    } catch {
      return { enabled: false, skipThreshold: 0.90, disagreementThreshold: this.opts.disagreementThreshold ?? 0.15 }
    }
  }

  async score(
    insights: Insight[],
    context: EvaluationContext,
    reasoningContexts?: ReadonlyMap<string, ReasoningContext>,
  ): Promise<Map<string, number>> {
    const scores = new Map<string, number>()
    if (insights.length === 0) return scores

    // Per-tenant opt-in check
    const { enabled, skipThreshold, disagreementThreshold } = await this.getSettings(context.tenant_id)
    if (!enabled) return scores

    // Budget guard — refuse to call LLM if tenant's budget is exhausted
    if (this.opts.budgetGuard) {
      try {
        const decision = await this.opts.budgetGuard.check(context.tenant_id)
        if (!decision.allowed) return scores // fall back to rule-only scores
      } catch {
        // budget guard failure = don't block scoring
      }
    }

    // Skip insights where the rule confidence is already high enough that
    // LLM enrichment adds <2% delta. The engine also gates at maxOrScoreToEnrich
    // (0.90), but the per-tenant skip_threshold can be lower.
    const toScore = insights.filter(i => i.confidence_breakdown.or_score < skipThreshold)
    if (toScore.length === 0) return scores

    // Score in parallel with a concurrency limit
    const concurrency = this.opts.concurrency ?? 5
    const results = await this.mapWithConcurrency(toScore, concurrency, async (insight) => {
      try {
        const llmScore = await this.scoreOne(insight, context.tenant_id, reasoningContexts?.get(insight.id))
        if (llmScore === undefined) return null

        // Disagreement detector: only return the LLM score if it differs
        // from the rule confidence by more than the threshold. When the LLM
        // agrees with the rule, the rule was right — skip the overwrite.
        const ruleConfidence = insight.confidence_breakdown.or_score
        if (disagreementThreshold > 0 && Math.abs(llmScore - ruleConfidence) <= disagreementThreshold) {
          return null // agreement — don't overwrite the rule score
        }
        return { id: insight.id, score: llmScore }
      } catch {
        return null // per-insight failure = skip, don't fail the batch
      }
    })

    for (const r of results) {
      if (r) scores.set(r.id, r.score)
    }
    return scores
  }

  private async scoreOne(
    insight: Insight,
    tenantId: string,
    reasoningContext?: ReasoningContext,
  ): Promise<number | undefined> {
    const prompt = this.buildPrompt(insight, reasoningContext)

    // Wrap with cache if configured
    const llm = this.opts.cache
      ? this.opts.cache.getOrCompute(
          tenantId,
          'scorer',
          this.cacheKey(insight),
          () => this.callLlmStructured(prompt),
          this.opts.cacheConfig,
        ).then(r => r.value)
      : this.callLlmStructured(prompt)

    const { data } = await llm
    return data.score
  }

  private async callLlmStructured(prompt: string): Promise<{ data: { score: number; reasoning: string } }> {
    const result = await callStructured(this.llmFn, {
      schema: ScorerOutputSchema,
      system: SCORING_SYSTEM_PROMPT,
      prompt,
      outputDescription: 'a confidence score between 0.0 and 1.0 with a one-sentence reasoning',
      maxRetries: 2,
    })
    return { data: result.data }
  }

  /** Cache key derived from detector + rule + evidence — same detector on similar evidence = same score. */
  private cacheKey(insight: Insight): unknown {
    const evidence = insight.evidence_trail?.source_events
      ?.map(e => `${e.event_type}:${e.excerpt?.slice(0, 100)}`)
      .join('|') ?? ''
    return {
      detector_id: insight.detector_id,
      rule_id: insight.rule_id,
      hypothesis: insight.hypothesis?.slice(0, 200),
      evidence,
    }
  }

  private buildPrompt(insight: Insight, reasoningContext?: ReasoningContext): string {
    const evidence = insight.evidence_trail?.source_events
      ?.map(e => `${e.event_type}: ${e.excerpt}`)
      .join('\n') ?? ''
    const retrievedEvidence = [
      ...(reasoningContext?.episodic_snippets ?? []),
      ...(reasoningContext?.semantic_snippets ?? []),
      ...(reasoningContext?.goal_snippets ?? []),
    ].join('\n')
    const reasoning = insight.reasoning ?? ''
    return `Insight: ${insight.hypothesis}
Category: ${insight.category}
Confidence (rules engine): ${insight.confidence_breakdown.or_score}

Reasoning: ${reasoning}

Triggering evidence:
${evidence}

Retrieved supporting context:
${retrievedEvidence || 'None'}

Score this insight's confidence (0.0 to 1.0):`
  }

  /** Map with bounded concurrency — no external dependency needed. */
  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const i = nextIndex++
        if (i >= items.length) break
        results[i] = await fn(items[i]!, i)
      }
    })
    await Promise.all(workers)
    return results
  }
}
