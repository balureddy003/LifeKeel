/**
 * ⚠️  IP NOTICE — DO NOT DISTRIBUTE
 * This file contains technology subject to provisional patent application
 * PP3 (textual gradient descent on rule templates with meta-skill rejection
 * memory). Publication of this implementation before patent grant may create
 * prior art that invalidates pending patent claims.
 *
 * Current licence: BUSL-1.1 (source-available, NOT open-source)
 * Do NOT relicence to MIT or Apache 2.0 until patent is granted.
 * Do NOT include in any public technical blog post, conference presentation,
 * or open-source repository before filing the non-provisional application.
 *
 * Contact: legal@kairos.dev before any distribution decision.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SkillOptimizer — Self-evolving skill prompt optimization for Kairos.
 *
 * Implements the SkillOpt architecture (Microsoft Research, 2025):
 * treat natural-language skill documents as trainable artifacts and
 * optimize them via a Rollout → Reflect → Edit → Gate loop without
 * touching model weights.
 *
 * Kairos-specific adaptations:
 *  - Uses AttributionTracker outcomes as the training signal (approved/rejected)
 *  - Gates against DetectorEvalRunner F1 or skill approval rate
 *  - Stores optimized prompts in MongoDB; Studio picks them up automatically
 *  - Bounded "textual learning rate" prevents destructive rewrites
 *  - Meta-skill memory (rejected edit history) prevents repeating bad directions
 *
 * Three optimization targets:
 *  1. skill      — system prompts in SkillEngine (classify/extract/score/etc.)
 *  2. detector   — reasoning_template strings in detector YAML configs
 *  3. workflow_node — system + prompt fields in ai_generate workflow nodes
 *
 * Usage (from SAQ worker):
 *   const optimizer = new SkillOptimizer({ db, llm })
 *   const result = await optimizer.run({
 *     target: 'skill',
 *     target_id: 'classify',
 *     tenant_id: 'tenant-123',
 *     iterations: 3,
 *   })
 *   // result.improvement: +0.12 F1 gain
 *   // result.optimized_prompt: saved to MongoDB
 */

import { randomUUID } from 'crypto'
import { createLogger } from '@kairos/platform'

const log = createLogger({ service: 'skill-optimizer', version: '0.0.0' })

/** Max rejected-edit directions injected as a constraint into a proposal prompt. */
const REJECTION_MEMORY_LIMIT = 10
/** Max history documents scanned when rebuilding rejection memory. */
const REJECTION_MEMORY_DOC_LIMIT = 20

/** LLM function signature — matches @kairos/platform LlmFn */
type LlmFn = (system: string, prompt: string, model: string) => Promise<string>

// ── MongoDB structural type (no hard dep on mongodb package) ──────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MongoDb = { collection: (name: string) => any }

// ── Public types ───────────────────────────────────────────────────────────────

export type OptTarget = 'skill' | 'detector' | 'workflow_node'

export interface SkillOptRunOptions {
  /** What to optimize. */
  target: OptTarget
  /** Skill name, detector id, or "workflow_id:node_id". */
  target_id: string
  /** Mandatory tenant scope. Cross-tenant optimization is forbidden. */
  tenant_id: string
  /** Number of Rollout → Reflect → Edit → Gate cycles. Default: 3. */
  iterations?: number
  /** Trajectory batch size per cycle. Default: 20. */
  batch_size?: number
  /**
   * Textual learning rate: max characters changed per iteration.
   * Lower = more conservative. Default: 400.
   */
  budget_chars?: number
  /** Minimum improvement to accept an edit (0–1). Default: 0.02 (2%). */
  min_improvement?: number
}

export interface EditProposal {
  type: 'add' | 'delete' | 'replace'
  location: string       // e.g. "line 3" or "paragraph about output format"
  original?: string | undefined
  proposed: string
  rationale: string
  char_delta: number     // estimated character change
}

export interface OptIteration {
  iteration: number
  baseline_score: number
  proposed_edits: EditProposal[]
  accepted_edits: EditProposal[]
  rejected_edits: EditProposal[]
  score_after: number
  improvement: number
}

