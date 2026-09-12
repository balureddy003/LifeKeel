import type { Collection, Db } from 'mongodb'
import type { OutcomeContract } from '@kairos/specifications'
import type { MemoryQuery, MemoryRecord, MemoryRepository, OutcomeRepository } from '@kairos/runtime'
import { bruteKnnSearch } from '@kairos/runtime'

export class MongoOutcomeRepository implements OutcomeRepository {
  private readonly collection: Collection<OutcomeContract>

  constructor(db: Db, collectionName = 'outcome_contracts') {
    this.collection = db.collection<OutcomeContract>(collectionName)
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ tenant_id: 1, id: 1 }, { unique: true }),
      this.collection.createIndex({ tenant_id: 1, updated_at: -1 }),
      this.collection.createIndex({ tenant_id: 1, lifecycle: 1 }),
    ])
  }

  async get(tenantId: string, outcomeId: string): Promise<OutcomeContract | null> {
    const contract = await this.collection.findOne(
      { tenant_id: tenantId, id: outcomeId },
      { projection: { _id: 0 } },
    )
    return contract ? structuredClone(contract) : null
  }

  async save(contract: OutcomeContract): Promise<void> {
    await this.collection.replaceOne(
      { tenant_id: contract.tenant_id, id: contract.id },
      structuredClone(contract),
      { upsert: true },
    )
  }

  async list(tenantId: string): Promise<OutcomeContract[]> {
    const contracts = await this.collection
      .find({ tenant_id: tenantId }, { projection: { _id: 0 } })
      .sort({ updated_at: -1 })
      .toArray()
    return contracts.map(contract => structuredClone(contract))
  }
}

export class MongoMemoryRepository implements MemoryRepository {
  private readonly collection: Collection<MemoryRecord>

  constructor(db: Db, collectionName = 'agent_memory') {
    this.collection = db.collection<MemoryRecord>(collectionName)
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ tenant_id: 1, id: 1 }, { unique: true }),
      this.collection.createIndex({ tenant_id: 1, scope_type: 1, scope_id: 1, created_at: -1 }),
      this.collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    ])
  }

  async save(record: MemoryRecord): Promise<void> {
    await this.collection.replaceOne(
      { tenant_id: record.tenant_id, id: record.id },
      structuredClone(record),
      { upsert: true },
    )
  }

  async get(tenantId: string, id: string): Promise<MemoryRecord | null> {
    return this.collection.findOne({ tenant_id: tenantId, id })
  }

  async search(query: MemoryQuery): Promise<MemoryRecord[]> {
    const filter: Record<string, unknown> = {
      tenant_id: query.tenant_id,
      $or: [{ expires_at: { $exists: false } }, { expires_at: { $gt: new Date() } }],
    }
    if (query.scope_type) filter['scope_type'] = query.scope_type
    if (query.scope_id) filter['scope_id'] = query.scope_id
    if (query.memory_types?.length) filter['memory_type'] = { $in: query.memory_types }
    if (query.tags?.length) filter['tags'] = { $in: query.tags }
    if (query.query_text) filter['content'] = { $regex: query.query_text.split(/\s+/).filter(Boolean).join('|'), $options: 'i' }
    const records = await this.collection.find(filter).sort({ created_at: -1 }).limit(query.query_embedding ? 500 : query.limit ?? 10).toArray()
    const queryEmbedding = query.query_embedding
    if (!queryEmbedding) return records
    return bruteKnnSearch(records, queryEmbedding, record => record.embedding, query.limit ?? 10)
      .map(match => match.item)
  }
}
