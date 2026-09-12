import type { Db } from 'mongodb'
import { MongoMemoryRepository } from '@kairos/mongodb-adapter'
import { ContextAssembler } from '@kairos/platform'
import type { ReasoningContextBuilder } from '@kairos/engine'

export class ApiReasoningContextBuilder implements ReasoningContextBuilder {
  private readonly assembler: ContextAssembler

  constructor(private readonly db: Db) {
    this.assembler = new ContextAssembler(new MongoMemoryRepository(db))
  }

  async assemble(input: Parameters<ReasoningContextBuilder['assemble']>[0]) {
    const [memory, goals] = await Promise.all([
      this.assembler.assemble({
        tenant_id: input.tenant_id,
        scope_type: 'detector',
        scope_id: input.detector_id,
        query_text: input.query_text,
        token_budget: input.token_budget,
        tiers: ['episodic', 'semantic'],
      }),
      this.db.collection('goals').find({
        tenant_id: input.tenant_id,
        detector_ids: input.detector_id,
        status: { $in: ['active', 'at_risk'] },
      }).limit(5).toArray(),
    ])
    return {
      episodic_snippets: memory.episodic_snippets,
      semantic_snippets: memory.semantic_snippets,
      goal_snippets: goals.map(goal =>
        `${String(goal['name'])}: ${String(goal['status'])}; target ${String(goal['target_date'])}`,
      ),
      tokens_used: memory.tokens_used,
    }
  }
}