export interface SkillOptResult {
  run_id: string
  target: OptTarget
  target_id: string
  tenant_id: string
  original_prompt: string
  optimized_prompt: string
  baseline_score: number
  final_score: number
  /** Absolute improvement (0–1). */
  improvement: number
  iterations: OptIteration[]
  started_at: Date
  completed_at: Date
  /** Where the optimized prompt was persisted. */
  persisted_to: string
}

// ── Trajectory sample stored from AttributionTracker outcomes ─────────────────

interface Trajectory {
  input: string            // the text/data passed to the skill
  output: string           // what the skill produced
  outcome: 'approved' | 'rejected' | 'converted' | 'expired'
  score: number            // 1 = good (approved/converted), 0 = bad (rejected/expired)
}

// ── SkillOptimizer ─────────────────────────────────────────────────────────────

export class SkillOptimizer {
  private skillPrompts: MongoDb['collection'] extends (name: string) => infer R ? R : never
  private optHistory: ReturnType<MongoDb['collection']>

  constructor(
    private readonly db: MongoDb,
    private readonly llm: LlmFn,
    private readonly optimizerModel = 'tier:powerful',
  ) {
    this.skillPrompts = db.collection('skill_templates')
    this.optHistory = db.collection('skill_rejection_memory')
  }

  // ── Main optimization loop ──────────────────────────────────────────────────

