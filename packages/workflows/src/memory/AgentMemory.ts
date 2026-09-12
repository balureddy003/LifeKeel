/**
 * AgentMemory — three-tier memory system for workflow agents.
 *
 * Tier 1 — Working memory:   workflow state (already in WorkflowState)
 * Tier 2 — Episodic memory:  past run outputs stored in MongoDB, retrieved by
 *                             recency + relevance (keyword match on tags/content)
 * Tier 3 — Semantic memory:  vector embeddings stored in MongoDB, cosine
 *                             similarity retrieval via aggregation pipeline
 *                             (requires MongoDB Atlas $vectorSearch, or falls
 *                              back to keyword search if not available)
 *
 * Usage in workflow nodes:
 *   memory.remember({ key, value, tags })   → store a memory
 *   memory.recall({ query, limit })          → retrieve relevant memories
 *   memory.buildContext(query)               → formatted context string for LLM
 *   memory.forget(key)                       → delete a specific memory
 *
 * All memories are scoped by (tenantId, workflowId) for multi-tenant isolation.
 */

import type { Collection, Db } from 'mongodb'
import { getCircuitBreaker } from '@agentoak/platform'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string
  tenant_id: string
  workflow_id: string
  run_id?: string          // which run created this memory
  node_id?: string         // which node created this memory
  key: string              // logical name, e.g. "last_linkedin_post"
  value: unknown           // any serializable value
  summary?: string         // human-readable summary of value (for context building)
  tags: string[]           // for keyword retrieval
  embedding?: number[]     // vector embedding (1536-dim for text-embedding-3-small)
  created_at: Date
  expires_at?: Date        // optional TTL
  _schema_version?: number
  memory_type: 'episodic' | 'semantic' | 'procedural'
}

export interface RememberOptions {
  key: string
  value: unknown
  summary?: string
  tags?: string[]
  runId?: string
  nodeId?: string
  ttlDays?: number
  memoryType?: MemoryEntry['memory_type']
}

export interface RecallOptions {
  query: string
  limit?: number
  tags?: string[]
  memoryType?: MemoryEntry['memory_type']
  sinceRunId?: string
}

export interface MemoryContext {
  entries: Array<{ key: string; summary: string; value: unknown; created_at: Date }>
  formatted: string        // ready to inject into LLM system prompt
}

// ── AgentMemory ────────────────────────────────────────────────────────────────

export class AgentMemory {
  private col: Collection<MemoryEntry>
  private embedFn: ((text: string) => Promise<number[]>) | undefined

  constructor(
    private readonly db: Db,
    private readonly tenantId: string,
    private readonly workflowId: string,
    embedFn?: (text: string) => Promise<number[]>,
  ) {
    this.col = db.collection<MemoryEntry>('agent_memory')
    this.embedFn = embedFn
  }

  // ── Store a memory ─────────────────────────────────────────────────────────

  async remember(opts: RememberOptions): Promise<string> {
    const id = `${this.tenantId}:${this.workflowId}:${opts.key}:${Date.now()}`
    const valueSummary = opts.summary ?? this.autoSummarize(opts.value)

    let embedding: number[] | undefined
    if (this.embedFn && typeof opts.value === 'string') {
      try {
        embedding = await this.embedFn(opts.value)
      } catch {
        // embedding generation failed — fall back to keyword-only retrieval
      }
    } else if (this.embedFn && opts.summary) {
      try {
        embedding = await this.embedFn(opts.summary)
      } catch {
        // ignore
      }
    }

    const entry: MemoryEntry = {
      id,
      tenant_id: this.tenantId,
      workflow_id: this.workflowId,
      ...(opts.runId ? { run_id: opts.runId } : {}),
      ...(opts.nodeId ? { node_id: opts.nodeId } : {}),
      key: opts.key,
      value: opts.value,
      summary: valueSummary,
      tags: opts.tags ?? [],
      ...(embedding ? { embedding } : {}),
      created_at: new Date(),
      ...(opts.ttlDays ? { expires_at: new Date(Date.now() + opts.ttlDays * 86400_000) } : {}),
      _schema_version: 1,
      memory_type: opts.memoryType ?? 'episodic',
    }

    // Upsert by key (keep latest value for a given key within this workflow)
    await this.col.replaceOne(
      { tenant_id: this.tenantId, workflow_id: this.workflowId, key: opts.key },
      entry,
      { upsert: true },
    )

    return id
  }

  // ── Retrieve relevant memories ─────────────────────────────────────────────

