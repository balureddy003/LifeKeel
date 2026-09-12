import { describe, it, expect, vi } from 'vitest'
import type { Collection } from 'mongodb'
import { findDuplicateGoal } from '../routes/goals.js'
import type { GoalDoc } from '../routes/goals.js'

// BUG-002 regression: duplicate goal documents with the same name but
// different IDs and disagreeing progress values. findDuplicateGoal is the
// safeguard called before insertOne in both POST /goals and
// POST /goals/compile/confirm — if it returns an existing goal, the handler
// returns it idempotently instead of creating a second document.

function mockCollection(docs: GoalDoc[]): Collection<GoalDoc> {
  return {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      return docs.find(d => {
        if (filter['tenant_id'] !== d.tenant_id) return false
        if (filter['name'] !== d.name) return false
        const statusFilter = filter['status'] as { $nin?: string[] } | undefined
        if (statusFilter?.$nin && statusFilter.$nin.includes(d.status)) return false
        return true
      }) ?? null
    }),
  } as unknown as Collection<GoalDoc>
}

describe('findDuplicateGoal', () => {
  const tenantId = 'tenant-1'

  it('returns an active goal with the same name for the tenant', async () => {
    const existing: GoalDoc = {
      id: 'goal-abc',
      tenant_id: tenantId,
      name: 'Grow Buy-to-Let Net Yield',
      timeline_days: 90,
      start_date: new Date(),
      target_date: new Date(),
      kpis: [],
      tags: [],
      detector_ids: [],
      at_risk_threshold: 0.4,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const col = mockCollection([existing])

    const result = await findDuplicateGoal(col, tenantId, 'Grow Buy-to-Let Net Yield')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('goal-abc')
  })

  it('returns null when no active goal with the same name exists', async () => {
    const col = mockCollection([])
    const result = await findDuplicateGoal(col, tenantId, 'New Goal')
    expect(result).toBeNull()
  })

  it('does not match archived goals (so re-creating an archived goal is allowed)', async () => {
    const archived: GoalDoc = {
      id: 'goal-old',
      tenant_id: tenantId,
      name: 'Grow Buy-to-Let Net Yield',
      timeline_days: 90,
      start_date: new Date(),
      target_date: new Date(),
      kpis: [],
      tags: [],
      detector_ids: [],
      at_risk_threshold: 0.4,
      status: 'archived',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const col = mockCollection([archived])

    const result = await findDuplicateGoal(col, tenantId, 'Grow Buy-to-Let Net Yield')

    expect(result).toBeNull()
  })

  it('does not match goals from a different tenant', async () => {
    const otherTenantGoal: GoalDoc = {
      id: 'goal-other',
      tenant_id: 'tenant-2',
      name: 'Grow Buy-to-Let Net Yield',
      timeline_days: 90,
      start_date: new Date(),
      target_date: new Date(),
      kpis: [],
      tags: [],
      detector_ids: [],
      at_risk_threshold: 0.4,
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const col = mockCollection([otherTenantGoal])

    const result = await findDuplicateGoal(col, tenantId, 'Grow Buy-to-Let Net Yield')

    expect(result).toBeNull()
  })

  it('does not match achieved goals', async () => {
    const achieved: GoalDoc = {
      id: 'goal-done',
      tenant_id: tenantId,
      name: 'Grow Buy-to-Let Net Yield',
      timeline_days: 90,
      start_date: new Date(),
      target_date: new Date(),
      kpis: [],
      tags: [],
      detector_ids: [],
      at_risk_threshold: 0.4,
      status: 'achieved',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const col = mockCollection([achieved])

    const result = await findDuplicateGoal(col, tenantId, 'Grow Buy-to-Let Net Yield')

    expect(result).toBeNull()
  })
})
