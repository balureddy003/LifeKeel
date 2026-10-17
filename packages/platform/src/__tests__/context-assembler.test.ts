import { describe, expect, it } from 'vitest'
import type { MemoryRepository } from '@lifekeel/runtime'
import { ContextAssembler } from '../context-assembler.js'

describe('ContextAssembler', () => {
  it('enforces tenant scope and token budget', async () => {
    const repository: MemoryRepository = {
      save: async () => undefined,
      get: async () => null,
      search: async query => {
        expect(query.tenant_id).toBe('tenant-a')
        return [
          {
            id: '1', tenant_id: 'tenant-a', scope_type: 'detector', scope_id: 'd1',
            memory_type: 'episodic', content: 'short history', content_hash: 'x',
            metadata: {}, tags: [], created_at: new Date(),
          },
          {
            id: '2', tenant_id: 'tenant-a', scope_type: 'detector', scope_id: 'd1',
            memory_type: 'semantic', content: 'x'.repeat(1000), content_hash: 'y',
            metadata: {}, tags: [], created_at: new Date(),
          },
        ]
      },
    }
    const result = await new ContextAssembler(repository).assemble({
      tenant_id: 'tenant-a',
      scope_type: 'detector',
      scope_id: 'd1',
      query_text: 'history',
      token_budget: 10,
      tiers: ['episodic', 'semantic'],
    })
    expect(result.episodic_snippets).toEqual(['short history'])
    expect(result.semantic_snippets).toEqual([])
    expect(result.tokens_used).toBeLessThanOrEqual(10)
  })
})
