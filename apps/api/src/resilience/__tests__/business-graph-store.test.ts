/** The business graph store is tenant-scoped and validates before it writes (intent 96). */
import { describe, expect, it } from 'vitest'
import { loadGraph, saveGraph } from '../business-graph-store.js'

type Doc = Record<string, unknown>
function fakeDb(store: Doc[]) {
  return {
    collection: () => ({
      findOne: async (f: Doc) => store.find((d) => d['tenant_id'] === f['tenant_id']) ?? null,
      replaceOne: async (f: Doc, doc: Doc) => {
        const i = store.findIndex((d) => d['tenant_id'] === f['tenant_id'])
        if (i >= 0) store[i] = doc
        else store.push(doc)
        return {}
      },
    }),
  } as never
}

const graph = {
  businesses: [{ id: 'b1', name: 'Plumbing Ltd' }],
  incomeEdges: [{ businessId: 'b1', memberId: 'm1', monthlyMinor: 200_000 }],
}

describe('business graph store', () => {
  it('returns an empty graph for a household with none', async () => {
    expect(await loadGraph(fakeDb([]), 't1')).toEqual({ businesses: [], incomeEdges: [] })
  })

  it('saves and loads a graph for one tenant without touching another', async () => {
    const store: Doc[] = []
    const db = fakeDb(store)
    await saveGraph(db, 't1', graph)
    await saveGraph(db, 't2', { businesses: [], incomeEdges: [] })
    expect(await loadGraph(db, 't1')).toEqual(graph)
    expect(store).toHaveLength(2)
  })

  it('refuses an invalid graph and writes nothing', async () => {
    const store: Doc[] = []
    const bad = { ...graph, incomeEdges: [{ businessId: 'x', memberId: 'm1', monthlyMinor: 1 }] }
    await expect(saveGraph(fakeDb(store), 't1', bad)).rejects.toThrow(/unknown business/)
    expect(store).toHaveLength(0)
  })
})
