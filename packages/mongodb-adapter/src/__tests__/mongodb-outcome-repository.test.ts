import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import type { OutcomeContract } from '@lifekeel/specifications'
import { MongoOutcomeRepository } from '../index.js'

class FakeCollection {
  readonly documents: OutcomeContract[] = []
  readonly indexes: unknown[] = []

  async createIndex(key: unknown, options?: unknown): Promise<string> {
    this.indexes.push({ key, options })
    return 'index'
  }

  async findOne(filter: Record<string, unknown>): Promise<OutcomeContract | null> {
    return this.documents.find(document =>
      document.tenant_id === filter['tenant_id'] && document.id === filter['id'],
    ) ?? null
  }

  async replaceOne(filter: Record<string, unknown>, replacement: OutcomeContract): Promise<void> {
    const index = this.documents.findIndex(document =>
      document.tenant_id === filter['tenant_id'] && document.id === filter['id'],
    )
    if (index === -1) this.documents.push(structuredClone(replacement))
    else this.documents[index] = structuredClone(replacement)
  }

  find(filter: Record<string, unknown>) {
    const matching = this.documents.filter(document => document.tenant_id === filter['tenant_id'])
    return {
      sort: () => ({
        toArray: async () => matching.map(document => structuredClone(document)),
      }),
    }
  }
}

function fakeDb(collection: FakeCollection): Db {
  return {
    collection: () => collection,
  } as unknown as Db
}

function makeContract(tenantId: string, id: string, updatedAt = new Date().toISOString()): OutcomeContract {
  return {
    api_version: 'lifekeel.io/v1',
    kind: 'OutcomeContract',
    tenant_id: tenantId,
    id,
    name: id,
    lifecycle: 'ready',
    kpis: [],
    required_capabilities: [],
    autonomy: {
      level: 'review_required',
      permitted_capabilities: [],
      approval_required_for: [],
      limits: {},
    },
    created_at: updatedAt,
    updated_at: updatedAt,
  } as OutcomeContract
}

describe('MongoOutcomeRepository', () => {
  it('round-trips a contract', async () => {
    const collection = new FakeCollection()
    const repository = new MongoOutcomeRepository(fakeDb(collection))
    const contract = makeContract('tenant-a', 'outcome-1')

    await repository.save(contract)
    const retrieved = await repository.get('tenant-a', 'outcome-1')

    expect(retrieved).toEqual(contract)
  })

  it('lists contracts scoped to the tenant sorted by updated_at desc', async () => {
    const collection = new FakeCollection()
    const repository = new MongoOutcomeRepository(fakeDb(collection))

    await repository.save(makeContract('tenant-a', 'a1', '2026-01-02T00:00:00Z'))
    await repository.save(makeContract('tenant-a', 'a2', '2026-01-01T00:00:00Z'))
    await repository.save(makeContract('tenant-b', 'b1', '2026-01-03T00:00:00Z'))

    const listed = await repository.list('tenant-a')
    expect(listed).toHaveLength(2)
    expect(listed.map(c => c.id)).toEqual(['a1', 'a2'])
  })

  it('upserts an existing contract', async () => {
    const collection = new FakeCollection()
    const repository = new MongoOutcomeRepository(fakeDb(collection))

    await repository.save(makeContract('tenant-a', 'outcome-1', '2026-01-01T00:00:00Z'))
    await repository.save(makeContract('tenant-a', 'outcome-1', '2026-01-02T00:00:00Z'))

    const listed = await repository.list('tenant-a')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.updated_at).toBe('2026-01-02T00:00:00Z')
  })

  it('creates tenant and lifecycle indexes', async () => {
    const collection = new FakeCollection()
    const repository = new MongoOutcomeRepository(fakeDb(collection))
    await repository.ensureIndexes()
    expect(collection.indexes).toHaveLength(3)
  })
})
