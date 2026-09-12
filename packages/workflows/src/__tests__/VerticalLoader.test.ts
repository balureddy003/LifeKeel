/**
 * VerticalLoader unit tests
 *
 * The loader resolves content against a rootDir (default process.cwd()); these
 * tests pass the repo root explicitly (four levels up from this file).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { loadVerticals, loadVertical, checkVerticalReferences, findOrphanedContent, findThinPersonas } from '../loader/VerticalLoader.js'

/** Walk up from cwd to the workspace root (holds pnpm-workspace.yaml). */
function findRepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

const REPO_ROOT = findRepoRoot()

describe('VerticalLoader', () => {
  it('loads the shipped vertical manifests', () => {
    const ids = loadVerticals(REPO_ROOT).map((v) => v.id)
    expect(ids).toContain('property-wealth')
    expect(ids).toContain('smb-operations')
    expect(ids).toContain('trading-investment')
    expect(ids).toContain('audience-growth')
  })

  it('loads a single vertical by id with its personas', () => {
    const v = loadVertical('property-wealth', REPO_ROOT)
    expect(v).not.toBeNull()
    expect(v!.personas.length).toBeGreaterThanOrEqual(3)
    expect(v!.personas.map((p) => p.id)).toContain('investor')
  })

  it('loads the trading-investment vertical with four personas', () => {
    const v = loadVertical('trading-investment', REPO_ROOT)
    expect(v).not.toBeNull()
    expect(v!.personas.length).toBe(4)
    expect(v!.personas.map((p) => p.id)).toContain('self-directed-investor')
    expect(v!.personas.map((p) => p.id)).toContain('elss-sip-investor')
    expect(v!.required_connectors).toContain('trading-212')
    expect(v!.required_connectors).toContain('zerodha')
    expect(v!.detectors).toContain('trading_concentration_risk')
  })

  it('loads the audience-growth vertical with individual and business personas', () => {
    const v = loadVertical('audience-growth', REPO_ROOT)
    expect(v).not.toBeNull()
    expect(v!.tier_minimum).toBe('individual')
    expect(v!.personas.map((p) => p.id)).toContain('creator')
    expect(v!.personas.map((p) => p.id)).toContain('brand-marketer')
    expect(v!.required_connectors).toContain('postiz')
    expect(v!.detectors).toContain('social_engagement_drop')
    expect(v!.outcome_packs).toContain('audience-growth')
  })

  it('returns null for an unknown vertical id', () => {
    expect(loadVertical('does-not-exist', REPO_ROOT)).toBeNull()
  })

  it('loads the branding-marketing vertical with marketer and founder personas', () => {
    const v = loadVertical('branding-marketing', REPO_ROOT)
    expect(v).not.toBeNull()
    expect(v!.tier_minimum).toBe('individual')
    expect(v!.personas.map((p) => p.id)).toContain('growth-marketer')
    expect(v!.personas.map((p) => p.id)).toContain('founder-operator')
    // Dogfooding: Kairos's own daily-content engine is bundled as a workflow.
    expect(v!.workflows).toContain('marketing_kairos_social_presence')
    expect(v!.workflows).toContain('marketing_kairos_x_daily_capability')
    // Every persona has a starting goal template (no thin personas introduced).
    expect(v!.personas.every((p) => p.primary_goal_templates.length > 0)).toBe(true)
    expect(v!.required_connectors).toContain('postiz')
    expect(v!.outcome_packs).toContain('revenue-optimisation')
    expect(v!.outcome_packs).toContain('customer-experience')
    expect(v!.outcome_packs).toContain('audience-growth')
  })

  it('every shipped vertical passes the referential-integrity check', () => {
    const verticals = loadVerticals(REPO_ROOT)
    expect(verticals.length).toBeGreaterThanOrEqual(2)
    for (const v of verticals) {
      expect(checkVerticalReferences(v, REPO_ROOT), `${v.id} has dangling references`).toEqual([])
    }
  })

  it('flags dangling references on a hand-built broken vertical', () => {
    const missing = checkVerticalReferences({
      id: 'broken',
      name: 'Broken',
      tagline: 't',
      status: 'alpha',
      personas: [],
      required_connectors: ['nope-connector'],
      optional_connectors: [],
      detectors: ['nope_detector'],
      outcome_packs: ['nope-pack'],
      goal_templates: [],
      workflows: [],
      kpi_vocabulary: [],
      kpi_vocabulary_by_country: {},
      tier_minimum: 'smb',
      supported_countries: [],
    }, REPO_ROOT)
    expect(missing).toContain('detector:nope_detector')
    expect(missing).toContain('outcome_pack:nope-pack')
    expect(missing).toContain('connector:nope-connector')
  })

  // Known-orphan allowlist, checked for exact match rather than "at most" —
  // this keeps the list honest: assign one of these to a vertical and this
  // test fails until you update the list, so removals can't go unnoticed
  // any more than additions can.
  it('has no undocumented orphaned outcome packs or goal templates', () => {
    // audience-growth (pack), social-x-growth and reputation-reviews (templates)
    // are now claimed by the audience-growth vertical — see verticals/audience-growth/.
    const KNOWN_ORPHANED_PACKS = ['churn-rescue', 'operational-efficiency']
    const KNOWN_ORPHANED_TEMPLATES = ['protect-cash-flow']
    const orphans = findOrphanedContent(REPO_ROOT)
    expect(orphans.outcome_packs.sort()).toEqual(KNOWN_ORPHANED_PACKS.sort())
    expect(orphans.goal_templates.sort()).toEqual(KNOWN_ORPHANED_TEMPLATES.sort())
  })

  it('has no undocumented thin personas (empty primary_goal_templates)', () => {
    const KNOWN_THIN_PERSONAS = ['property-wealth:home-owner']
    const thin = loadVerticals(REPO_ROOT).flatMap((v) => findThinPersonas(v))
    expect(thin.sort()).toEqual(KNOWN_THIN_PERSONAS.sort())
  })

  // Skipped: cross-checks against apps/studio's Storybook fixtures, which
  // is a separate frontend app not part of this repo's copy (AgentOak has
  // no apps/studio). Not applicable here, not a bug.
  it.skip('keeps Shell / Vertical Theming fixtures aligned with shipped manifests', () => {
    const fixtureSource = fs.readFileSync(
      path.join(REPO_ROOT, 'apps', 'studio', 'src', 'stories', '_mock', 'fixtures.ts'),
      'utf-8',
    )
    const fixtureNames: Record<string, string> = {
      'trading-investment': 'TradingInvestment',
      'smb-operations': 'SmbOperations',
      'property-wealth': 'PropertyWealth',
      'audience-growth': 'AudienceGrowth',
      'branding-marketing': 'BrandingMarketing',
      'family': 'Family',
    }

    for (const vertical of loadVerticals(REPO_ROOT)) {
      const fixtureName = fixtureNames[vertical.id]
      expect(fixtureName, `missing fixture mapping for ${vertical.id}`).toBeTruthy()
      const match = fixtureSource.match(new RegExp(`export const mockVertical${fixtureName} = \\{([\\s\\S]*?)\\n\\}`))
      expect(match, `missing mockVertical${fixtureName} fixture`).not.toBeNull()
      const fixture = match![0]
      expect(fixture).toContain(`accent_token: '${vertical.theme?.accent_token}'`)
      expect(fixture).toContain(`entity_noun: '${vertical.theme?.entity_noun}'`)
      for (const kpi of vertical.kpi_vocabulary) expect(fixture).toContain(`'${kpi}'`)
    }
  })
})
