import type {
  KpiDefinition,
  OutcomeAssessment,
  OutcomeContract,
  OutcomeLifecycleState,
  ReadinessCheck,
} from '@agentoak/specifications'

const TERMINAL_STATES = new Set<OutcomeLifecycleState>(['achieved', 'failed'])

const TRANSITIONS: Readonly<Record<OutcomeLifecycleState, readonly OutcomeLifecycleState[]>> = {
  draft: ['readiness_pending', 'paused'],
  readiness_pending: ['ready', 'blocked', 'failed', 'paused'],
  ready: ['executing', 'blocked', 'paused', 'failed'],
  executing: ['action_confirmed', 'at_risk', 'blocked', 'failed', 'paused'],
  action_confirmed: ['measuring', 'at_risk', 'blocked', 'failed'],
  measuring: ['measured', 'at_risk', 'blocked', 'failed', 'paused'],
  measured: ['adapting', 'at_risk', 'achieved', 'blocked', 'failed'],
  adapting: ['ready', 'at_risk', 'achieved', 'blocked', 'failed', 'paused'],
  at_risk: ['ready', 'executing', 'measuring', 'adapting', 'achieved', 'failed', 'paused'],
  achieved: [],
  paused: ['readiness_pending', 'ready', 'blocked', 'failed'],
  blocked: ['readiness_pending', 'ready', 'paused', 'failed'],
  failed: [],
}

export class InvalidOutcomeTransitionError extends Error {
  constructor(from: OutcomeLifecycleState, to: OutcomeLifecycleState) {
    super(`Invalid outcome lifecycle transition: ${from} -> ${to}`)
    this.name = 'InvalidOutcomeTransitionError'
  }
}

export function canTransition(from: OutcomeLifecycleState, to: OutcomeLifecycleState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function transitionOutcome(
  contract: OutcomeContract,
  to: OutcomeLifecycleState,
  updatedAt: string,
): OutcomeContract {
  if (!canTransition(contract.lifecycle, to)) {
    throw new InvalidOutcomeTransitionError(contract.lifecycle, to)
  }

  return {
    ...contract,
    lifecycle: to,
    updated_at: updatedAt,
  }
}

export function evaluateReadiness(contract: OutcomeContract): ReadinessCheck[] {
  const checks: ReadinessCheck[] = contract.required_capabilities.map(requirement => ({
    id: `capability:${requirement.capability}`,
    ready: !requirement.required || Boolean(requirement.provider_id),
    ...(!requirement.required || requirement.provider_id
      ? {}
      : { reason: `Required capability '${requirement.capability}' has no provider` }),
  }))

  checks.push({
    id: 'kpi:evidence-defined',
    ready: contract.kpis.length > 0,
    ...(contract.kpis.length > 0 ? {} : { reason: 'At least one KPI is required' }),
  })

  checks.push({
    id: 'policy:capabilities-covered',
    ready: contract.required_capabilities
      .filter(requirement => requirement.required)
      .every(requirement => contract.autonomy.permitted_capabilities.includes(requirement.capability)),
    reason: 'Autonomy policy must explicitly permit every required capability',
  })

  return checks
}

export function isReady(contract: OutcomeContract): boolean {
  return evaluateReadiness(contract).every(check => check.ready)
}

function isKpiAchieved(kpi: KpiDefinition): boolean {
  if (kpi.evidence.state !== 'measured' || kpi.evidence.value === undefined) return false

  const tolerance = kpi.tolerance ?? 0
  if (kpi.direction === 'increase') return kpi.evidence.value + tolerance >= kpi.target
  if (kpi.direction === 'decrease') return kpi.evidence.value - tolerance <= kpi.target
  return Math.abs(kpi.evidence.value - kpi.target) <= tolerance
}

export function assessOutcome(contract: OutcomeContract): OutcomeAssessment {
  const unknown = contract.kpis.filter(kpi => kpi.evidence.state !== 'measured')
  if (unknown.length > 0) {
    return {
      status: 'unknown',
      achieved_kpis: contract.kpis.filter(isKpiAchieved).map(kpi => kpi.id),
      pending_kpis: unknown.map(kpi => kpi.id),
      reason: 'Outcome cannot be assessed until every KPI has measured, current evidence',
    }
  }

  const achieved = contract.kpis.filter(isKpiAchieved)
  if (achieved.length === contract.kpis.length && contract.kpis.length > 0) {
    return {
      status: 'achieved',
      achieved_kpis: achieved.map(kpi => kpi.id),
      pending_kpis: [],
      reason: 'Every KPI target is satisfied by measured evidence',
    }
  }

  return {
    status: 'in_progress',
    achieved_kpis: achieved.map(kpi => kpi.id),
    pending_kpis: contract.kpis.filter(kpi => !isKpiAchieved(kpi)).map(kpi => kpi.id),
    reason: 'One or more KPI targets remain unsatisfied',
  }
}

export function isTerminal(state: OutcomeLifecycleState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isCertifiable(contract: OutcomeContract): boolean {
  return contract.lifecycle === 'achieved'
    && contract.kpis.length > 0
    && contract.kpis.every(kpi => kpi.evidence.state === 'measured' && Boolean(kpi.evidence.id) && kpi.evidence.value !== undefined)
}
