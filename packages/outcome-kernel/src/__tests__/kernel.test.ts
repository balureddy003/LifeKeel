import { describe, expect, it } from 'vitest'
import type { OutcomeContract } from '@agentoak/specifications'
import {
  InvalidOutcomeTransitionError,
  assessOutcome,
  canTransition,
  evaluateReadiness,
  transitionOutcome,
} from '../index.js'

function contract(): OutcomeContract {
  return {
    api_version: 'kairos.io/v1',
    kind: 'OutcomeContract',
    id: 'goal-1',
    tenant_id: 'tenant-1',
    name: 'Reduce overdue invoices',
    lifecycle: 'draft',
    kpis: [{
      id: 'overdue-total',
      label: 'Overdue total',
      direction: 'decrease',
      target: 100,
      unit: 'GBP',
      evidence: {
        id: 'evidence-1',
        source: 'xero',
        observed_at: '2026-06-06T00:00:00.000Z',
        state: 'unknown',
      },
    }],
    required_capabilities: [{
      capability: 'invoice.read',
      required: true,
      provider_id: 'xero',
    }],
    autonomy: {
      level: 'review_required',
      permitted_capabilities: ['invoice.read'],
      approval_required_for: [],
      limits: {},
    },
    created_at: '2026-06-06T00:00:00.000Z',
    updated_at: '2026-06-06T00:00:00.000Z',
  }
}

describe('outcome lifecycle', () => {
  it('permits only declared transitions', () => {
    expect(canTransition('draft', 'readiness_pending')).toBe(true)
    expect(canTransition('draft', 'achieved')).toBe(false)
  })

  it('rejects invalid transitions', () => {
    expect(() => transitionOutcome(contract(), 'achieved', '2026-06-06T01:00:00.000Z'))
      .toThrow(InvalidOutcomeTransitionError)
  })

  it('allows execution states to enter and recover from at-risk', () => {
    expect(canTransition('measuring', 'at_risk')).toBe(true)
    expect(canTransition('at_risk', 'measuring')).toBe(true)
    expect(canTransition('at_risk', 'achieved')).toBe(true)
    expect(canTransition('at_risk', 'failed')).toBe(true)
  })
})

describe('outcome assessment', () => {
  it('never treats unknown decrease evidence as achievement', () => {
    expect(assessOutcome(contract())).toMatchObject({
      status: 'unknown',
      pending_kpis: ['overdue-total'],
    })
  })

  it('accepts achievement only from measured evidence', () => {
    const input = contract()
    input.kpis[0]!.evidence.state = 'measured'
    input.kpis[0]!.evidence.value = 50
    expect(assessOutcome(input).status).toBe('achieved')
  })
})

describe('readiness', () => {
  it('requires providers and policy coverage', () => {
    const input = contract()
    input.required_capabilities[0] = { capability: 'invoice.write', required: true }
    expect(evaluateReadiness(input).filter(check => !check.ready)).toHaveLength(2)
  })
})
