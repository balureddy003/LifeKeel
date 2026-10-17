import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { MoveJudge, runMoveGuard, scanText, type Insight, type JudgeScores } from '../index.js'

const DETECTORS_DIR = path.resolve(__dirname, '../../../../detectors/family')

function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: 'move-1',
    tenant_id: 'tenant-1',
    hypothesis: 'protection_gap',
    category: 'risk',
    urgency: 'high',
    estimated_impact_low: 100,
    estimated_impact_high: 200,
    reasoning:
      'Your listed cover appears below the estimated household need. This is an informational estimate.',
    actions: ['Review your current policy terms'],
    confidence_breakdown: {
      or_score: 0.8,
      combined_score: 0.82,
      model_version: 'test@1',
      evidence_refs: [],
    },
    detector_id: 'test',
    rule_id: 'rule',
    state: 'identified',
    created_at: new Date(),
    derived_from_signals: [],
    ...overrides,
  }
}

const pass: JudgeScores = {
  coherence: 5,
  groundedness: 5,
  actionability: 5,
  proportionality: 5,
  safety: 5,
  feedback: '',
}

describe('scanText', () => {
  it.each([
    ['You should switch to Acme Insurance today.', 'regulated_advice'],
    ['We recommend buying a larger policy.', 'regulated_advice'],
    ['This is the best policy for you.', 'provider_steering'],
    ['Email jane.doe@example.com for details.', 'pii'],
    ['NI number AB 12 34 56 C on file.', 'pii'],
    ['Card 4242 4242 4242 4242 on file.', 'pii'],
    ['api_key=abcd1234efgh', 'credential'],
  ])('flags %s as %s', (text, reason) => {
    expect(scanText(text)).toContain(reason)
  })

  it('does not flag long minor-unit amounts as card numbers', () => {
    expect(scanText('Estimated need of 123456789012 minor units.')).toEqual([])
  })

  it('allows the informational wording the product uses', () => {
    expect(
      scanText(
        'Compare quotes from multiple insurers before making any changes. Please consult a licensed professional.',
      ),
    ).toEqual([])
  })
})

describe('runMoveGuard', () => {
  it('is clean for informational template copy', () => {
    expect(runMoveGuard(insight())).toEqual({ outcome: 'clean', reasons: [] })
  })

  it('blocks provider steering in actions', () => {
    const r = runMoveGuard(insight({ actions: ['Switch to the best policy available'] }))
    expect(r.outcome).toBe('block')
    expect(r.reasons).toContain('provider_steering')
  })

  it('sends invalid impact ranges and thin copy to review, not pass', () => {
    expect(runMoveGuard(insight({ estimated_impact_low: 300 })).outcome).toBe('review')
    expect(runMoveGuard(insight({ reasoning: 'Too short' })).outcome).toBe('review')
    expect(runMoveGuard(insight({ actions: [] })).outcome).toBe('review')
  })
})

describe('shipped detector copy', () => {
  // The guard replaces the model for template-rendered copy, so every shipped
  // template and action must pass it. A failure here is a copy bug (or a guard
  // false positive) to fix before the copy can ship.
  const files = readdirSync(DETECTORS_DIR).filter((f) => f.endsWith('.yaml'))

  it('finds the family detectors', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s has no blocking template or action text', (file) => {
    const doc = yaml.load(readFileSync(path.join(DETECTORS_DIR, file), 'utf8')) as {
      rules?: Array<{ id: string; reasoning_template?: string; actions?: string[] }>
    }
    for (const rule of doc.rules ?? []) {
      const texts = [rule.reasoning_template ?? '', ...(rule.actions ?? [])]
      for (const text of texts) {
        expect({ rule: rule.id, text, reasons: scanText(text) }).toEqual({
          rule: rule.id,
          text,
          reasons: [],
        })
      }
    }
  })
})

describe('MoveJudge with guard', () => {
  it('passes clean copy without calling the model', async () => {
    const evaluator = vi.fn(async () => pass)
    const verdict = await new MoveJudge(evaluator, { useGuard: true }).evaluate({
      insight: insight(),
      evidence: {},
    })
    expect(verdict).toMatchObject({ decision: 'pass', judge_skipped: true, decided_by: 'guard' })
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('blocks unsafe copy without calling the model', async () => {
    const evaluator = vi.fn(async () => pass)
    const verdict = await new MoveJudge(evaluator, { useGuard: true }).evaluate({
      insight: insight({ actions: ['You should switch to a cheaper insurer'] }),
      evidence: {},
    })
    expect(verdict).toMatchObject({ decision: 'block', decided_by: 'guard' })
    expect(evaluator).not.toHaveBeenCalled()
  })

  it('still screens below-threshold insights instead of bypassing the guard', async () => {
    const low = insight({
      confidence_breakdown: {
        or_score: 0.5,
        combined_score: 0.5,
        model_version: 't',
        evidence_refs: [],
      },
    })
    const judge = new MoveJudge(
      vi.fn(async () => pass),
      { useGuard: true },
    )
    expect((await judge.evaluate({ insight: low, evidence: {} })).decision).toBe('skipped')
    const unsafe = { ...low, actions: ['Switch to the best policy'] }
    expect((await judge.evaluate({ insight: unsafe, evidence: {} })).decision).toBe('block')
  })

  it('escalates ambiguous copy to the model', async () => {
    const evaluator = vi.fn(async () => pass)
    const verdict = await new MoveJudge(evaluator, { useGuard: true }).evaluate({
      insight: insight({ reasoning: 'Too short' }),
      evidence: {},
    })
    expect(verdict).toMatchObject({ decision: 'pass', decided_by: 'model', judge_skipped: false })
    expect(evaluator).toHaveBeenCalledTimes(1)
  })
})
