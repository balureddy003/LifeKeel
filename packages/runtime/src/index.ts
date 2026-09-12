import type {
  ActionReceipt,
  AutonomyPolicy,
  CapabilityProviderManifest,
  Goal,
  OutcomeContract,
} from '@kairos/specifications'

export type DeploymentProfile = 'personal' | 'team' | 'edge' | 'cloud' | 'federated'

export interface OutcomeRepository {
  get(tenantId: string, outcomeId: string): Promise<OutcomeContract | null>
  save(contract: OutcomeContract): Promise<void>
  list(tenantId: string): Promise<OutcomeContract[]>
}

/** Canonical repository name. OutcomeRepository remains for compatibility. */
export type GoalRepository = OutcomeRepository

export interface ActionReceiptRepository {
  getByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ActionReceipt | null>
  save(receipt: ActionReceipt): Promise<void>
}

export interface CapabilityAction {
  tenant_id: string
  goal_id: string
  cycle_id: string
  plan_step_id: string
  capability: string
  idempotency_key: string
  input: Record<string, unknown>
}

export interface CapabilityProvider {
  manifest: CapabilityProviderManifest
  execute(action: CapabilityAction): Promise<ActionReceipt>
}

export interface PolicyDecision {
  allowed: boolean
  approval_required: boolean
  reasons: string[]
}

export interface PolicyProvider {
  evaluate(policy: AutonomyPolicy, action: CapabilityAction): Promise<PolicyDecision>
}

export interface ExecutionHandle {
  id: string
  status: 'accepted' | 'running' | 'waiting' | 'completed' | 'failed'
}

export interface ExecutionProvider {
  start(goal: Goal): Promise<ExecutionHandle>
  signal(executionId: string, signal: string, payload: Record<string, unknown>): Promise<void>
  get(executionId: string): Promise<ExecutionHandle | null>
}

export interface TelemetryProvider {
  event(name: string, attributes: Record<string, string | number | boolean>): void
}

export interface Clock {
  now(): string
}

export type MemoryScopeType = 'goal' | 'workflow' | 'detector' | 'global'
export type MemoryType = 'working' | 'episodic' | 'semantic'

export interface MemoryRecord {
  id: string
  tenant_id: string
  scope_type: MemoryScopeType
  scope_id: string
  memory_type: MemoryType
  content: string
  content_hash: string
  metadata: Record<string, unknown>
  embedding?: number[]
  tags: string[]
  created_at: Date
  expires_at?: Date
}

export interface MemoryQuery {
  tenant_id: string
  scope_type?: MemoryScopeType
  scope_id?: string
  memory_types?: MemoryType[]
  tags?: string[]
  query_text?: string
  query_embedding?: number[]
  limit?: number
}

export interface MemoryRepository {
  save(record: MemoryRecord): Promise<void>
  get(tenantId: string, id: string): Promise<MemoryRecord | null>
  search(query: MemoryQuery): Promise<MemoryRecord[]>
}

// ── ADR-0067 offline-first repository ports ──────────────────────────────────

export interface InsightRecord {
  id: string
  tenant_id: string
  detector_id: string
  state: string
  created_at: Date
  [key: string]: unknown
}

export interface InsightRepository {
  get(tenantId: string, insightId: string): Promise<InsightRecord | null>
  save(insight: InsightRecord): Promise<void>
  list(tenantId: string): Promise<InsightRecord[]>
}

export interface WorkflowRecord {
  id: string
  tenant_id: string
  name: string
  created_at: Date
  updated_at: Date
  [key: string]: unknown
}

export interface WorkflowRepository {
  get(tenantId: string, workflowId: string): Promise<WorkflowRecord | null>
  create(workflow: WorkflowRecord): Promise<void>
  list(tenantId: string): Promise<WorkflowRecord[]>
}

export interface DetectorRecord {
  id: string
  tenant_id: string
  name: string
  enabled: boolean
  created_at: Date
  updated_at: Date
  [key: string]: unknown
}

export interface DetectorRepository {
  get(tenantId: string, detectorId: string): Promise<DetectorRecord | null>
  save(detector: DetectorRecord): Promise<void>
  list(tenantId: string): Promise<DetectorRecord[]>
  delete(tenantId: string, detectorId: string): Promise<void>
}

export interface AuditLogEntry {
  id: string
  tenant_id: string
  action: string
  actor_id: string
  timestamp: Date
  details: Record<string, unknown>
}

