import type {
  OutcomeAssessment,
  OutcomeContract,
  OutcomeLifecycleState,
  ReadinessCheck,
} from '@lifekeel/specifications'
import type { MemoryRecord, MemoryRepository } from '@lifekeel/runtime'

export interface OutcomeKernelAdapter {
  canTransition(from: OutcomeLifecycleState, to: OutcomeLifecycleState): boolean
  transition(contract: OutcomeContract, to: OutcomeLifecycleState, updatedAt: string): OutcomeContract
  readiness(contract: OutcomeContract): ReadinessCheck[]
  assess(contract: OutcomeContract): OutcomeAssessment
}

export interface ConformanceResult {
  id: string
  passed: boolean
  detail?: string
}

export interface TenantScopedRepository<T> {
  get(tenantId: string, id: string): Promise<T | null>
  save(value: T): Promise<void>
  list(tenantId: string): Promise<T[]>
}

export async function runOutcomeRepositoryConformance(
  repository: TenantScopedRepository<OutcomeContract>,
): Promise<ConformanceResult[]> {
  const tenantA = fixture()
  const tenantB = { ...fixture(), tenant_id: 'other-tenant' }
  await repository.save(tenantA)
  await repository.save(tenantB)

  const listed = await repository.list(tenantA.tenant_id)
  const loaded = await repository.get(tenantA.tenant_id, tenantA.id)

  return [
    {
      id: 'repository.tenant-isolation',
      passed: listed.length === 1 && listed[0]?.tenant_id === tenantA.tenant_id,
    },
    {
      id: 'repository.round-trip',
      passed: loaded?.id === tenantA.id && loaded.tenant_id === tenantA.tenant_id,
    },
  ]
}

function fixture(): OutcomeContract {
  return {
    api_version: 'lifekeel.io/v1',
    kind: 'OutcomeContract',
    id: 'conformance-goal',
    tenant_id: 'conformance-tenant',
    name: 'Conformance fixture',
    lifecycle: 'draft',
    kpis: [{
      id: 'decrease-kpi',
      label: 'Decrease KPI',
      direction: 'decrease',
      target: 0,
      unit: 'count',
      evidence: {
        id: 'unknown-evidence',
        source: 'conformance',
        observed_at: '2026-06-06T00:00:00.000Z',
        state: 'unknown',
      },
    }],
    required_capabilities: [{
      capability: 'conformance.read',
      required: true,
    }],
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

export function runOutcomeKernelConformance(adapter: OutcomeKernelAdapter): ConformanceResult[] {
  const input = fixture()
  const results: ConformanceResult[] = []

  results.push({
    id: 'lifecycle.rejects-draft-to-achieved',
    passed: !adapter.canTransition('draft', 'achieved'),
  })

  results.push({
    id: 'lifecycle.at-risk-can-recover-or-resolve',
    passed: adapter.canTransition('measuring', 'at_risk')
      && adapter.canTransition('at_risk', 'measuring')
      && adapter.canTransition('at_risk', 'achieved')
      && adapter.canTransition('at_risk', 'failed'),
  })

  results.push({
    id: 'evidence.unknown-never-achieved',
    passed: adapter.assess(input).status === 'unknown',
  })

  results.push({
    id: 'readiness.missing-provider-blocks',
    passed: adapter.readiness(input).some(check => !check.ready),
  })

  const readyTransition = adapter.transition(input, 'readiness_pending', '2026-06-06T00:01:00.000Z')
  results.push({
    id: 'lifecycle.valid-transition-updates-state',
    passed: readyTransition.lifecycle === 'readiness_pending'
      && readyTransition.updated_at === '2026-06-06T00:01:00.000Z',
  })

  return results
}

function memoryFixture(overrides: Partial<MemoryRecord> & Pick<MemoryRecord, 'id' | 'embedding'>): MemoryRecord {
  return {
    tenant_id: 'conformance-tenant',
    scope_type: 'global',
    scope_id: 'default',
    memory_type: 'semantic',
    content: `memory ${overrides.id}`,
    content_hash: `hash-${overrides.id}`,
    metadata: {},
    tags: [],
    created_at: new Date('2026-06-06T00:00:00.000Z'),
    ...overrides,
  }
}

/**
 * ADR-0069 conformance: every `MemoryRepository` that advertises semantic
 * search must (a) persist semantic memories, (b) rank `query_embedding`
 * searches by nearest-neighbour using the shared cosine primitive, and
 * (c) never leak records across tenants. Running this against both the SQLite
 * (local) and MongoDB (cloud) adapters guarantees identical KNN ordering.
 */
export async function runMemoryVectorSearchConformance(
  repository: MemoryRepository,
): Promise<ConformanceResult[]> {
  const tenant = 'conformance-tenant'
  // Three orthogonal-ish unit vectors so nearest-neighbour ordering is obvious.
  const near = memoryFixture({ id: 'near', embedding: [1, 0, 0] })
  const mid = memoryFixture({ id: 'mid', embedding: [0.8, 0.6, 0] })
  const far = memoryFixture({ id: 'far', embedding: [0, 0, 1] })
  const otherTenant = memoryFixture({ id: 'other', tenant_id: 'other-tenant', embedding: [1, 0, 0] })

  let saved = true
  try {
    for (const record of [near, mid, far, otherTenant]) {
      // eslint-disable-next-line no-await-in-loop
      await repository.save(record)
    }
  } catch {
    saved = false
  }

  const ranked = await repository.search({ tenant_id: tenant, query_embedding: [1, 0, 0], limit: 3 })
  const topTwo = await repository.search({ tenant_id: tenant, query_embedding: [1, 0, 0], limit: 2 })

  return [
    {
      id: 'memory.semantic-persisted',
      passed: saved,
      ...(saved ? {} : { detail: 'save() rejected a semantic memory record' }),
    },
    {
      id: 'memory.vector-knn-ordering',
      passed: ranked.map(record => record.id).join(',') === 'near,mid,far',
      detail: `got: ${ranked.map(record => record.id).join(',')}`,
    },
    {
      id: 'memory.vector-respects-limit',
      passed: topTwo.length === 2 && topTwo[0]?.id === 'near' && topTwo[1]?.id === 'mid',
    },
    {
      id: 'memory.vector-tenant-isolation',
      passed: ranked.every(record => record.tenant_id === tenant),
    },
  ]
}
