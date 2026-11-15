/**
 * Business graph: a member's business and the income it pays the household (intent 96).
 * If the business stops, the income it pays stops. Pure; no I/O.
 */
import { describe, expect, it } from 'vitest'
import { businessShockEvents, validateGraph, type BusinessGraph } from '../business-graph.js'

const graph: BusinessGraph = {
  businesses: [
    { id: 'b1', name: 'Plumbing Ltd' },
    { id: 'b2', name: 'Consulting' },
  ],
  incomeEdges: [
    { businessId: 'b1', memberId: 'm1', monthlyMinor: 200_000 },
    { businessId: 'b1', memberId: 'm2', monthlyMinor: 50_000 },
    { businessId: 'b2', memberId: 'm1', monthlyMinor: 100_000 },
  ],
}

describe('businessShockEvents', () => {
  it('stops the income every edge from that business pays, as one income_stops event', () => {
    expect(businessShockEvents(graph, 'b1', 0)).toEqual([
      { kind: 'income_stops', fromMonth: 0, monthlyIncomeLostMinor: 250_000 },
    ])
  })

  it('leaves other businesses alone', () => {
    const [e] = businessShockEvents(graph, 'b2', 3)
    expect(e).toEqual({ kind: 'income_stops', fromMonth: 3, monthlyIncomeLostMinor: 100_000 })
  })

  it('returns no event when the business pays nothing', () => {
    expect(businessShockEvents({ ...graph, incomeEdges: [] }, 'b1', 0)).toEqual([])
  })

  it('throws for a business that is not in the graph', () => {
    expect(() => businessShockEvents(graph, 'nope', 0)).toThrow(/not in the graph/)
  })
})

describe('validateGraph', () => {
  it('accepts a well-formed graph', () => {
    expect(validateGraph(graph)).toEqual([])
  })

  it('flags an edge to an unknown business', () => {
    const bad = { ...graph, incomeEdges: [{ businessId: 'x', memberId: 'm1', monthlyMinor: 1 }] }
    expect(validateGraph(bad).join(' ')).toMatch(/unknown business/)
  })

  it('flags duplicate business ids and non-whole or negative amounts', () => {
    const bad: BusinessGraph = {
      businesses: [
        { id: 'b1', name: 'A' },
        { id: 'b1', name: 'B' },
      ],
      incomeEdges: [{ businessId: 'b1', memberId: 'm1', monthlyMinor: 1.5 }],
    }
    const msgs = validateGraph(bad).join(' ')
    expect(msgs).toMatch(/duplicate business/)
    expect(msgs).toMatch(/whole, non-negative/)
  })
})