export interface AuditLogRepository {
  append(entry: AuditLogEntry): Promise<void>
  list(tenantId: string, options?: { limit?: number; offset?: number }): Promise<AuditLogEntry[]>
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  similarity(a: number[], b: number[]): number
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 when either
 * vector has zero magnitude or the lengths differ. This is the single shared
 * ranking primitive used by every vector-search adapter (SQLite, MongoDB, ...)
 * so that local and cloud deployments rank identical inputs identically
 * (ADR-0069 local parity).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let aNorm = 0
  let bNorm = 0
  for (let index = 0; index < a.length; index++) {
    const av = a[index]!
    const bv = b[index]!
    dot += av * bv
    aNorm += av ** 2
    bNorm += bv ** 2
  }
  return aNorm && bNorm ? dot / Math.sqrt(aNorm * bNorm) : 0
}

export interface VectorMatch<T> {
  item: T
  score: number
}

/**
 * Deterministic exact (brute-force) k-nearest-neighbour search. Used for
 * on-device datasets (ADR-0069: "local vector search uses exact/brute KNN")
 * and as the reference ranking the cloud ANN path must match within tolerance.
 *
 * Candidates whose embedding is missing or dimensionally mismatched are
 * skipped. Ties are broken deterministically by the order candidates were
 * supplied, so repeated calls over the same input return a stable ordering.
 */
export function bruteKnnSearch<T>(
  candidates: readonly T[],
  queryEmbedding: number[],
  getEmbedding: (item: T) => number[] | undefined,
  limit = 10,
): VectorMatch<T>[] {
  const scored: Array<VectorMatch<T> & { order: number }> = []
  for (let order = 0; order < candidates.length; order++) {
    const item = candidates[order]!
    const embedding = getEmbedding(item)
    if (!embedding || embedding.length !== queryEmbedding.length) continue
    scored.push({ item, score: cosineSimilarity(embedding, queryEmbedding), order })
  }
  scored.sort((a, b) => (b.score - a.score) || (a.order - b.order))
  return scored.slice(0, Math.max(0, limit)).map(({ item, score }) => ({ item, score }))
}

export interface AgentCheckpoint<State = Record<string, unknown>> {
  thread_id: string
  state: State
  iteration: number
  updated_at: Date
}

export interface AgentCheckpointer<State = Record<string, unknown>> {
  load(threadId: string): Promise<AgentCheckpoint<State> | null>
  save(checkpoint: AgentCheckpoint<State>): Promise<void>
}

export class CapabilityRegistry {
  private readonly providers = new Map<string, CapabilityProvider>()

  register(provider: CapabilityProvider): void {
    if (this.providers.has(provider.manifest.id)) {
      throw new Error(`Capability provider '${provider.manifest.id}' is already registered`)
    }
    this.providers.set(provider.manifest.id, provider)
  }

  get(providerId: string): CapabilityProvider | null {
    return this.providers.get(providerId) ?? null
  }

  find(capability: string, profile: DeploymentProfile): CapabilityProvider[] {
    return [...this.providers.values()].filter(provider =>
      provider.manifest.provides.includes(capability)
      && provider.manifest.deployment_profiles.includes(profile),
    )
  }
}

export class InMemoryOutcomeRepository implements OutcomeRepository {
  private readonly contracts = new Map<string, OutcomeContract>()

  async get(tenantId: string, outcomeId: string): Promise<OutcomeContract | null> {
    return structuredClone(this.contracts.get(this.key(tenantId, outcomeId)) ?? null)
  }

  async save(contract: OutcomeContract): Promise<void> {
    this.contracts.set(this.key(contract.tenant_id, contract.id), structuredClone(contract))
  }

  async list(tenantId: string): Promise<OutcomeContract[]> {
    return [...this.contracts.values()]
      .filter(contract => contract.tenant_id === tenantId)
      .map(contract => structuredClone(contract))
  }

  private key(tenantId: string, outcomeId: string): string {
    return `${tenantId}:${outcomeId}`
  }
}

export class InMemoryActionReceiptRepository implements ActionReceiptRepository {
  private readonly receipts = new Map<string, ActionReceipt>()

  async getByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<ActionReceipt | null> {
    return structuredClone(this.receipts.get(this.key(tenantId, idempotencyKey)) ?? null)
  }

  async save(receipt: ActionReceipt): Promise<void> {
    const key = this.key(receipt.tenant_id, receipt.idempotency_key)
    const existing = this.receipts.get(key)
    if (existing && existing.id !== receipt.id) {
      throw new Error(`Action receipt idempotency conflict for '${receipt.idempotency_key}'`)
    }
    this.receipts.set(key, structuredClone(receipt))
  }

  private key(tenantId: string, idempotencyKey: string): string {
    return `${tenantId}:${idempotencyKey}`
  }
}