  async recall(opts: RecallOptions): Promise<MemoryEntry[]> {
    const limit = opts.limit ?? 5
    const filter: Record<string, unknown> = {
      tenant_id: this.tenantId,
      workflow_id: this.workflowId,
    }

    if (opts.memoryType) filter['memory_type'] = opts.memoryType
    if (opts.tags?.length) filter['tags'] = { $in: opts.tags }

    // Expire check
    filter['$or'] = [{ expires_at: { $exists: false } }, { expires_at: { $gt: new Date() } }]

    // Try vector search first if we have an embedding function
    if (this.embedFn) {
      try {
        const queryEmbedding = await this.embedFn(opts.query)
        // Cosine similarity via aggregation (works without Atlas Search)
        const results = await this.col.aggregate<MemoryEntry>([
          { $match: filter },
          {
            $addFields: {
              similarity: {
                $reduce: {
                  input: { $zip: { inputs: ['$embedding', queryEmbedding] } },
                  initialValue: 0,
                  in: { $add: ['$$value', { $multiply: [{ $arrayElemAt: ['$$this', 0] }, { $arrayElemAt: ['$$this', 1] }] }] },
                },
              },
            },
          },
          { $match: { embedding: { $exists: true } } },
          { $sort: { similarity: -1 } },
          { $limit: limit },
        ]).toArray()

        if (results.length > 0) return results
      } catch {
        // Vector search failed — fall through to keyword search
      }
    }

    // Keyword fallback: match query terms against tags + key + summary
    const terms = opts.query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length > 0) {
      const keywordFilter = {
        ...filter,
        $or: terms.map(term => ({
          $or: [
            { key: { $regex: term, $options: 'i' } },
            { summary: { $regex: term, $options: 'i' } },
            { tags: { $regex: term, $options: 'i' } },
          ],
        })),
      }
      const results = await this.col
        .find(keywordFilter)
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray() as MemoryEntry[]
      if (results.length > 0) return results
    }

    // Recency fallback: just return the most recent memories
    return this.col
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray() as unknown as MemoryEntry[]
  }

  // ── Build formatted context string for LLM injection ──────────────────────

  async buildContext(query: string, maxEntries = 5): Promise<MemoryContext> {
    const entries = await this.recall({ query, limit: maxEntries })

    const mapped = entries.map(e => ({
      key: e.key,
      summary: e.summary ?? String(e.value).slice(0, 200),
      value: e.value,
      created_at: e.created_at,
    }))

    const formatted = mapped.length === 0
      ? ''
      : [
          '--- Relevant memory from previous runs ---',
          ...mapped.map((e, i) =>
            `[${i + 1}] ${e.key} (${e.created_at.toLocaleDateString()}): ${e.summary}`
          ),
          '--- End of memory context ---',
        ].join('\n')

    return { entries: mapped, formatted }
  }

  // ── Recall by exact key ────────────────────────────────────────────────────

  async get(key: string): Promise<MemoryEntry | null> {
    return this.col.findOne({
      tenant_id: this.tenantId,
      workflow_id: this.workflowId,
      key,
      $or: [{ expires_at: { $exists: false } }, { expires_at: { $gt: new Date() } }],
    }) as Promise<MemoryEntry | null>
  }

  // ── Delete a memory ────────────────────────────────────────────────────────

  async forget(key: string): Promise<void> {
    await this.col.deleteOne({ tenant_id: this.tenantId, workflow_id: this.workflowId, key })
  }

  // ── List all memories for this workflow ────────────────────────────────────

  async list(limit = 20): Promise<MemoryEntry[]> {
    return this.col
      .find({ tenant_id: this.tenantId, workflow_id: this.workflowId })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray() as unknown as MemoryEntry[]
  }

  // ── Prune expired entries ──────────────────────────────────────────────────

  async pruneExpired(): Promise<number> {
    const result = await this.col.deleteMany({
      tenant_id: this.tenantId,
      expires_at: { $lt: new Date() },
    })
    return result.deletedCount
  }

  // ── Auto-generate a summary for non-string values ─────────────────────────

  private autoSummarize(value: unknown): string {
    if (typeof value === 'string') return value.slice(0, 300)
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return `Array of ${value.length} items: ${JSON.stringify(value.slice(0, 3)).slice(0, 100)}`
    if (value && typeof value === 'object') {
      const keys = Object.keys(value as object)
      return `Object with keys: ${keys.slice(0, 5).join(', ')}${keys.length > 5 ? '...' : ''}`
    }
    return JSON.stringify(value).slice(0, 200)
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────
// Creates an embedding function backed by the tenant's configured LLM provider

export function createEmbedFn(
  apiKey?: string,
  provider?: string,
): ((text: string) => Promise<number[]>) | undefined {
  // OpenAI text-embedding-3-small (1536 dims, cheap + fast)
  if (provider === 'openai' && apiKey) {
    const cb = getCircuitBreaker('openai')
    return async (text: string) => cb.call(async () => {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
      })
      const data = await res.json() as { data: Array<{ embedding: number[] }> }
      return data.data[0]!.embedding
    })
  }

  // Anthropic doesn't have a dedicated embeddings API yet —
  // fall back to no embeddings (keyword search only)
  return undefined
}
