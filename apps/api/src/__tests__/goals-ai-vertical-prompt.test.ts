/**
 * Goal-refine vertical-prompt unit tests
 *
 * Regression guard for the data-driven verticalPromptFor() in
 * routes/goals-ai.ts. The previous implementation was a hardcoded if/else
 * over active_vertical with stale ids ('sme', 'real-estate', 'healthcare')
 * that matched no shipped vertical — so only 'trading-investment' ever
 * fired and four of five verticals got no LLM context in the goal compiler.
 *
 * This test asserts every shipped vertical id produces a non-empty prompt
 * containing its tagline, and that stale ids return '' (no silent
 * fallthrough to a dead branch).
 */
import { describe, it, expect } from 'vitest'
import { verticalPromptFor } from '../routes/goals-ai.js'
import { loadVerticals } from '@kairos/workflows'
import { repoRoot } from '@kairos/platform'

const SHIPPED_VERTICALS = loadVerticals(repoRoot())

describe('verticalPromptFor', () => {
  it('returns "" for undefined / null / unknown vertical ids', () => {
    expect(verticalPromptFor(undefined)).toBe('')
    expect(verticalPromptFor('' as string)).toBe('')
    // Stale ids from the old hardcoded if/else — must NOT match anything.
    expect(verticalPromptFor('sme')).toBe('')
    expect(verticalPromptFor('real-estate')).toBe('')
    expect(verticalPromptFor('healthcare')).toBe('')
  })

  it('returns a non-empty prompt containing the vertical tagline for every shipped vertical', () => {
    expect(SHIPPED_VERTICALS.length).toBeGreaterThanOrEqual(5)
    for (const v of SHIPPED_VERTICALS) {
      const prompt = verticalPromptFor(v.id)
      expect(prompt, `${v.id} should produce a non-empty prompt`).toBeTruthy()
      expect(prompt).toContain(v.tagline)
      expect(prompt).toContain(v.name)
    }
  })

  it('includes KPI vocabulary from the manifest', () => {
    const trading = SHIPPED_VERTICALS.find((v) => v.id === 'trading-investment')
    expect(trading).toBeDefined()
    const prompt = verticalPromptFor('trading-investment')
    // Trading vertical ships KPIs like 'Portfolio concentration', 'Dividend yield'.
    expect(prompt).toContain('KPIs from this vocabulary')
    // At least one KPI from the manifest should appear in the prompt.
    const anyKpi = trading!.kpi_vocabulary[0]
    expect(prompt).toContain(anyKpi)
  })

  it('includes jobs-to-be-done from the personas', () => {
    const branding = SHIPPED_VERTICALS.find((v) => v.id === 'branding-marketing')
    expect(branding).toBeDefined()
    const prompt = verticalPromptFor('branding-marketing')
    expect(prompt).toContain('jobs-to-be-done')
    // The branding-marketing vertical's personas have JTBD like "Qualify and
    // nurture new leads without manual CRM work" — at least one persona's
    // first JTBD should surface in the prompt.
    const anyJob = branding!.personas[0]!.jobs_to_be_done[0]
    expect(prompt).toContain(anyJob)
  })

  it('covers branding-marketing — the vertical that previously fell through to the generic prompt', () => {
    const prompt = verticalPromptFor('branding-marketing')
    expect(prompt).toContain('Branding & Marketing')
    expect(prompt).toContain('Run marketing on autopilot')
  })
})
