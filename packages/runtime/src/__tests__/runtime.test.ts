import { describe, expect, it } from 'vitest'
import type {
  ActionReceipt,
  CapabilityProviderManifest,
  OutcomeContract,
} from '@lifekeel/specifications'
import {
  CapabilityRegistry,
  InMemoryActionReceiptRepository,
  InMemoryOutcomeRepository,
  type CapabilityProvider,
} from '../index.js'

function outcome(tenantId: string, id: string): OutcomeContract {
  return {
    api_version: 'lifekeel.io/v1',
    kind: 'OutcomeContract',
    id,
    tenant_id: tenantId,
    name: 'Runtime fixture',
    lifecycle: 'draft',
    kpis: [],
    required_capabilities: [],
    autonomy: {
      level: 'recommend_only',
      permitted_capabilities: [],
      approval_required_for: [],
      limits: {},
    },
    created_at: '2026-06-06T00:00:00.000Z',
    updated_at: '2026-06-06T00:00:00.000Z',
  }
}

function manifest(id: string): CapabilityProviderManifest {
  return {
    api_version: 'lifekeel.io/v1',
    kind: 'CapabilityProvider',
    id,
    version: '1.0.0',
    provides: ['social.publish'],
    deployment_profiles: ['personal', 'cloud'],
    outcome_contract_range: '>=1.0 <2.0',
  }
}

describe('CapabilityRegistry', () => {
  it('discovers providers by capability and deployment profile', () => {
    const registry = new CapabilityRegistry()
    const provider: CapabilityProvider = {
      manifest: manifest('social-provider'),
      execute: async () => { throw new Error('not used') },
    }
    registry.register(provider)

    expect(registry.find('social.publish', 'personal')).toEqual([provider])
    expect(registry.find('social.publish', 'edge')).toEqual([])
  })

  it('rejects duplicate provider identifiers', () => {
    const registry = new CapabilityRegistry()
    const provider: CapabilityProvider = {
      manifest: manifest('duplicate'),
      execute: async () => { throw new Error('not used') },
    }
    registry.register(provider)
    expect(() => registry.register(provider)).toThrow('already registered')
  })
})

describe('in-memory reference repositories', () => {
  it('isolates outcomes by tenant and returns clones', async () => {
    const repository = new InMemoryOutcomeRepository()
    await repository.save(outcome('tenant-a', 'goal-1'))
    await repository.save(outcome('tenant-b', 'goal-1'))

    const tenantA = await repository.list('tenant-a')
    expect(tenantA).toHaveLength(1)
    tenantA[0]!.name = 'mutated'
    expect((await repository.get('tenant-a', 'goal-1'))?.name).toBe('Runtime fixture')
  })

  it('enforces idempotency keys per tenant', async () => {
    const repository = new InMemoryActionReceiptRepository()
    const receipt: ActionReceipt = {
      api_version: 'lifekeel.io/v1',
      kind: 'ActionReceipt',
      id: 'receipt-1',
      tenant_id: 'tenant-a',
      goal_id: 'goal-1',
      cycle_id: 'cycle-1',
      plan_step_id: 'publish',
      idempotency_key: 'publish:goal-1:cycle-1',
      capability: 'social.publish',
      provider_id: 'social-provider',
      status: 'accepted',
      requested_at: '2026-06-06T00:00:00.000Z',
    }
    await repository.save(receipt)

    await expect(repository.save({ ...receipt, id: 'receipt-2' }))
      .rejects.toThrow('idempotency conflict')
  })
})