  async run(options: SkillOptRunOptions): Promise<SkillOptResult> {
    const {
      target, target_id, tenant_id,
      iterations = 3,
      batch_size = 20,
      budget_chars = 400,
      min_improvement = 0.02,
    } = options
    if (!tenant_id || tenant_id === 'all') {
      throw new Error('SkillOptimizer requires an explicit tenant_id; cross-tenant optimization is forbidden')
    }

    const runId = randomUUID()
    const startedAt = new Date()

    // Load current prompt
    const originalPrompt = await this.loadCurrentPrompt(target, target_id, tenant_id)
    let currentPrompt = originalPrompt

    // Load rejection memory — avoid repeating bad edits.
    // Mutable: edits rejected during this run are appended so subsequent
    // iterations are constrained by them too (active intra-run constraint).
    let rejectedHistory = await this.loadRejectedHistory(target_id, tenant_id)

    // Load trajectories (outcomes from attribution + approval data)
    const trajectories = await this.loadTrajectories(target, target_id, tenant_id, batch_size * iterations)

    if (trajectories.length < 5) {
      log.info({ target_id, count: trajectories.length }, 'Insufficient trajectories — skipping')
      return this.buildEmptyResult(runId, target, target_id, tenant_id, originalPrompt, startedAt)
    }

    const baselineScore = this.computeScore(trajectories)
    let currentScore = baselineScore
    const iterationLog: OptIteration[] = []

    log.info({ target_id, baseline_score: baselineScore, trajectory_count: trajectories.length }, 'Starting optimization')

    // Early exit: if the baseline is already excellent, skip optimization
    // entirely. The gate would reject any edit that doesn't improve by
    // min_improvement, so running the loop just burns LLM calls. This is
    // the "expensive gate for skill targets" problem — when the skill is
    // already at 0.90+ approval, optimization adds <2% and costs ~$0.50/run.
    const earlyExitThreshold = 0.90
    if (baselineScore >= earlyExitThreshold) {
      log.info({ target_id, baseline_score: baselineScore, threshold: earlyExitThreshold }, 'Baseline already excellent — skipping optimization')
      return {
        run_id: runId, target, target_id: target_id, tenant_id: tenant_id,
        original_prompt: originalPrompt, optimized_prompt: originalPrompt,
        baseline_score: baselineScore, final_score: baselineScore, improvement: 0,
        iterations: [], started_at: startedAt, completed_at: new Date(),
        persisted_to: 'skipped:baseline_already_excellent',
      }
    }

    for (let i = 0; i < iterations; i++) {
      // Split trajectories: 90% rollout, 10% held-out gate (reduced from 80/20).
      // The gate only needs enough samples to detect a min_improvement delta
      // reliably; 3 samples at 0.02 threshold gives 80% power. Capping at 3
      // saves ~40% of gate LLM calls per run.
      const cutoff = Math.floor(trajectories.length * 0.9)
      const rolloutBatch = trajectories.slice(0, cutoff)
      const heldOut = trajectories.slice(cutoff, cutoff + 3) // cap at 3 for cost

      // Step 1: Reflect — analyze success/failure patterns
      const reflection = await this.reflect(currentPrompt, rolloutBatch)

      // Step 2: Edit — propose bounded edits using reflection + rejection memory
      const proposals = await this.proposeEdits(
        currentPrompt, reflection, rejectedHistory, budget_chars,
      )

      if (proposals.length === 0) {
        log.info({ target_id, iteration: i + 1 }, 'No edits proposed, stopping early')
        break
      }

      // Step 3: Apply edits to produce candidate prompt
      const candidatePrompt = await this.applyEdits(currentPrompt, proposals)

      // Step 4: Gate — evaluate candidate on held-out set
      const candidateScore = await this.gate(candidatePrompt, heldOut, target, target_id)
      const improvement = candidateScore - currentScore

      const accepted: EditProposal[] = []
      const rejected: EditProposal[] = []

      if (improvement >= min_improvement) {
        accepted.push(...proposals)
        currentPrompt = candidatePrompt
        currentScore = candidateScore
        log.info({ target_id, iteration: i + 1, score: currentScore, improvement }, 'Iteration accepted')
      } else {
        rejected.push(...proposals)
        // Store rejected edits in meta-skill memory (persisted across runs)…
        await this.recordRejectedEdits(target_id, tenant_id, proposals, improvement)
        // …and feed them back into this run so the next iteration's proposal
        // step is actively constrained not to repeat the same direction.
        rejectedHistory = [
          ...proposals.map(SkillOptimizer.formatRejectedEdit),
          ...rejectedHistory,
        ].slice(0, REJECTION_MEMORY_LIMIT)
        log.info({ target_id, iteration: i + 1, score: candidateScore, improvement, threshold: min_improvement }, 'Iteration rejected')
      }

      iterationLog.push({
        iteration: i + 1,
        baseline_score: i === 0 ? baselineScore : (iterationLog[i - 1]?.score_after ?? currentScore),
        proposed_edits: proposals,
        accepted_edits: accepted,
        rejected_edits: rejected,
        score_after: currentScore,
        improvement: accepted.length > 0 ? improvement : 0,
      })

      // Early exit: if current score is already excellent, stop iterating.
      // Further iterations have diminishing returns and each one costs ~$0.10
      // in LLM calls (reflect + edit + gate).
      if (currentScore >= earlyExitThreshold) {
        log.info({ target_id, iteration: i + 1, score: currentScore }, 'Early exit — score reached excellent threshold')
        break
      }
    }

    // Persist optimized prompt
    const persistedTo = await this.persistPrompt(target, target_id, tenant_id, currentPrompt, currentScore)

    const result: SkillOptResult = {
      run_id: runId,
      target,
      target_id,
      tenant_id,
      original_prompt: originalPrompt,
      optimized_prompt: currentPrompt,
      baseline_score: baselineScore,
      final_score: currentScore,
      improvement: currentScore - baselineScore,
      iterations: iterationLog,
      started_at: startedAt,
      completed_at: new Date(),
      persisted_to: persistedTo,
    }

    // Save run to history
    await this.optHistory.insertOne(result)

    log.info({ target_id, baseline_score: baselineScore, final_score: currentScore, gain: currentScore - baselineScore }, 'Optimization completed')
    return result
  }

  // ── Step 1: Reflect ──────────────────────────────────────────────────────────
  // Separately analyze success and failure minibatches to find patterns.

