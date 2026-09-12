import type { MemoryRepository, MemoryScopeType, MemoryType } from '@agentoak/runtime'

export interface ContextRequest {
  tenant_id: string
  scope_type: Exclude<MemoryScopeType, 'global'>
  scope_id: string
  query_text: string
  token_budget: number
  tiers: Array<MemoryType | 'summary'>
}

export interface AssembledContext {
  episodic_snippets: string[]
  semantic_snippets: string[]
  summary?: string
  tokens_used: number
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export class ContextAssembler {
  constructor(private readonly repository: MemoryRepository) {}

  async assemble(request: ContextRequest): Promise<AssembledContext> {
    const memoryTypes = request.tiers.filter((tier): tier is MemoryType => tier !== 'summary')
    const records = await this.repository.search({
      tenant_id: request.tenant_id,
      scope_type: request.scope_type,
      scope_id: request.scope_id,
      memory_types: memoryTypes,
      query_text: request.query_text,
      limit: 20,
    })
    let tokensUsed = 0
    const include = (content: string): boolean => {
      const tokens = estimateTokens(content)
      if (tokensUsed + tokens > request.token_budget) return false
      tokensUsed += tokens
      return true
    }
    const episodic = records
      .filter(record => record.memory_type === 'episodic')
      .map(record => record.content)
      .filter(include)
    const semantic = records
      .filter(record => record.memory_type === 'semantic' && record.metadata['kind'] !== 'goal_evidence_summary')
      .map(record => record.content)
      .filter(include)
    const summaries = request.tiers.includes('summary')
      ? records.filter(record => record.metadata['kind'] === 'goal_evidence_summary').map(record => record.content)
      : []
    const summary = summaries.filter(include).join('\n') || undefined
    return {
      episodic_snippets: episodic,
      semantic_snippets: semantic,
      ...(summary ? { summary } : {}),
      tokens_used: tokensUsed,
    }
  }
}
