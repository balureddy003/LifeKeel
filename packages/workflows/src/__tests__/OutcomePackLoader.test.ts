/**
 * Tests for the Outcome Pack Loader.
 *
 * B1 (GOAL_PROGRESS_AND_UX_GAPS.md): verifies that the 5 new goal-oriented
 * trading packs load and validate against the schema, and that all
 * referenced connectors, detectors, and workflows exist in the codebase.
 */
import { describe, expect, it } from 'vitest'
import { loadOutcomePacks } from '../loader/OutcomePackLoader.js'
import { repoRoot } from '@kairos/platform'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = repoRoot()

describe('loadOutcomePacks', () => {
  const packs = loadOutcomePacks(ROOT)
  const packIds = packs.map(p => p.id)

  it('loads all 14 packs (8 original + 5 new B1 packs + 1 family-protection pack)', () => {
    expect(packs.length).toBe(14)
  })

  it('loads the 5 new B1 goal-oriented trading packs', () => {
    const newPackIds = ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals']
    for (const id of newPackIds) {
      expect(packIds).toContain(id)
    }
  })

  it('all new packs have goal-oriented categories (not "custom")', () => {
    const newPacks = packs.filter(p =>
      ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals'].includes(p.id)
    )
    for (const pack of newPacks) {
      expect(pack.category).not.toBe('custom')
      expect(['wealth_growth', 'portfolio_protection', 'opportunity_discovery', 'trading_decisions', 'goal_tracking'])
        .toContain(pack.category)
    }
  })

  it('all new packs reference only real connectors', () => {
    const connectorDir = path.join(ROOT, 'connectors')
    const realConnectors = fs.readdirSync(connectorDir)
      .filter(f => f.endsWith('.yaml'))
      .map(f => f.replace('.yaml', ''))
    const newPacks = packs.filter(p =>
      ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals'].includes(p.id)
    )
    for (const pack of newPacks) {
      for (const connectorId of pack.required_connectors) {
        expect(realConnectors).toContain(connectorId)
      }
      for (const connectorId of pack.optional_connectors) {
        expect(realConnectors).toContain(connectorId)
      }
    }
  })

  it('all new packs reference only real detectors', () => {
    // Collect all detector IDs from detectors/ directory (recursively)
    const detectorDir = path.join(ROOT, 'detectors')
    const realDetectorIds: string[] = []
    function scanDir(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanDir(path.join(dir, entry.name))
        } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8')
          const idMatch = content.match(/^id:\s*(.+)$/m)
          if (idMatch && idMatch[1]) realDetectorIds.push(idMatch[1].trim())
        }
      }
    }
    scanDir(detectorDir)
    const newPacks = packs.filter(p =>
      ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals'].includes(p.id)
    )
    for (const pack of newPacks) {
      for (const detectorId of pack.included_detectors) {
        expect(realDetectorIds).toContain(detectorId)
      }
    }
  })

  it('all new packs reference only real workflows', () => {
    const workflowDir = path.join(ROOT, 'definitions', 'workflows')
    const realWorkflowIds: string[] = []
    for (const file of fs.readdirSync(workflowDir).filter(f => f.endsWith('.yaml'))) {
      const content = fs.readFileSync(path.join(workflowDir, file), 'utf-8')
      const idMatch = content.match(/^id:\s*(.+)$/m)
      if (idMatch && idMatch[1]) realWorkflowIds.push(idMatch[1].trim())
    }
    const newPacks = packs.filter(p =>
      ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals'].includes(p.id)
    )
    for (const pack of newPacks) {
      for (const workflowId of pack.included_workflows) {
        expect(realWorkflowIds).toContain(workflowId)
      }
    }
  })

  it('all new packs have tier_minimum "individual" (trading is individual-tier)', () => {
    const newPacks = packs.filter(p =>
      ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals'].includes(p.id)
    )
    for (const pack of newPacks) {
      expect(pack.tier_minimum).toBe('individual')
    }
  })

  it('all new packs have non-empty kpi_labels', () => {
    const newPacks = packs.filter(p =>
      ['grow-wealth', 'protect-portfolio', 'find-opportunities', 'improve-trading', 'track-goals'].includes(p.id)
    )
    for (const pack of newPacks) {
      expect(pack.kpi_labels.length).toBeGreaterThan(0)
    }
  })
})
