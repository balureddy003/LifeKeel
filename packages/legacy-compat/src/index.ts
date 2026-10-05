import type {
  EvidenceState,
  Goal,
  OutcomeLifecycleState,
} from '@lifekeel/specifications'

/** @deprecated Import Goal from @lifekeel/specifications in new code. */
export type OutcomeContract = Goal

export interface LegacyKpi {
  metric: string
  label: string
  unit: string
  target: number
  current: number
  direction: 'increase' | 'decrease'
  source?: 'signals' | 'external_api' | 'manual'
}

export interface LegacyExecutionPlan {
  enabled?: boolean
  required_connectors?: string[]
}

export interface LegacyGoal {
  id: string
  tenant_id: string
  name: string
  description?: string
  status: 'active' | 'achieved' | 'stalled' | 'archived'
  kpis: LegacyKpi[]
  execution_plan?: LegacyExecutionPlan
  created_at: Date | string
  updated_at: Date | string
}

export interface LegacyEvidenceObservation {
  metric: string
  source: string
  observed_at: Date | string
  state?: EvidenceState
  value?: number
  confidence?: number
  expires_at?: Date | string
}

export interface LegacyGoalConversionOptions {
  evidence?: LegacyEvidenceObservation[]
  connected_providers?: string[]
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function legacyLifecycle(status: LegacyGoal['status']): OutcomeLifecycleState {
  if (status === 'archived') return 'paused'
  if (status === 'stalled') return 'blocked'
  // Legacy achievement is re-assessed from measured evidence by the Outcome Kernel.
  if (status === 'achieved') return 'measured'
  return 'readiness_pending'
}

export function legacyGoalToOutcomeContract(
  goal: LegacyGoal,
  options: LegacyGoalConversionOptions = {},
): Goal {
  const observations = new Map((options.evidence ?? []).map(item => [item.metric, item]))
  const connected = new Set(options.connected_providers ?? [])
  const requiredConnectors = goal.execution_plan?.required_connectors ?? []
  const requiredCapabilities = requiredConnectors.map(connector => ({
    capability: `connector:${connector}`,
    required: true,
    ...(connected.has(connector) ? { provider_id: connector } : {}),
  }))
  const permittedCapabilities = requiredCapabilities
    .filter(capability => capability.provider_id)
    .map(capability => capability.capability)

  return {
    api_version: 'lifekeel.io/v1',
    kind: 'OutcomeContract',
    id: goal.id,
    tenant_id: goal.tenant_id,
    name: goal.name,
    ...(goal.description ? { description: goal.description } : {}),
    lifecycle: legacyLifecycle(goal.status),
    kpis: goal.kpis.map(kpi => {
      const observation = observations.get(kpi.metric)
      const evidenceState = observation?.state
        ?? (observation?.value === undefined ? 'unknown' : 'measured')

      const evidenceBase: any = {
        id: `${goal.id}:${kpi.metric}:latest`,
        source: observation?.source ?? kpi.source ?? 'legacy',
        state: evidenceState,
        ...(observation?.value !== undefined ? { value: observation.value } : {}),
        ...(observation?.confidence !== undefined ? { confidence: observation.confidence } : {}),
        ...(observation?.expires_at ? { expires_at: iso(observation.expires_at) } : {}),
      }

      // Per ADR guidance, do not populate `observed_at` for unknown evidence —
      // preserve absence semantics so consumers can treat unknown as truly unknown.
      if (evidenceState !== 'unknown') {
        evidenceBase.observed_at = observation ? iso(observation.observed_at) : iso(goal.updated_at)
      }

      return {
        id: kpi.metric,
        label: kpi.label,
        direction: kpi.direction,
        target: kpi.target,
        unit: kpi.unit,
        evidence: evidenceBase,
      }
    }),
    required_capabilities: requiredCapabilities,
    autonomy: {
      level: goal.execution_plan?.enabled ? 'review_required' : 'recommend_only',
      permitted_capabilities: permittedCapabilities,
      approval_required_for: permittedCapabilities,
      limits: {},
    },
    created_at: iso(goal.created_at),
    updated_at: iso(goal.updated_at),
  }
}

/** Canonical conversion name for new code. */
export const legacyGoalToGoal = legacyGoalToOutcomeContract
