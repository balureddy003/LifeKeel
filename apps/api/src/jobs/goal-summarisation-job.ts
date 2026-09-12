import { createHash, randomUUID } from 'node:crypto'
import type { Db } from 'mongodb'
import { z } from 'zod'
import { callStructured, LlmBudgetGuard, createGuardEventSink, type LlmFn, type LlmGovernanceOptions } from '@agentoak/platform'
import { MongoMemoryRepository } from '@agentoak/mongodb-adapter'
import type { GoalEvidenceSummary } from '@agentoak/specifications'

const SummarySchema = z.object({ summary_text: z.string().max(1600) })
const DAY_MS = 86_400_000

export class GoalSummarisationJob {
  private readonly budgetGuard: LlmBudgetGuard
  private readonly guardEventSink: ReturnType<typeof createGuardEventSink>

  constructor(private readonly db: Db, private readonly llm: LlmFn) {
    this.budgetGuard = new LlmBudgetGuard(db)
    this.guardEventSink = createGuardEventSink(db, 'goal-summarisation')
  }

  async run(asOf = new Date()): Promise<number> {
    const goals = await this.db.collection('goals').find({
      status: { $in: ['active', 'at_risk'] },
      start_date: { $lte: new Date(asOf.getTime() - 14 * DAY_MS) },
    }).toArray()
    let generated = 0
    for (const goal of goals) {
      const latest = await this.db.collection('goal_evidence_summaries')
        .findOne({ tenant_id: goal['tenant_id'], goal_id: goal['id'] }, { sort: { period_end: -1 } })
      const periodStart = latest?.['period_end'] instanceof Date
        ? latest['period_end'] as Date
        : new Date(asOf.getTime() - 7 * DAY_MS)
      if (asOf.getTime() - periodStart.getTime() < 7 * DAY_MS) continue
      await this.summarise(String(goal['tenant_id']), String(goal['id']), periodStart, asOf, goal)
      generated++
    }
    return generated
  }

  private async summarise(
    tenantId: string,
    goalId: string,
    periodStart: Date,
    periodEnd: Date,
    goal: Record<string, unknown>,
  ): Promise<void> {
    const [signals, triggers] = await Promise.all([
      this.db.collection('goal_kpi_snapshots').find({
        tenant_id: tenantId, goal_id: goalId, recorded_at: { $gte: periodStart, $lte: periodEnd },
      }).sort({ recorded_at: -1 }).limit(100).toArray(),
      this.db.collection('insights').find({
        tenant_id: tenantId, 'feature_snapshot.goal_id': goalId,
        created_at: { $gte: periodStart, $lte: periodEnd },
      }).sort({ created_at: -1 }).limit(100).toArray(),
    ])
    const governance: LlmGovernanceOptions = {
      tenantId,
      budgetGuard: this.budgetGuard,
      guardEventSink: this.guardEventSink,
    }
    const result = await callStructured(this.llm, {
      schema: SummarySchema,
      system: 'Summarise weekly goal evidence concisely and factually.',
      prompt: JSON.stringify({ goal: goal['name'], signals, triggers }),
      model: 'tier:balanced',
      outputDescription: 'a weekly goal evidence summary',
      governance,
    })
    const kpis = Array.isArray(goal['kpis']) ? goal['kpis'] as Array<Record<string, unknown>> : []
    const summary: GoalEvidenceSummary = {
      goal_id: goalId,
      tenant_id: tenantId,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      summary_text: result.data.summary_text,
      kpi_snapshot: Object.fromEntries(kpis.map(kpi => [String(kpi['metric']), Number(kpi['current'] ?? 0)])),
      trigger_count: triggers.length,
      approved_move_count: triggers.filter(trigger => trigger['state'] === 'completed').length,
      key_signals: triggers.slice(0, 3).map(trigger => String(trigger['id'])),
      generated_at: new Date().toISOString(),
    }
    await this.db.collection('goal_evidence_summaries').insertOne({
      ...summary,
      period_start: new Date(summary.period_start),
      period_end: new Date(summary.period_end),
      generated_at: new Date(summary.generated_at),
    })
    const content = summary.summary_text
    await new MongoMemoryRepository(this.db).save({
      id: randomUUID(),
      tenant_id: tenantId,
      scope_type: 'goal',
      scope_id: goalId,
      memory_type: 'semantic',
      content,
      content_hash: createHash('sha256').update(content).digest('hex'),
      metadata: { kind: 'goal_evidence_summary', ...summary },
      tags: ['goal_evidence_summary', goalId],
      created_at: new Date(),
    })
  }
}
