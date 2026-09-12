import { describe, expect, it } from 'vitest'
import { legacyGoalToOutcomeContract, type LegacyGoal } from '../index.js'

function legacyGoal(status: LegacyGoal['status'] = 'active'): LegacyGoal {
  return {
    id: 'goal-1',
    tenant_id: 'tenant-1',
    name: 'Reduce overdue invoices',
    status,
    kpis: [{
      metric: 'overdue_count',
      label: 'Overdue invoices',
      unit: 'invoices',
      target: 0,
      current: 0,
      direction: 'decrease',
      source: 'signals',
    }],
    execution_plan: {
      enabled: true,
      required_connectors: ['xero'],
    },
    created_at: new Date('2026-06-01T00:00:00.000Z'),
    updated_at: new Date('2026-06-06T00:00:00.000Z'),
  }
}

describe('legacyGoalToOutcomeContract', () => {
  it('does not treat legacy current values as measured evidence', () => {
    const contract = legacyGoalToOutcomeContract(legacyGoal())
    expect(contract.kpis[0]?.evidence).toMatchObject({
      state: 'unknown',
      source: 'signals',
    })
    expect(contract.kpis[0]?.evidence.value).toBeUndefined()
  })

  it('maps supplied observations to measured evidence', () => {
    const contract = legacyGoalToOutcomeContract(legacyGoal(), {
      evidence: [{
        metric: 'overdue_count',
        source: 'goal_kpi_snapshots',
        observed_at: '2026-06-06T01:00:00.000Z',
        value: 4,
      }],
    })
    expect(contract.kpis[0]?.evidence).toMatchObject({
      state: 'measured',
      value: 4,
    })
  })

  it('requires legacy achieved goals to be reassessed', () => {
    expect(legacyGoalToOutcomeContract(legacyGoal('achieved')).lifecycle).toBe('measured')
  })

  it('declares missing connector providers without pretending readiness', () => {
    const disconnected = legacyGoalToOutcomeContract(legacyGoal())
    const connected = legacyGoalToOutcomeContract(legacyGoal(), { connected_providers: ['xero'] })

    expect(disconnected.required_capabilities[0]?.provider_id).toBeUndefined()
    expect(connected.required_capabilities[0]?.provider_id).toBe('xero')
    expect(connected.autonomy.permitted_capabilities).toEqual(['connector:xero'])
  })
})
