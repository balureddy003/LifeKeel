import { describe, it, expect } from 'vitest'
import { EmbeddingWorker } from '../memory/EmbeddingWorker.js'

class FakeCollection {
  documents: any[] = []
  find(filter: any) {
    const docs = this.documents.filter(d => !('embedding' in d))
    return {
      sort: () => ({
        limit: (n: number) => ({ toArray: async () => docs.slice(0, n) }),
      }),
    }
  }
  async updateOne(filter: any, update: any) {
    const idx = this.documents.findIndex(d => d.tenant_id === filter.tenant_id && d.id === filter.id)
    if (idx !== -1) this.documents[idx] = { ...this.documents[idx], ...update['$set'] }
  }
}

function fakeDb(collection: FakeCollection) {
  return { collection: () => collection } as unknown as any
}

describe('EmbeddingWorker', () => {
  it('processes missing embeddings and updates documents', async () => {
    const col = new FakeCollection()
    col.documents.push({ tenant_id: 't1', id: 'm1', content: 'hello' })
    col.documents.push({ tenant_id: 't1', id: 'm2', content: 'world' })

    const embedFn = async (text: string) => text.split('').map(c => c.charCodeAt(0) % 10)
    const worker = new EmbeddingWorker(fakeDb(col), embedFn, 10)

    const updated = await worker.processOnce()
    expect(updated).toBe(2)
    expect(col.documents[0].embedding).toBeDefined()
    expect(col.documents[1].embedding).toBeDefined()
  })
})
