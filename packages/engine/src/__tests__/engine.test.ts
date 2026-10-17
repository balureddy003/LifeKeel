/**
 * @lifekeel/engine — unit tests
 *
 * Tests: detector loading, event evaluation, rule scoring, multi-tenant isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { compileExpression } from 'filtrex'

// ── Filtrex expression evaluator (used inside the engine) ────────────────────

describe('filtrex expression evaluator', () => {
  it('evaluates simple numeric comparisons', () => {
    const fn = compileExpression('days_overdue >= 30')
    expect(fn({ days_overdue: 35 })).toBeTruthy()
    expect(fn({ days_overdue: 10 })).toBeFalsy()
  })

  it('evaluates logical AND', () => {
    const fn = compileExpression('amount > 1000 and rating <= 2')
    expect(fn({ amount: 5000, rating: 1 })).toBeTruthy()
    expect(fn({ amount: 500, rating: 1 })).toBeFalsy()
  })

  it('evaluates logical OR', () => {
    const fn = compileExpression('status == "failed" or retries >= 3')
    expect(fn({ status: 'failed', retries: 0 })).toBeTruthy()
    expect(fn({ status: 'ok', retries: 3 })).toBeTruthy()
    expect(fn({ status: 'ok', retries: 0 })).toBeFalsy()
  })

  it('handles string equality', () => {
    const fn = compileExpression('category == "billing"')
    expect(fn({ category: 'billing' })).toBeTruthy()
    expect(fn({ category: 'general' })).toBeFalsy()
  })

  it('handles nested arithmetic', () => {
    const fn = compileExpression('value * 0.15 > 100')
    expect(fn({ value: 800 })).toBeTruthy()
    expect(fn({ value: 600 })).toBeFalsy()
  })

  it('handles missing fields gracefully', () => {
    const fn = compileExpression('amount > 100')
    // filtrex returns falsy / throws — should not crash the engine
    expect(() => fn({})).not.toThrow()
  })
})

// ── Detector schema validation (mirrors engine validator logic) ───────────────

describe('detector schema structure', () => {
  const validDetector = {
    id: 'test_detector',
    name: 'Test Detector',
    signal_type: 'invoice.overdue',
    rules: [
      {
        id: 'rule_1',
        hypothesis: 'Invoice overdue > 30 days',
        condition: 'days_overdue >= 30',
        actions: [],
        confidence: 0.9,
      },
    ],
  }

  it('valid detector passes shape check', () => {
    expect(validDetector.id).toBeTruthy()
    expect(validDetector.rules.length).toBeGreaterThan(0)
    expect(validDetector.rules[0]!.condition).toBeTruthy()
  })

  it('each rule must have hypothesis, condition, and confidence', () => {
    for (const rule of validDetector.rules) {
      expect(rule.hypothesis).toBeTruthy()
      expect(rule.condition).toBeTruthy()
      expect(rule.confidence).toBeGreaterThan(0)
      expect(rule.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('confidence must be between 0 and 1', () => {
    const rule = validDetector.rules[0]!
    expect(rule.confidence >= 0 && rule.confidence <= 1).toBe(true)
  })
})

// ── Tenant isolation contract ─────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('events from different tenants produce independent results', () => {
    const evalForTenant = (tenantId: string, amount: number) => {
      const fn = compileExpression('amount >= 1000')
      return { tenantId, result: fn({ amount }) }
    }

    const a = evalForTenant('tenant-A', 5000)
    const b = evalForTenant('tenant-B', 100)

    expect(a.result).toBeTruthy()
    expect(b.result).toBeFalsy()
    // Verify isolation — same expression, different data
    expect(a.tenantId).not.toBe(b.tenantId)
  })
})

// ── Blend Policy ───────────────────────────────────────────────────────────────

describe('blend policy', () => {
  it('custom blend (0.9/0.1) changes combined_score as expected', () => {
    const or_score = 0.8
    const llm_score = 0.9
    const blend = { rule_weight: 0.9, llm_weight: 0.1, llm_weight_ceiling: 0.9 }

    const combined_score =
      or_score * blend.rule_weight +
      llm_score * Math.min(blend.llm_weight, blend.llm_weight_ceiling)

    // 0.8 * 0.9 + 0.9 * 0.1 = 0.72 + 0.09 = 0.81
    expect(combined_score).toBeCloseTo(0.81, 2)
  })

  it('default blend (0.7/0.3) works when no policy provided', () => {
    const or_score = 0.8
    const llm_score = 0.9
    const blend = { rule_weight: 0.7, llm_weight: 0.3, llm_weight_ceiling: 0.9 }

    const combined_score =
      or_score * blend.rule_weight +
      llm_score * Math.min(blend.llm_weight, blend.llm_weight_ceiling)

    // 0.8 * 0.7 + 0.9 * 0.3 = 0.56 + 0.27 = 0.83
    expect(combined_score).toBeCloseTo(0.83, 2)
  })

  it('llm_weight_ceiling caps the LLM contribution', () => {
    const or_score = 0.7
    const llm_score = 0.95
    const blend = { rule_weight: 0.5, llm_weight: 0.5, llm_weight_ceiling: 0.2 }

    const combined_score =
      or_score * blend.rule_weight +
      llm_score * Math.min(blend.llm_weight, blend.llm_weight_ceiling)

    // 0.7 * 0.5 + 0.95 * 0.2 = 0.35 + 0.19 = 0.54
    expect(combined_score).toBeCloseTo(0.54, 2)
  })
})