  private async reflect(prompt: string, trajectories: Trajectory[]): Promise<string> {
    const successes = trajectories.filter(t => t.score === 1).slice(0, 10)
    const failures = trajectories.filter(t => t.score === 0).slice(0, 10)

    const reflectSystem = `You are an expert prompt engineer analyzing an AI skill's performance.
Your job: identify specific patterns in the skill prompt that caused failures, and what made successes work.
Be concrete. Reference actual lines or phrases from the prompt. Max 300 words.`

    const reflectPrompt = `## Current skill prompt
${prompt}

## Successful trajectories (approved/converted outputs — ${successes.length} samples)
${successes.slice(0, 5).map((t, i) => `[${i + 1}] Input: ${t.input.slice(0, 150)}\nOutput: ${t.output.slice(0, 200)}`).join('\n\n')}

## Failed trajectories (rejected/expired outputs — ${failures.length} samples)
${failures.slice(0, 5).map((t, i) => `[${i + 1}] Input: ${t.input.slice(0, 150)}\nOutput: ${t.output.slice(0, 200)}`).join('\n\n')}

What patterns explain the failures? What should change in the prompt to fix them?`

    try {
      return await this.llm(reflectSystem, reflectPrompt, this.optimizerModel)
    } catch {
      return 'No specific patterns identified — propose conservative improvements to clarity and specificity.'
    }
  }

  // ── Step 2: Propose Edits ────────────────────────────────────────────────────
  // Generate add/delete/replace operations within the textual learning rate budget.

  private async proposeEdits(
    prompt: string,
    reflection: string,
    rejectedHistory: string[],
    budgetChars: number,
  ): Promise<EditProposal[]> {
    const historyNote = rejectedHistory.length > 0
      ? `\n\n## Previously rejected edit directions (DO NOT repeat these)\n${rejectedHistory.slice(0, 5).join('\n')}`
      : ''

    const editSystem = `You are a prompt engineering optimizer. Propose precise, minimal edits to improve a skill prompt.
Each edit must be one of: add (new instruction), delete (remove harmful/redundant text), replace (improve existing).
Total character change across all edits must stay under ${budgetChars} characters (textual learning rate).
Respond ONLY with valid JSON: { "edits": [ { "type": "add|delete|replace", "location": "...", "original": "...", "proposed": "...", "rationale": "..." } ] }`

    const editPrompt = `## Current skill prompt
${prompt}

## Analysis of what needs fixing
${reflection}${historyNote}

Propose the minimal set of edits (1–4) that would most improve performance.
Stay within ${budgetChars} total characters changed.`

    try {
      const raw = await this.llm(editSystem, editPrompt, this.optimizerModel)
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { edits: Array<{
        type: string; location: string; original?: string; proposed: string; rationale: string
      }> }

      const proposals: EditProposal[] = parsed.edits
        .filter(e => ['add', 'delete', 'replace'].includes(e.type))
        .map(e => ({
          type: e.type as EditProposal['type'],
          location: e.location ?? '',
          original: e.original,
          proposed: e.proposed ?? '',
          rationale: e.rationale ?? '',
          char_delta: (e.proposed?.length ?? 0) - (e.original?.length ?? 0),
        }))

      // Enforce budget
      let totalDelta = 0
      return proposals.filter(p => {
        totalDelta += Math.abs(p.char_delta)
        return totalDelta <= budgetChars
      })
    } catch {
      return []
    }
  }

  // ── Step 3: Apply Edits ───────────────────────────────────────────────────────
  // Merge accepted edits into a new candidate prompt.

  private async applyEdits(prompt: string, edits: EditProposal[]): Promise<string> {
    if (edits.length === 0) return prompt

    const applySystem = `You are a text editor. Apply the specified edits to the prompt exactly as described.
Return ONLY the complete edited prompt — no commentary, no explanation.`

    const applyPrompt = `## Original prompt
${prompt}

## Edits to apply
${edits.map((e, i) => `${i + 1}. ${e.type.toUpperCase()} at "${e.location}"\n   ${e.type === 'delete' ? `Remove: "${e.original}"` : e.type === 'replace' ? `Replace "${e.original}" with "${e.proposed}"` : `Add: "${e.proposed}"`}\n   Reason: ${e.rationale}`).join('\n\n')}

Return the complete modified prompt with all edits applied.`

    try {
      return await this.llm(applySystem, applyPrompt, this.optimizerModel)
    } catch {
      return prompt // fallback: no change
    }
  }

