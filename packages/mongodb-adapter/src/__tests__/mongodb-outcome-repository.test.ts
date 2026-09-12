import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import type { OutcomeContract } from '@kairos/specifications'
import { runOutcomeRepositoryConformance } from '@kairos/conformance'
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

describe('MongoOutcomeRepository', () => {
  it('passes repository conformance checks', async () => {
    const repository = new MongoOutcomeRepository(fakeDb(new FakeCollection()))
    const results = await runOutcomeRepositoryConformance(repository)
    expect(results.filter(result => !result.passed)).toEqual([])
  })

  it('creates tenant and lifecycle indexes', async () => {
    const collection = new FakeCollection()
    const repository = new MongoOutcomeRepository(fakeDb(collection))
    await repository.ensureIndexes()
    expect(collection.indexes).toHaveLength(3)
  })
})
