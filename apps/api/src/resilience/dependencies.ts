/**
 * Which figures each estimate reads, and a version per estimate (intent 94, selective invalidation).
 *
 * A confirmation is of exact figures. If one figure changes, only the estimates that read it need
 * confirming again; the others keep their confirmation. Pure: no I/O.
 */
import { createHash } from 'node:crypto'
import type { FactKey } from './fact-store.js'

export type Scenario = 'income_stops' | 'earner_dies'

export interface ScenarioFigure {
  key: FactKey
  valueMinor: number
}

/** The figures each estimate reads. Keep in step with `buildResilienceView`. */
export const SCENARIO_FACTS: Record<Scenario, readonly FactKey[]> = {
  income_stops: [
    'savings_minor',
    'monthly_spend_minor',
    'monthly_inflow_minor',
    'income_protection_monthly_minor',
  ],
  earner_dies: [
    'savings_minor',
    'monthly_spend_minor',
    'monthly_inflow_minor',
    'income_protection_monthly_minor',
    'life_cover_lump_sum_minor',
  ],
}

/** A hash of exactly the figures this estimate reads, in a fixed order, so order of input never matters. */
export function scenarioVersion(figures: readonly ScenarioFigure[], scenario: Scenario): string {
  const wanted = SCENARIO_FACTS[scenario]
  return createHash('sha256')
    .update(
      wanted
        .map((k) => figures.find((f) => f.key === k))
        .filter((f): f is ScenarioFigure => f !== undefined)
        .map((f) => `${f.key}=${f.valueMinor}`)
        .join(';'),
    )
    .digest('hex')
    .slice(0, 16)
}

/** The estimates a change to these figures touches. */
export function scenariosAffectedBy(changed: readonly FactKey[]): Scenario[] {
  return (Object.keys(SCENARIO_FACTS) as Scenario[]).filter((s) =>
    changed.some((k) => SCENARIO_FACTS[s].includes(k)),
  )
}