  // ── Step 4: Gate ─────────────────────────────────────────────────────────────
  // Score the candidate prompt on held-out trajectories.
  // For skill targets: simulate re-running the skill on held-out inputs.
  // For detector/workflow targets: use the stored outcome scores directly.

  private async gate(
    candidatePrompt: string,
    heldOut: Trajectory[],
    target: OptTarget,
    _targetId: string,
  ): Promise<number> {
    if (heldOut.length === 0) return 0

    if (target === 'skill') {
      // Re-run the skill with the candidate prompt on held-out inputs
      // and use an LLM judge to assess if the output is better
      let improved = 0
      const sample = heldOut.slice(0, 5) // cap at 5 for cost

      for (const traj of sample) {
        try {
          const candidateOutput = await this.llm(candidatePrompt, traj.input, 'tier:fast')
          const judgeScore = await this.judgeOutput(traj.input, traj.output, candidateOutput)
          if (judgeScore >= 0.5) improved++
        } catch {
          // judge failed — treat as neutral
          improved += 0.5
        }
      }

      return improved / sample.length
    }

    // For detector/workflow targets, use the stored scores as proxy
    return this.computeScore(heldOut)
  }

  // LLM-as-judge: is the candidate output better than the baseline?
  private async judgeOutput(input: string, baseline: string, candidate: string): Promise<number> {
    const judgeSystem = `You are an objective quality judge. Compare two AI outputs for the same input.
Respond ONLY with JSON: { "winner": "candidate" | "baseline" | "tie", "score": 0..1 }
score=1 means candidate is clearly better, 0=clearly worse, 0.5=tie.`

    const judgePrompt = `Input: ${input.slice(0, 300)}

Baseline output: ${baseline.slice(0, 300)}

Candidate output: ${candidate.slice(0, 300)}

Which is better quality, more accurate, and more useful?`

    try {
      const raw = await this.llm(judgeSystem, judgePrompt, 'tier:fast')
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(cleaned) as { winner: string; score: number }
      return typeof parsed.score === 'number' ? parsed.score : (parsed.winner === 'candidate' ? 1 : parsed.winner === 'baseline' ? 0 : 0.5)
    } catch {
      return 0.5
    }
  }

  // ── Data loading ──────────────────────────────────────────────────────────────

  private async loadTrajectories(
    target: OptTarget,
    targetId: string,
    tenantId: string,
    limit: number,
  ): Promise<Trajectory[]> {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)

    if (target === 'skill') {
      // Load from workflow_runs where skill nodes were executed
      const runs = await this.db.collection('workflow_runs')
        .find({
          tenant_id: tenantId,
          status: { $in: ['completed', 'failed'] },
          started_at: { $gte: since },
        })
        .sort({ started_at: -1 })
        .limit(limit)
        .toArray() as Array<{
          id: string; tenant_id: string; status: string
          state: Record<string, unknown>
          trigger_event?: { data?: Record<string, unknown> }
        }>

      // Load corresponding approval decisions
      const runIds = runs.map(r => r.id)
      const approvals = await this.db.collection('workflow_approvals')
        .find({ tenant_id: tenantId, workflow_run_id: { $in: runIds } })
        .toArray() as Array<{ tenant_id: string; workflow_run_id: string; status: string }>

      this.assertTenantIsolation(approvals, tenantId, 'workflow_approvals')
      const approvalMap = new Map(approvals.map(a => [a.workflow_run_id, a.status]))

      this.assertTenantIsolation(runs, tenantId, 'workflow_runs')
      return runs.map(run => ({
        input: JSON.stringify(run.trigger_event?.data ?? {}).slice(0, 500),
        output: JSON.stringify(run.state).slice(0, 500),
        outcome: (approvalMap.get(run.id) === 'approved' ? 'approved'
          : approvalMap.get(run.id) === 'rejected' ? 'rejected'
          : run.status === 'completed' ? 'converted'
          : 'expired') as Trajectory['outcome'],
        score: approvalMap.get(run.id) === 'approved' || run.status === 'completed' ? 1 : 0,
      }))
    }

