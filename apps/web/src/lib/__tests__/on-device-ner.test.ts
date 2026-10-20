/**
 * Layer-B NER curtain integration + eval-gate tests.
 *
 * The classifier itself is hardware/network-gated (transformers.js +
 * ~110 MB int8 weights) — these tests cover everything around it:
 * output normalization (grouped and per-token shapes), the async curtain
 * composition (dictionary precedence, restore round-trip), and the eval
 * gate math. The real-model run happens in the weakest-runtime harness
 * (docs/intents/11-...).
 */
import { describe, expect, it, vi } from 'vitest'
import { normalizeNerOutput } from '../on-device-ner'
import { redactForCloudEgress, redactForCloudEgressAsync } from '../onDeviceLlm'
import { NER_EVAL_CASES, runNerEvals } from '../on-device-evals'

describe('normalizeNerOutput', () => {
  const text = 'My neighbour Priya Sharma moved to Leeds.'

  it('uses grouped rows (entity_group + offsets) verbatim', () => {
    const entities = normalizeNerOutput(
      [{ entity_group: 'PER', word: 'Priya Sharma', start: 13, end: 25, score: 0.98 }],
      text,
    )
    expect(entities).toEqual([{ category: 'PERSON', text: 'Priya Sharma', score: 0.98 }])
  })

  it('merges B-/I- per-token rows into one span by adjacency', () => {
    // PER "Priya Sharma" then LOC "Leeds" — IOB from an unaggregated pipeline.
    const entities = normalizeNerOutput(
      [
        { entity: 'B-PER', start: 13, end: 18, score: 0.99 },
        { entity: 'I-PER', start: 19, end: 25, score: 0.95 },
        { entity: 'O', start: 25, end: 26 },
        { entity: 'B-LOC', start: 35, end: 40, score: 0.9 },
      ],
      text,
    )
    expect(entities.map((e) => `${e.category}:${e.text}`)).toEqual([
      'PERSON:Priya Sharma',
      'LOC:Leeds',
    ])
    // The entity score is the weakest token's — the honest confidence.
    expect(entities[0]!.score).toBe(0.95)
  })

  it('starts a new span when a B- tag follows the same label', () => {
    const entities = normalizeNerOutput(
      [
        { entity: 'B-PER', start: 0, end: 3, score: 0.9 },
        { entity: 'B-PER', start: 8, end: 14, score: 0.9 },
      ],
      'Tom and Rachel went out.',
    )
    expect(entities.map((e) => e.text)).toEqual(['Tom', 'Rachel'])
  })

  it('drops unknown labels and O tokens', () => {
    expect(
      normalizeNerOutput(
        [
          { entity: 'O', start: 0, end: 3 },
          { entity: 'B-ART', start: 4, end: 8, score: 0.5 },
        ],
        text,
      ),
    ).toEqual([])
  })
})

describe('redactForCloudEgressAsync — Layer-B composition', () => {
  const classify = async (text: string) =>
    text.includes('Sarah') ? [{ category: 'PERSON' as const, text: 'Sarah' }] : []

  it('redacts an unanchored name the deterministic layer cannot see', async () => {
    const curtain = await redactForCloudEgressAsync(
      'Sarah said the premium went up.',
      {},
      {
        classify,
      },
    )
    expect(curtain.redactedText).not.toContain('Sarah')
    expect(curtain.redactedText).toMatch(/\[PERSON_\d+_[a-z0-9]+\] said/)
    expect(curtain.restore('Asked [PERSON_1_x]')).toContain('Asked [PERSON_1_x]') // wrong nonce stays masked
  })

  it('round-trips NER placeholders through restore', async () => {
    const curtain = await redactForCloudEgressAsync('Sarah said hi.', {}, { classify })
    const token = curtain.redactedText.split(' ')[0]!
    expect(curtain.restore(`Spoke to ${token}`)).toBe('Spoke to Sarah')
  })

  it('dictionary entries keep precedence over an overlapping NER span', async () => {
    const ner = async () => [{ category: 'PERSON' as const, text: 'Sarah Jenkins' }]
    const curtain = await redactForCloudEgressAsync(
      'Sarah Jenkins called about her pension.',
      { memberNames: ['Sarah Jenkins'] },
      { classify: ner },
    )
    expect(curtain.redactedText).toMatch(/\[MEMBER_1_/)
    expect(curtain.redactedText).not.toContain('PERSON')
    expect(curtain.redactedText).not.toContain('Sarah')
  })

  it('a throwing or slow classifier degrades to the deterministic curtain', async () => {
    const throwing = async () => {
      throw new Error('model exploded')
    }
    const curtain = await redactForCloudEgressAsync(
      'Call Sarah on 07700 900123.',
      {},
      {
        classify: throwing,
      },
    )
    expect(curtain.redactedText).toContain('[PHONE_')
    expect(curtain.redactedText).toContain('Sarah') // unanchored — still leaks, honestly

    const slow = (text: string) =>
      new Promise<{ category: 'PERSON'; text: string }[]>((res) =>
        setTimeout(() => res([{ category: 'PERSON' as const, text: 'Sarah' }]), 9_000),
      )
    const timed = await redactForCloudEgressAsync(
      'Sarah left a note.',
      {},
      {
        classify: slow,
        inferTimeoutMs: 50,
      },
    )
    expect(timed.redactedText).toContain('Sarah')
  })

  it('ignores malformed entity spans', () => {
    const curtain = redactForCloudEgress('Nothing to hide here.', {}, [
      { category: 'PERSON', text: 'x' }, // too short
      { category: 'PERSON', text: '   ' },
      { category: 'EMAIL', text: 'here' } as never, // unallowlisted category
      { category: 'LOC', text: 'not in the text' }, // literal absent — no-op
    ])
    expect(curtain.redactedText).toBe('Nothing to hide here.')
  })
})

describe('runNerEvals gate math', () => {
  it('passes a perfect classifier', async () => {
    const perfect = async (input: string) => {
      const c = NER_EVAL_CASES.find((k) => k.input === input)
      return (c?.mustRedact ?? []).map((text) => ({ text }))
    }
    const verdict = await runNerEvals(NER_EVAL_CASES, perfect)
    expect(verdict.recall).toBe(1)
    expect(verdict.forbiddenHits).toEqual([])
    expect(verdict.pass).toBe(true)
  })

  it('fails on a forbidden hit even at full recall', async () => {
    const sloppy = async (input: string) => {
      const c = NER_EVAL_CASES.find((k) => k.input === input)
      return [
        ...(c?.mustRedact ?? []).map((text) => ({ text })),
        ...(c?.mustNotRedact ?? []).map((text) => ({ text })),
      ]
    }
    const verdict = await runNerEvals(NER_EVAL_CASES, sloppy)
    expect(verdict.recall).toBe(1)
    expect(verdict.forbiddenHits.length).toBeGreaterThan(0)
    expect(verdict.pass).toBe(false)
  })

  it('fails below the recall floor', async () => {
    const blind = async () => [] as { text: string }[]
    const verdict = await runNerEvals(NER_EVAL_CASES, blind)
    expect(verdict.recalled).toBe(0)
    expect(verdict.pass).toBe(false)
  })
})

describe('classifyEntities safety rails (no model loaded)', () => {
  it('returns [] without loading anything when on-device AI is disabled', async () => {
    localStorage.setItem('lifekeel:on-device-drafts', 'false')
    const { classifyEntities } = await import('../on-device-ner')
    await expect(classifyEntities('Sarah went to Leeds')).resolves.toEqual([])
  })
})
