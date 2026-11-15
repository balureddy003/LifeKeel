/**
 * Business graph (intent 96): the businesses a household member runs and the income each pays the household.
 * If a business stops, the income it pays stops. The shock is an ordinary `income_stops` event, so the
 * existing range, ranking and confirmation machinery applies unchanged. Pure: no I/O, no model call.
 * Figures are what the household entered; nothing is guessed, and no product is named.
 */
import type { EngineEvent } from './events.js'

export interface Business {
  id: string
  name: string
}

/** Monthly income (minor units) the business pays to one household member. */
export interface IncomeEdge {
  businessId: string
  memberId: string
  monthlyMinor: number
}

export interface BusinessGraph {
  businesses: Business[]
  incomeEdges: IncomeEdge[]
}

/** Problems with the graph as entered, in plain words. Empty when it is well formed. */
export function validateGraph(graph: BusinessGraph): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const b of graph.businesses) {
    if (seen.has(b.id)) problems.push(`duplicate business id ${b.id}`)
    seen.add(b.id)
  }
  for (const e of graph.incomeEdges) {
    if (!seen.has(e.businessId)) problems.push(`income from unknown business ${e.businessId}`)
    if (!Number.isInteger(e.monthlyMinor) || e.monthlyMinor < 0)
      problems.push(`income from ${e.businessId} must be a whole, non-negative number`)
  }
  return problems
}

/** What happens to the household if this business stops from `fromMonth`: the income it pays is lost. */
export function businessShockEvents(
  graph: BusinessGraph,
  businessId: string,
  fromMonth: number,
): EngineEvent[] {
  if (!graph.businesses.some((b) => b.id === businessId))
    throw new RangeError(`business ${businessId} is not in the graph`)
  const lost = graph.incomeEdges
    .filter((e) => e.businessId === businessId)
    .reduce((sum, e) => sum + e.monthlyMinor, 0)
  return lost > 0 ? [{ kind: 'income_stops', fromMonth, monthlyIncomeLostMinor: lost }] : []
}