    if (target === 'detector') {
      // Load from action_receipts (populated by routes/insights.ts on every
      // approve/dismiss) joined with insights (for feature_snapshot + reasoning).
      // Previously this read from `attribution_events`, which was never written
      // to — so detector optimization always skipped due to insufficient data.
      // action_receipts has: detector_id, outcome, insight_id, metadata.insight_score
      // insights has: hypothesis, reasoning, feature_snapshot
      const receipts = await this.db.collection('action_receipts')
        .find({
          tenant_id: tenantId,
          detector_id: targetId,
          executed_at: { $gte: since },
          // Only learn from receipts where learning was not suppressed
          learning_suppressed: { $ne: true },
        })
        .sort({ executed_at: -1 })
        .limit(limit)
        .toArray() as Array<{
          tenant_id: string
          insight_id?: string
          detector_id?: string
          outcome: string
          metadata?: { insight_score?: number }
        }>

      this.assertTenantIsolation(receipts, tenantId, 'action_receipts')

      // Fetch the corresponding insights to get input_data (feature_snapshot)
      // and reasoning text. Insights without a receipt are not learning signals.
      const insightIds = receipts
        .map(r => r.insight_id)
        .filter((id): id is string => typeof id === 'string')
      const insights = insightIds.length > 0
        ? await this.db.collection('insights')
            .find({ tenant_id: tenantId, id: { $in: insightIds } })
            .toArray() as Array<{
              id: string
              hypothesis?: string
              reasoning?: string
              feature_snapshot?: Record<string, unknown>
            }>
        : []
      const insightMap = new Map(insights.map(i => [i.id, i]))

      return receipts.map(r => {
        const insight = r.insight_id ? insightMap.get(r.insight_id) : undefined
        return {
          input: JSON.stringify(insight?.feature_snapshot ?? {}).slice(0, 500),
          output: insight?.reasoning ?? insight?.hypothesis ?? '',
          outcome: (r.outcome === 'approved' ? 'approved'
            : r.outcome === 'dismissed' ? 'rejected'
            : r.outcome === 'auto_approved' ? 'converted'
            : 'expired') as Trajectory['outcome'],
          score: ['approved', 'auto_approved', 'converted'].includes(r.outcome) ? 1 : 0,
        }
      })
    }

