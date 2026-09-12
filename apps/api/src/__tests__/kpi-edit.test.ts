/**
 * Tests for PATCH /goals/:id KPI update support.
 *
 * Verifies that the PATCH handler correctly merges incoming KPI fields
 * (especially target) into existing KPIs by metric name, instead of
 * silently dropping the kpis field.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'
import Fastify from 'fastify'

// Mock dependencies before importing the route
vi.mock('../lib/redis-cache.js', () => ({
  getCache: () => ({ delete: vi.fn(async () => {}) }),
}))
vi.mock('../goals/goal-detector-activations.js', () => ({
  refreshGoalDetectorActivations: vi.fn(async () => {}),
}))

const { registerGoalRoutes } = await import('../routes/goals.js')

const TEST_TENANT = 'tenant-kpi-edit-test'

let mockGoals: Array<Record<string, unknown>> = []
let mockGoalUpdates: Array<{ id: string; update: Record<string, unknown> }> = []

function makeMockDb() {
  const goalsCol = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      return mockGoals.find(g => g.id === filter.id && g.tenant_id === filter.tenant_id) ?? null
    }),
    findOneAndUpdate: vi.fn(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      const goal = mockGoals.find(g => g.id === filter.id && g.tenant_id === filter.tenant_id)
      if (!goal) return null
      const updated = { ...goal, ...update.$set }
      const idx = mockGoals.findIndex(g => g === goal)
      mockGoals[idx] = updated
      mockGoalUpdates.push({ id: filter.id as string, update: update.$set as Record<string, unknown> })
      return updated
    }),
    updateOne: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
    createIndex: vi.fn(async () => {}),
    countDocuments: vi.fn(async () => 0),
  }
  const snapshotsCol = { insertOne: vi.fn(async () => ({})), createIndex: vi.fn(async () => {}) }
  const projectionsCol = { createIndex: vi.fn(async () => {}) }
  const tenantsCol = { findOne: vi.fn(async () => ({ tier: 'free' })) }
  const signalsCol = { distinct: vi.fn(async () => []) }
  const connectorCol = { distinct: vi.fn(async () => []) }

  return {
    collection: vi.fn((name: string) => {
      if (name === 'goals') return goalsCol
      if (name === 'goal_kpi_snapshots') return snapshotsCol
      if (name === 'goal_projections') return projectionsCol
      if (name === 'tenants') return tenantsCol
      if (name === 'signals') return signalsCol
      if (name === 'connector_credentials') return connectorCol
      return { createIndex: vi.fn(async () => {}), insertOne: vi.fn(async () => ({})), updateOne: vi.fn(async () => ({})), findOne: vi.fn(async () => null) }
    }),
  }
}

function mockAuthContext(request: any) {
  request.authContext = { tenant_id: TEST_TENANT, user_id: 'user-1', roles: ['admin'] }
}

describe('PATCH /goals/:id — KPI target editing', () => {
  let app: any
  let mockDb: any

  beforeEach(() => {
    mockGoals = [{
      id: 'goal-1',
      tenant_id: TEST_TENANT,
      name: 'Test goal',
      description: 'Test',
      timeline_days: 90,
      start_date: new Date('2024-01-01'),
      target_date: new Date('2024-04-01'),
      kpis: [
        { metric: 'portfolio_value_minor', label: 'Portfolio value', unit: 'minor_currency', target: 446000, start_value: 0, current: 103888, direction: 'increase', source: 'manual' },
        { metric: 'concentration_score', label: 'Concentration', unit: '%', target: 30, start_value: 0, current: 45, direction: 'decrease', source: 'manual' },
      ],
      tags: [],
      detector_ids: [],
      status: 'active',
      at_risk_threshold: 0.4,
      created_at: new Date(),
      updated_at: new Date(),
    }]
    mockGoalUpdates = []
    mockDb = makeMockDb()
    app = Fastify()
    app.addHook('onRequest', async (request: any) => { mockAuthContext(request) })
    registerGoalRoutes(app, mockDb as any)
  })

  it('updates a KPI target via PATCH', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { kpis: [{ metric: 'portfolio_value_minor', target: 535200 }] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.goal.kpis[0].target).toBe(535200)
    // Other KPI should be unchanged
    expect(body.goal.kpis[1].target).toBe(30)
  })

  it('preserves existing KPI fields when only target is updated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { kpis: [{ metric: 'portfolio_value_minor', target: 535200 }] },
    })
    const body = JSON.parse(res.body)
    expect(body.goal.kpis[0].label).toBe('Portfolio value')
    expect(body.goal.kpis[0].unit).toBe('minor_currency')
    expect(body.goal.kpis[0].current).toBe(103888)
    expect(body.goal.kpis[0].direction).toBe('increase')
  })

  it('can update multiple KPIs at once', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: {
        kpis: [
          { metric: 'portfolio_value_minor', target: 535200 },
          { metric: 'concentration_score', target: 25 },
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.goal.kpis[0].target).toBe(535200)
    expect(body.goal.kpis[1].target).toBe(25)
  })

  it('returns 400 for invalid new KPI', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { kpis: [{ metric: '', target: 100 }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('still accepts non-kpis fields (name, description, etc.)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { name: 'Updated goal name', description: 'New description' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.goal.name).toBe('Updated goal name')
    expect(body.goal.description).toBe('New description')
  })

  it('removes a KPI via remove_kpis', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { remove_kpis: ['concentration_score'] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.goal.kpis).toHaveLength(1)
    expect(body.goal.kpis[0].metric).toBe('portfolio_value_minor')
  })

  it('returns 400 when trying to remove all KPIs', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { remove_kpis: ['portfolio_value_minor', 'concentration_score'] },
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error).toContain('at least one KPI')
  })

  it('can remove and edit KPIs in the same request', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: {
        remove_kpis: ['concentration_score'],
        kpis: [{ metric: 'portfolio_value_minor', target: 999999 }],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.goal.kpis).toHaveLength(1)
    expect(body.goal.kpis[0].metric).toBe('portfolio_value_minor')
    expect(body.goal.kpis[0].target).toBe(999999)
  })

  it('handles remove_kpis with non-existent metric gracefully', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/goals/goal-1',
      payload: { remove_kpis: ['nonexistent_metric'] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // Both KPIs should still be present (nothing was removed)
    expect(body.goal.kpis).toHaveLength(2)
  })
})
