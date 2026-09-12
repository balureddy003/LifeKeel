/**
 * Audience & Brand Growth detector rule tests
 *
 * Regression coverage for a real bug found while end-to-end testing the
 * audience-growth vertical: `threshold(context.adaptive_thresholds, 'key',
 * fallback)` never fires because filtrex's useDotAccessOperator throws (not
 * "returns undefined") for any missing nested key — which is the common case
 * for a per-metric adaptive threshold that hasn't accumulated history yet —
 * and evaluate() treats that thrown/Error-valued property access as "no
 * evidence" (false), so the fallback argument is unreachable. Both rules in
 * social_post_performance_spike silently never fired as a result. Fixed by
 * using a plain static threshold, matching the sibling detectors in this
 * same directory. See docs/prd/audience-growth-vertical.md for the writeup.
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { evaluate } from '../evaluator.js'

const DETECTORS_DIR = path.join(__dirname, '..', '..', '..', '..', 'detectors', 'social')

const FILENAME_MAP: Record<string, string> = {
  social_post_performance_spike: 'post-performance-spike.yaml',
  social_engagement_drop: 'engagement-drop.yaml',
}

async function loadDetector(id: string): Promise<{ rules: Array<{ id: string; condition: string }> }> {
  const filename = FILENAME_MAP[id]
  if (!filename) throw new Error(`Unknown social detector: ${id}`)
  const content = await fs.readFile(path.join(DETECTORS_DIR, filename), 'utf-8')
  return yaml.load(content) as any
}

function ruleById(detector: { rules: Array<{ id: string; condition: string }> }, ruleId: string) {
  const rule = detector.rules.find((r) => r.id === ruleId)
  if (!rule) throw new Error(`Rule not found: ${ruleId}`)
  return rule
}

describe('Audience & Brand Growth detectors', () => {
  describe('social_post_performance_spike', () => {
    it('fires engagement_spike_2sigma on a real published post with no adaptive-threshold history yet', async () => {
      const detector = await loadDetector('social_post_performance_spike')
      const rule = ruleById(detector, 'engagement_spike_2sigma')
      // Cold-start context — exactly what a brand-new tenant looks like:
      // no `adaptive_thresholds` key at all (not even an empty object).
      const fired = evaluate(rule.condition, {
        data: { engagement_rate: 0.5, impressions: 20000 },
        context: {},
      })
      expect(fired).toBe(true)
    })

    it('does not fire engagement_spike_2sigma on a typical low-engagement post', async () => {
      const detector = await loadDetector('social_post_performance_spike')
      const rule = ruleById(detector, 'engagement_spike_2sigma')
      const fired = evaluate(rule.condition, {
        data: { engagement_rate: 0.01, impressions: 500 },
        context: {},
      })
      expect(fired).toBe(false)
    })

    it('fires viral_threshold on 10x+ average impressions with no adaptive-threshold history yet', async () => {
      const detector = await loadDetector('social_post_performance_spike')
      const rule = ruleById(detector, 'viral_threshold')
      const fired = evaluate(rule.condition, {
        data: { impressions: 20000, engagement_rate: 0.5 },
        context: {},
      })
      expect(fired).toBe(true)
    })

    it('does not fire viral_threshold below the impressions bar', async () => {
      const detector = await loadDetector('social_post_performance_spike')
      const rule = ruleById(detector, 'viral_threshold')
      const fired = evaluate(rule.condition, {
        data: { impressions: 5200, engagement_rate: 0.12 },
        context: {},
      })
      expect(fired).toBe(false)
    })
  })

  describe('social_engagement_drop', () => {
    it('fires zero_engagement when a well-distributed post gets no engagement', async () => {
      const detector = await loadDetector('social_engagement_drop')
      const rule = ruleById(detector, 'zero_engagement')
      const fired = evaluate(rule.condition, {
        data: { impressions: 500, engagement_rate: 0 },
        context: {},
      })
      expect(fired).toBe(true)
    })

    it('does not fire zero_engagement when impressions are too low to be meaningful', async () => {
      const detector = await loadDetector('social_engagement_drop')
      const rule = ruleById(detector, 'zero_engagement')
      const fired = evaluate(rule.condition, {
        data: { impressions: 50, engagement_rate: 0 },
        context: {},
      })
      expect(fired).toBe(false)
    })
  })
})