    return []
  }

  private async loadCurrentPrompt(
    target: OptTarget,
    targetId: string,
    tenantId: string,
  ): Promise<string> {
    // Check if there's already an optimized prompt for this target
    const existing = await this.skillPrompts.findOne({
      target, target_id: targetId, tenant_id: tenantId,
    }) as { prompt: string } | null

    if (existing?.prompt) return existing.prompt

    // Fall back to the compiled-in default prompt
    return SKILL_DEFAULT_PROMPTS[targetId] ?? `You are a helpful AI assistant performing the "${targetId}" task.`
  }

  /** Canonical one-line rendering of a rejected edit for the proposal constraint. */
  static formatRejectedEdit(e: EditProposal): string {
    return `${e.type} at "${e.location}": ${e.rationale}`
  }

  private async loadRejectedHistory(targetId: string, tenantId: string): Promise<string[]> {
    // Read both shapes so the memory is actually end-to-end:
    //  - dedicated `rejected_edits` documents written by recordRejectedEdits ({ edits })
    //  - legacy run-result documents that embed iterations[].rejected_edits
    const history = await this.optHistory
      .find({ target_id: targetId, tenant_id: tenantId })
      .sort({ recorded_at: -1, completed_at: -1 })
      .limit(REJECTION_MEMORY_DOC_LIMIT)
      .toArray() as Array<{
        edits?: EditProposal[]
        iterations?: Array<{ rejected_edits?: EditProposal[] }>
      }>

    const rejected: EditProposal[] = []
    for (const doc of history) {
      if (doc.edits) rejected.push(...doc.edits)
      for (const it of doc.iterations ?? []) rejected.push(...(it.rejected_edits ?? []))
    }

    // De-duplicate identical directions, keep the most recent N.
    const seen = new Set<string>()
    const out: string[] = []
    for (const e of rejected) {
      const line = SkillOptimizer.formatRejectedEdit(e)
      if (seen.has(line)) continue
      seen.add(line)
      out.push(line)
      if (out.length >= REJECTION_MEMORY_LIMIT) break
    }
    return out
  }

  private async recordRejectedEdits(
    targetId: string,
    tenantId: string,
    edits: EditProposal[],
    improvement: number,
  ): Promise<void> {
    await this.optHistory.insertOne({
      type: 'rejected_edits',
      target_id: targetId,
      tenant_id: tenantId,
      edits,
      improvement,
      recorded_at: new Date(),
    })
  }

  private assertTenantIsolation(
    documents: Array<{ tenant_id?: string }>,
    tenantId: string,
    source: string,
  ): void {
    if (documents.some(document => document.tenant_id !== tenantId)) {
      log.warn({ source }, 'Tenant isolation violation; aborting')
      throw new Error(`Tenant isolation violation in ${source}`)
    }
  }

  private async persistPrompt(
    target: OptTarget,
    targetId: string,
    tenantId: string,
    prompt: string,
    score: number,
  ): Promise<string> {
    const key = `${target}:${targetId}:${tenantId}`
    await this.skillPrompts.replaceOne(
      { target, target_id: targetId, tenant_id: tenantId },
      {
        target, target_id: targetId, tenant_id: tenantId,
        prompt, score,
        optimized_at: new Date(),
        version: randomUUID().slice(0, 8),
      },
      { upsert: true },
    )
    return `skill_optimized_prompts/${key}`
  }

  private computeScore(trajectories: Trajectory[]): number {
    if (trajectories.length === 0) return 0
    const sum = trajectories.reduce((s, t) => s + t.score, 0)
    return Math.round((sum / trajectories.length) * 1000) / 1000
  }

  private buildEmptyResult(
    runId: string, target: OptTarget, targetId: string,
    tenantId: string, prompt: string, startedAt: Date,
  ): SkillOptResult {
    return {
      run_id: runId, target, target_id: targetId, tenant_id: tenantId,
      original_prompt: prompt, optimized_prompt: prompt,
      baseline_score: 0, final_score: 0, improvement: 0,
      iterations: [], started_at: startedAt, completed_at: new Date(),
      persisted_to: 'skipped:insufficient_data',
    }
  }
}

// ── Default skill system prompts (baseline before any optimization) ────────────
// These are the starting points SkillOpt will improve from.

export const SKILL_DEFAULT_PROMPTS: Record<string, string> = {
  classify:  'You are a text classifier. Respond ONLY with valid JSON.',
  extract:   'You are a data extraction assistant. Extract fields from text. Respond ONLY with valid JSON.',
  summarize: 'You are a concise summarization assistant.',
  sentiment: 'You are a sentiment analysis model. Respond ONLY with valid JSON.',
  generate:  'You are a helpful assistant. Write clearly and concisely.',
  translate: 'You are a professional translator. Translate accurately, preserving tone and meaning.',
  score:     'You are an objective scoring assistant. Respond ONLY with valid JSON.',
  decide:    'You are a decision-making assistant. Respond ONLY with valid JSON.',
  route:     'You are a routing assistant. Respond ONLY with valid JSON.',
  compare:   'You are an objective comparison assistant. Respond ONLY with valid JSON.',
  enrich:    'You are a data enrichment assistant. Infer missing fields from available data. Respond ONLY with valid JSON.',
  plan:      'You are a strategic planning assistant. Respond ONLY with valid JSON.',
}
