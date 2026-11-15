/**
 * Which figures each estimate reads, and a version per estimate. A changed figure only invalidates
 * the estimates that read it (intent 94, selective invalidation).
 */
import { describe, expect, it } from 'vitest'
import {
  SCENARIO_FACTS,
  scenarioVersion,
  scenariosAffectedBy,
  type ScenarioFigure,
} from '../dependencies.js'

const base: ScenarioFigure[] = [
  { key: 'savings_minor', valueMinor: 500_000 },
  { key: 'monthly_spend_minor', valueMinor: 200_000 },
  { key: 'monthly_inflow_minor', valueMinor: 300_000 },
  { key: 'income_protection_monthly_minor', valueMinor: 0 },
  { key: 'life_cover_lump_sum_minor', valueMinor: 1_200_000 },
]
const change = (key: string, valueMinor: number) =>
  base.map((f) => (f.key === key ? { ...f, valueMinor } : f))

describe('scenario dependencies', () => {
  it('income stops does not read the life cover amount; earner dies does', () => {
    expect(SCENARIO_FACTS.income_stops).not.toContain('life_cover_lump_sum_minor')
    expect(SCENARIO_FACTS.earner_dies).toContain('life_cover_lump_sum_minor')
  })

  it('changing life cover changes only the earner-dies version', () => {
    const next = change('life_cover_lump_sum_minor', 1_000_000)
    expect(scenarioVersion(next, 'income_stops')).toBe(scenarioVersion(base, 'income_stops'))
    expect(scenarioVersion(next, 'earner_dies')).not.toBe(scenarioVersion(base, 'earner_dies'))
  })

  it('changing savings changes both versions', () => {
    const next = change('savings_minor', 400_000)
    expect(scenarioVersion(next, 'income_stops')).not.toBe(scenarioVersion(base, 'income_stops'))
    expect(scenarioVersion(next, 'earner_dies')).not.toBe(scenarioVersion(base, 'earner_dies'))
  })

  it('does not depend on the order figures are given in', () => {
    expect(scenarioVersion([...base].reverse(), 'earner_dies')).toBe(
      scenarioVersion(base, 'earner_dies'),
    )
  })

  it('names the estimates a changed figure touches', () => {
    expect(scenariosAffectedBy(['life_cover_lump_sum_minor'])).toEqual(['earner_dies'])
    expect(scenariosAffectedBy(['savings_minor']).sort()).toEqual(['earner_dies', 'income_stops'])
    expect(scenariosAffectedBy([])).toEqual([])
  })
})
