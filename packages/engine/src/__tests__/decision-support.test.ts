/**
 * Tests for Decision Support Quality fields (items 02/03):
 * alternatives_template, risk_template, exit_criteria_template in detector
 * YAMLs, and alternatives/risk_assessment/exit_criteria in the Trigger schema.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { DetectorConfigSchema, TriggerSchema } from '../schemas.js'

const DETECTORS_DIR = path.join(__dirname, '..', '..', '..', '..', 'detectors', 'trading')

const TRADING_DETECTORS = [
  'concentration-risk.yaml',
  'price-drop-alert.yaml',
  'rebalance-suggestion.yaml',
  'dividend-opportunity.yaml',
]

describe('Decision Support Quality: detector YAML fields', () => {
  for (const filename of TRADING_DETECTORS) {
    describe(filename, () => {
      it('parses against DetectorConfigSchema with new template fields', async () => {
        const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
        const raw = yaml.load(content)
        const parsed = DetectorConfigSchema.safeParse(raw)
        expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)).toBe(true)
      })

      it('has alternatives_template with at least 2 options', async () => {
        const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
        const raw = yaml.load(content) as any
        for (const rule of raw.rules) {
          expect(rule.alternatives_template, `${filename} rule ${rule.id} missing alternatives_template`).toBeDefined()
          expect(rule.alternatives_template.length, `${filename} rule ${rule.id} needs at least 2 alternatives`).toBeGreaterThanOrEqual(2)
          for (const alt of rule.alternatives_template) {
            expect(alt.label, `${filename} alternative missing label`).toBeTruthy()
          }
        }
      })

      it('has risk_template', async () => {
        const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
        const raw = yaml.load(content) as any
        for (const rule of raw.rules) {
          expect(rule.risk_template, `${filename} rule ${rule.id} missing risk_template`).toBeTruthy()
        }
      })

      it('has exit_criteria_template', async () => {
        const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
        const raw = yaml.load(content) as any
        for (const rule of raw.rules) {
          expect(rule.exit_criteria_template, `${filename} rule ${rule.id} missing exit_criteria_template`).toBeTruthy()
        }
      })
    })
  }
})

describe('Decision Support Quality: Trigger schema', () => {
  it('accepts alternatives, risk_assessment, and exit_criteria', () => {
    const insight = TriggerSchema.parse({
      id: 'test-1',
      tenant_id: 'tenant-1',
      hypothesis: 'test_hypothesis',
      category: 'risk',
      urgency: 'high',
      estimated_impact_low: 0,
      estimated_impact_high: 10000,
      reasoning: 'Test reasoning',
      actions: ['Review'],
      alternatives: [
        { label: 'Option A', why_not: 'Too expensive', forecast_low: -1000, forecast_high: 5000 },
        { label: 'Option B', why_not: 'Too slow' },
      ],
      risk_assessment: 'Downside risk is significant.',
      exit_criteria: 'Auto-archive when price recovers.',
      confidence_breakdown: {
        or_score: 0.85,
        combined_score: 0.85,
        model_version: 'test@1.0.0',
        evidence_refs: ['event-1'],
      },
      detector_id: 'test_detector',
      rule_id: 'test_rule',
    })
    expect(insight.alternatives).toHaveLength(2)
    expect(insight.alternatives![0]!.label).toBe('Option A')
    expect(insight.alternatives![0]!.why_not).toBe('Too expensive')
    expect(insight.risk_assessment).toBe('Downside risk is significant.')
    expect(insight.exit_criteria).toBe('Auto-archive when price recovers.')
  })

  it('accepts insights without the new fields (backward compatibility)', () => {
    const insight = TriggerSchema.parse({
      id: 'test-2',
      tenant_id: 'tenant-1',
      hypothesis: 'test_hypothesis',
      category: 'risk',
      urgency: 'low',
      estimated_impact_low: 0,
      estimated_impact_high: 1000,
      reasoning: 'Test',
      actions: [],
      confidence_breakdown: {
        or_score: 0.85,
        combined_score: 0.85,
        model_version: 'test@1.0.0',
        evidence_refs: ['event-1'],
      },
      detector_id: 'test_detector',
      rule_id: 'test_rule',
    })
    expect(insight.alternatives).toBeUndefined()
    expect(insight.risk_assessment).toBeUndefined()
    expect(insight.exit_criteria).toBeUndefined()
  })
})
