/**
 * Storage port for the business graph (intent 96). One document per household in `business_graph`,
 * always read and written by tenant. The engine only sees `BusinessGraph`, so moving this to another
 * datastore later changes this file and nothing else.
 */
import type { Db } from 'mongodb'
import { validateGraph, type BusinessGraph } from './business-graph.js'

const COLLECTION = 'business_graph'

export async function loadGraph(db: Db, tenantId: string): Promise<BusinessGraph> {
  const doc = await db
    .collection<{
      tenant_id: string
      businesses?: BusinessGraph['businesses']
      income_edges?: BusinessGraph['incomeEdges']
    }>(COLLECTION)
    .findOne({ tenant_id: tenantId })
  return { businesses: doc?.businesses ?? [], incomeEdges: doc?.income_edges ?? [] }
}

/** Replaces the household's graph. Validates first, so a bad graph is never stored. */
export async function saveGraph(db: Db, tenantId: string, graph: BusinessGraph): Promise<void> {
  const problems = validateGraph(graph)
  if (problems.length > 0) throw new RangeError(problems.join('; '))
  await db.collection(COLLECTION).replaceOne(
    { tenant_id: tenantId },
    {
      tenant_id: tenantId,
      businesses: graph.businesses,
      income_edges: graph.incomeEdges,
      updated_at: new Date(),
    },
    { upsert: true },
  )
}
