import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { InMemoryOutcomeRepository } from '@kairos/runtime'
import type { LegacyGoal } from '@kairos/legacy-compat'
import { LegacyGoalOutcomeBridge } from '../legacy-goal-outcome-bridge.js'

const goal: LegacyGoal = {
  id: 'goal-1',
  tenant_id: 'tenant-1',
  name: 'Grow presence',
  status: 'active',
  kpis: [{
    metric: 'followers',
    label: 'Followers',
    unit: 'followers',
    target: 100,
    current: 42,
    direction: 'increase',
    source: 'external_api',
  }],
  execution_plan: {
    enabled: true,
    required_connectors: ['twitter_x'],
  },
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-06T00:00:00.000Z'),
}

function fakeDb(): Db {
  const snapshots = [
    {
      tenant_id: 'tenant-1',
      goal_id: 'goal-1',
      metric: 'followers',
      value: 42,
      source: 'twitter_x',
      recorded_at: new Date('2026-06-06T01:00:00.000Z'),
    },
    {
      tenant_id: 'tenant-1',
      goal_id: 'goal-1',
      metric: 'followers',
      value: 30,
      source: 'twitter_x',
      recorded_at: new Date('2026-06-05T01:00:00.000Z'),
    },
  ]

  return {
    collection: (name: string) => {
      if (name === 'goals') {
        return {
          findOne: async () => goal,
          find: () => ({ toArray: async () => [goal] }),
        }
      }
      if (name === 'goal_kpi_snapshots') {
        return {
          find: () => ({
            sort: () => ({ toArray: async () => snapshots }),
          }),
        }
      }
      if (name === 'connector_credentials') {
        return { distinct: async () => ['twitter_x'] }
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
  } as unknown as Db
}

describe('LegacyGoalOutcomeBridge', () => {
  it('migrates latest evidence and connected providers into the repository', async () => {
    const repository = new InMemoryOutcomeRepository()
    const bridge = new LegacyGoalOutcomeBridge(fakeDb(), repository)
    const migrated = await bridge.migrateGoal('tenant-1', 'goal-1')

    expect(migrated?.kpis[0]?.evidence).toMatchObject({
      state: 'measured',
      value: 42,
      source: 'twitter_x',
    })
    expect(migrated?.required_capabilities[0]).toMatchObject({
      capability: 'connector:twitter_x',
      provider_id: 'twitter_x',
    })
    expect(await repository.get('tenant-1', 'goal-1')).toEqual(migrated)
  })
})
